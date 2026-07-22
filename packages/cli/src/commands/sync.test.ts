import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { loadSyncManifest, SYNC_MANIFEST_FILENAME } from '../utils/sync-manifest'
import { classifySyncStep, readExportModifiedAt, syncWorkspace } from './sync'

const API_URL = 'https://api.example.com'
const TOKEN = 'tok-1'

/** A minimal but real `.deepnote` document — `readExportModifiedAt` parses it as YAML. */
function projectYaml(id: string, modifiedAt: string, marker = 'v1'): string {
  return [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    `  modifiedAt: '${modifiedAt}'`,
    'project:',
    `  id: ${id}`,
    `  notebooks: []`,
    `# ${marker}`,
    '',
  ].join('\n')
}

interface CloudFile {
  path: string
  size: number
  updatedAt?: string
  content: string
}

interface CloudProject {
  id: string
  name: string
  folder?: { id: string; name: string; path: string[] } | null
  yaml: string
  files?: CloudFile[]
  /** `unless-forced` 409s the import until `force=true`; `always` 409s regardless. */
  importConflict?: 'always' | 'unless-forced'
  /** What the cloud holds after a successful import (the canonical re-export). */
  yamlAfterImport?: string
  /** The project is listed, but exporting it fails (e.g. suspended). */
  exportFails?: boolean
}

interface ImportCall {
  projectId: string
  url: URL
  body: string
}

interface InstalledCloud {
  importCalls: ImportCall[]
  downloadedPaths: string[]
}

/** Simulate the sync API surface on global fetch, backed by mutable `projects` state. */
function installCloud(projects: CloudProject[]): InstalledCloud {
  const importCalls: ImportCall[] = []
  const downloadedPaths: string[] = []

  const respond = (body: unknown, init: { status?: number; bytes?: Uint8Array } = {}): Response => {
    const status = init.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: () => Promise.resolve((init.bytes ?? new Uint8Array()).buffer),
    } as unknown as Response
  }

  vi.spyOn(global, 'fetch').mockImplementation(async (rawUrl, init) => {
    const url = new URL(String(rawUrl))
    const byId = (id: string) => projects.find(project => project.id === id)

    if (url.pathname === '/v2/projects') {
      return respond({
        projects: projects.map(project => ({ id: project.id, name: project.name, folder: project.folder ?? null })),
        pagination: { nextPageToken: null },
      })
    }

    const exportMatch = url.pathname.match(/^\/v2\/projects\/([^/]+)\/export$/)
    if (exportMatch) {
      const project = byId(exportMatch[1])
      if (!project || project.exportFails) {
        return respond({ message: 'Project is suspended' }, { status: 409 })
      }
      return respond(project.yaml)
    }

    const importMatch = url.pathname.match(/^\/v2\/projects\/([^/]+)\/import$/)
    if (importMatch) {
      const project = byId(importMatch[1])
      if (!project) {
        return respond({ message: 'Project not found' }, { status: 404 })
      }
      importCalls.push({ projectId: project.id, url, body: String(init?.body) })
      const forced = url.searchParams.get('force') === 'true'
      if (project.importConflict === 'always' || (project.importConflict === 'unless-forced' && !forced)) {
        return respond({ message: 'Project changed after baseModifiedAt' }, { status: 409 })
      }
      if (project.yamlAfterImport) {
        project.yaml = project.yamlAfterImport
      }
      return respond({
        project: { id: project.id },
        notebooks: [{ id: 'nb-1', name: 'Main', action: 'overwritten' }],
      })
    }

    const detailMatch = url.pathname.match(/^\/v2\/projects\/([^/]+)$/)
    if (detailMatch) {
      const project = byId(detailMatch[1])
      if (!project) {
        return respond({ message: 'Project not found' }, { status: 404 })
      }
      return respond({
        project: {
          id: project.id,
          name: project.name,
          folder: project.folder ?? null,
          files: (project.files ?? []).map(({ content: _content, ...entry }) => entry),
        },
      })
    }

    if (url.pathname === '/v2/files/download') {
      const project = byId(url.searchParams.get('projectId') ?? '')
      const file = project?.files?.find(candidate => candidate.path === url.searchParams.get('path'))
      if (!file) {
        return respond({ message: 'File not found' }, { status: 404 })
      }
      downloadedPaths.push(`${project?.id}:${file.path}`)
      return respond('', { bytes: new TextEncoder().encode(file.content) })
    }

    throw new Error(`Unexpected request in test: ${url.pathname}`)
  })

  return { importCalls, downloadedPaths }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
  setOutputConfig({ quiet: true, color: false, debug: false })
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetOutputConfig()
  await fs.rm(tempDir, { recursive: true, force: true })
})

const baseOptions = { url: API_URL, token: TOKEN }

describe('syncWorkspace', () => {
  it('mirrors the workspace folder tree on first sync and records everything in the manifest', async () => {
    installCloud([
      { id: 'p-alpha', name: 'Alpha', yaml: projectYaml('p-alpha', '2026-01-02T00:00:00.000Z') },
      {
        id: 'p-beta',
        name: 'Beta',
        folder: { id: 'f1', name: 'Reports', path: ['Team', 'Reports'] },
        yaml: projectYaml('p-beta', '2026-01-03T00:00:00.000Z'),
      },
    ])

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.success).toBe(true)
    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p-alpha', action: 'pulled', path: 'Alpha.deepnote' }),
      expect.objectContaining({ projectId: 'p-beta', action: 'pulled', path: 'Team/Reports/Beta.deepnote' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(
      projectYaml('p-alpha', '2026-01-02T00:00:00.000Z')
    )
    expect(await fs.readFile(path.join(tempDir, 'Team', 'Reports', 'Beta.deepnote'), 'utf-8')).toBe(
      projectYaml('p-beta', '2026-01-03T00:00:00.000Z')
    )

    const manifest = await loadSyncManifest(tempDir)
    expect(manifest.projects['p-alpha']).toEqual(
      expect.objectContaining({ path: 'Alpha.deepnote', modifiedAt: '2026-01-02T00:00:00.000Z' })
    )
  })

  it('is a no-op when nothing changed — the deterministic export makes this a byte comparison', async () => {
    const cloud = installCloud([{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }])
    await syncWorkspace(tempDir, baseOptions)

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
    expect(cloud.importCalls).toEqual([])
  })

  it('pulls a cloud edit over an unmodified local file', async () => {
    const projects: CloudProject[] = [{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)
    projects[0].yaml = projectYaml('p1', '2026-01-05T00:00:00.000Z', 'cloud-edit')

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toContain('cloud-edit')
  })

  it('pushes a local edit with baseModifiedAt and refreshes the file from the canonical re-export', async () => {
    const canonical = projectYaml('p1', '2026-01-09T00:00:00.000Z', 'canonical-after-import')
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z'), yamlAfterImport: canonical },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = projectYaml('p1', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'pushed',
        notebooks: [{ id: 'nb-1', name: 'Main', action: 'overwritten' }],
      }),
    ])
    expect(cloud.importCalls).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        body: localEdit,
      }),
    ])
    // Lost-update protection: the manifest's modifiedAt travels back as baseModifiedAt.
    expect(cloud.importCalls[0].url.searchParams.get('baseModifiedAt')).toBe('2026-01-02T00:00:00.000Z')
    expect(cloud.importCalls[0].url.searchParams.get('force')).toBeNull()
    // The import may rewrite ids / drop never-applied fields, so the cloud's canonical form
    // replaces the local edit and the manifest fingerprints the new state.
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(canonical)
    expect((await loadSyncManifest(tempDir)).projects.p1?.modifiedAt).toBe('2026-01-09T00:00:00.000Z')
  })

  it('skips a push 409 under --on-conflict skip, leaving both sides untouched', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z'), importConflict: 'always' },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = projectYaml('p1', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'skip' })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(localEdit)
  })

  it('retries a push 409 with force under --on-conflict override', async () => {
    const canonical = projectYaml('p1', '2026-01-09T00:00:00.000Z', 'canonical-after-forced-import')
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z'),
        importConflict: 'unless-forced',
        yamlAfterImport: canonical,
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    await fs.writeFile(
      path.join(tempDir, 'Alpha.deepnote'),
      projectYaml('p1', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'override' })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed' })])
    expect(cloud.importCalls).toHaveLength(2)
    expect(cloud.importCalls[1].url.searchParams.get('force')).toBe('true')
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(canonical)
  })

  it('treats "changed locally AND in the cloud" as a conflict: override takes the cloud version', async () => {
    const projects: CloudProject[] = [{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }]
    const cloud = installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    await fs.writeFile(
      path.join(tempDir, 'Alpha.deepnote'),
      projectYaml('p1', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const cloudEdit = projectYaml('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    projects[0].yaml = cloudEdit
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'override' })

    expect(result.projects).toEqual([
      expect.objectContaining({ action: 'pulled', detail: 'conflict resolved: local changes overwritten' }),
    ])
    expect(cloud.importCalls).toEqual([])
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(cloudEdit)
  })

  it('skips a both-sides conflict by default when no terminal can be asked, keeping the local edit', async () => {
    const projects: CloudProject[] = [{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = projectYaml('p1', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha.deepnote'), localEdit, 'utf-8')
    projects[0].yaml = projectYaml('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    // No onConflict option: vitest has no TTY, so `ask` degrades to skip.
    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toBe(localEdit)
  })

  it('downloads working-directory files incrementally with --all-files', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z'),
        files: [
          { path: 'data/input.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a,b' },
          // Hostile inventory entries must be skipped, not written outside the sync root.
          { path: '../escape.txt', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'x' },
        ],
      },
    ]
    const cloud = installCloud(projects)

    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(await fs.readFile(path.join(tempDir, 'Alpha.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b')
    expect(cloud.downloadedPaths).toEqual(['p1:data/input.csv'])
    await expect(fs.stat(path.join(path.dirname(tempDir), 'escape.txt'))).rejects.toThrow()

    // Unchanged size/updatedAt: the second sync downloads nothing.
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(1)

    // A changed fingerprint re-downloads.
    projects[0].files = [{ path: 'data/input.csv', size: 5, updatedAt: '2026-01-08T00:00:00.000Z', content: 'a,b,c' }]
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(2)
    expect(await fs.readFile(path.join(tempDir, 'Alpha.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b,c')

    consoleErrorSpy.mockRestore()
  })

  it('keeps local files for projects that left the cloud, unless --prune opts into deletion', async () => {
    const projects: CloudProject[] = [{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    projects.length = 0
    const kept = await syncWorkspace(tempDir, baseOptions)
    expect(kept.projects).toEqual([expect.objectContaining({ action: 'missing-in-cloud' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha.deepnote'), 'utf-8')).toContain('p1')

    const pruned = await syncWorkspace(tempDir, { ...baseOptions, prune: true })
    expect(pruned.projects).toEqual([expect.objectContaining({ action: 'pruned' })])
    await expect(fs.stat(path.join(tempDir, 'Alpha.deepnote'))).rejects.toThrow()
    expect((await loadSyncManifest(tempDir)).projects).toEqual({})
  })

  it('moves the local file when the project was renamed in the cloud', async () => {
    const projects: CloudProject[] = [{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    projects[0].name = 'Gamma'
    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([
      expect.objectContaining({ action: 'unchanged', path: 'Gamma.deepnote', detail: 'moved from Alpha.deepnote' }),
    ])
    await expect(fs.stat(path.join(tempDir, 'Alpha.deepnote'))).rejects.toThrow()
    expect(await fs.readFile(path.join(tempDir, 'Gamma.deepnote'), 'utf-8')).toContain('p1')
  })

  it('reports untracked local .deepnote files without touching them', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }])
    await fs.writeFile(path.join(tempDir, 'stray.deepnote'), 'version: 1.0.0\n', 'utf-8')

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.untrackedFiles).toEqual(['stray.deepnote'])
    expect(await fs.readFile(path.join(tempDir, 'stray.deepnote'), 'utf-8')).toBe('version: 1.0.0\n')
  })

  it('writes nothing at all in a dry run', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', yaml: projectYaml('p1', '2026-01-02T00:00:00.000Z') }])

    const result = await syncWorkspace(tempDir, { ...baseOptions, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    await expect(fs.stat(path.join(tempDir, 'Alpha.deepnote'))).rejects.toThrow()
    await expect(fs.stat(path.join(tempDir, SYNC_MANIFEST_FILENAME))).rejects.toThrow()
  })

  it('isolates a failing project so the rest of the workspace still syncs', async () => {
    installCloud([
      { id: 'p-bad', name: 'Bad', yaml: '', exportFails: true },
      { id: 'p-good', name: 'Good', yaml: projectYaml('p-good', '2026-01-02T00:00:00.000Z') },
    ])

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p-bad', action: 'error', detail: 'Project is suspended' }),
      expect.objectContaining({ projectId: 'p-good', action: 'pulled' }),
    ])
  })
})

describe('classifySyncStep', () => {
  const record = { path: 'A.deepnote', contentHash: 'base' }

  it('pulls when there is no local file', () => {
    expect(classifySyncStep({ localHash: null, exportHash: 'x', record })).toBe('pull')
  })

  it('is a noop when local and cloud bytes match, even untracked', () => {
    expect(classifySyncStep({ localHash: 'x', exportHash: 'x', record: undefined })).toBe('noop')
  })

  it('conflicts on an untracked local file that differs from the cloud', () => {
    expect(classifySyncStep({ localHash: 'local', exportHash: 'cloud', record: undefined })).toBe('conflict')
  })

  it('separates push, pull, and conflict by comparing both sides to the last-synced hash', () => {
    expect(classifySyncStep({ localHash: 'edited', exportHash: 'base', record })).toBe('push')
    expect(classifySyncStep({ localHash: 'base', exportHash: 'moved', record })).toBe('pull')
    expect(classifySyncStep({ localHash: 'edited', exportHash: 'moved', record })).toBe('conflict')
  })
})

describe('readExportModifiedAt', () => {
  it('reads metadata.modifiedAt without validating the whole document', () => {
    expect(readExportModifiedAt(projectYaml('p1', '2026-01-02T00:00:00.000Z'))).toBe('2026-01-02T00:00:00.000Z')
  })

  it('returns undefined for documents it cannot read', () => {
    expect(readExportModifiedAt('not yaml: [')).toBeUndefined()
    expect(readExportModifiedAt('version: 1.0.0\n')).toBeUndefined()
  })
})
