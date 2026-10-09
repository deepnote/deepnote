import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_BUFFERED_PROJECT_FILE_BYTES } from '@deepnote/cloud'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as syncManifest from './sync-manifest'
import { assertNoSymbolicLinkAncestors, loadSyncManifest, saveSyncManifest } from './sync-manifest'
import {
  canonicalProjectHash,
  classifySyncStep,
  describeCloudFileDivergence,
  readExportModifiedAt,
  type SyncConflict,
  type SyncConflictDecision,
  type SyncEvent,
  syncWorkspace,
} from './sync-workspace'

// Wrapped (still the real implementations) so a test can watch manifest saves overlap and see
// when each project starts.
vi.mock('./sync-manifest', async importOriginal => {
  const actual = await importOriginal<typeof syncManifest>()
  return {
    ...actual,
    saveSyncManifest: vi.fn(actual.saveSyncManifest),
    assertNoSymbolicLinkAncestors: vi.fn(actual.assertNoSymbolicLinkAncestors),
  }
})

const API_URL = 'https://api.example.com'
const TOKEN = 'tok-1'

interface DocumentIntegration {
  id: string
  name: string
  type: string
}

/** A minimal but real single-notebook `.deepnote` document — `readExportModifiedAt` parses it. */
function notebookYaml(
  projectId: string,
  notebookId: string,
  modifiedAt: string,
  marker = 'v1',
  options: { projectName?: string; notebookName?: string; integrations?: DocumentIntegration[] } = {}
): string {
  const lines = [
    'version: 1.0.0',
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    `  modifiedAt: '${modifiedAt}'`,
    'project:',
    `  id: ${projectId}`,
    `  name: ${options.projectName ?? 'Alpha'}`,
  ]
  if (options.integrations !== undefined) {
    if (options.integrations.length === 0) {
      lines.push('  integrations: []')
    } else {
      lines.push('  integrations:')
      for (const integration of options.integrations) {
        lines.push(`    - id: ${integration.id}`, `      name: ${integration.name}`, `      type: ${integration.type}`)
      }
    }
  }
  lines.push(
    '  notebooks:',
    `    - id: ${notebookId}`,
    `      name: ${options.notebookName ?? 'Main'}`,
    '      blocks: []',
    `# ${marker}`,
    ''
  )
  return lines.join('\n')
}

interface NotebookFile {
  filename: string
  content: string
}

/** One project made of a single notebook file named `main.deepnote`. */
function singleNotebook(projectId: string, modifiedAt: string, marker = 'v1'): NotebookFile[] {
  return [{ filename: 'main.deepnote', content: notebookYaml(projectId, 'nb-main', modifiedAt, marker) }]
}

interface CloudFile {
  path: string
  size: number
  updatedAt: string
  content: string
}

interface CloudProject {
  id: string
  name: string
  folder?: { id: string; name: string; path: { id: string; name: string }[] } | null
  /** The exploded export: one `.deepnote` document per notebook. */
  notebooks: NotebookFile[]
  files?: CloudFile[]
  /** The project is listed, but exporting it fails (e.g. suspended). */
  exportFails?: boolean
  /** `unless-forced` 409s the import until `force=true`; `always` 409s regardless. */
  importConflict?: 'always' | 'unless-forced'
  /** A final-contract import error to surface to sync unchanged. */
  importError?: { status: number; message: string }
  /** A file-upload error to surface after the replacement delete. */
  fileUploadError?: { status: number; message: string }
  /** The actual path returned by a successful file upload. */
  fileUploadPath?: string
  /** The canonical export the cloud holds after a successful import. */
  notebooksAfterImport?: NotebookFile[]
  /** The canonical project name after a successful document-driven rename. */
  nameAfterImport?: string
}

interface ImportCall {
  projectId: string
  url: URL
  filenames: string[]
  /** Decoded `.deepnote` documents from the uploaded ZIP, by filename. */
  documents: Record<string, string>
}

interface InstalledCloud {
  downloadedPaths: string[]
  importCalls: ImportCall[]
  uploadedPaths: string[]
  deletedPaths: string[]
}

/** Simulate the sync API surface on global fetch, backed by mutable `projects` state. */
function installCloud(projects: CloudProject[]): InstalledCloud {
  const downloadedPaths: string[] = []
  const importCalls: ImportCall[] = []
  const uploadedPaths: string[] = []
  const deletedPaths: string[] = []

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

  const exportZip = (project: CloudProject): Uint8Array => {
    const encoder = new TextEncoder()
    const entries: Record<string, Uint8Array> = {}
    for (const notebook of project.notebooks) {
      entries[notebook.filename] = encoder.encode(notebook.content)
    }
    return zipSync(entries)
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
      return respond('', { bytes: exportZip(project) })
    }

    const importMatch = url.pathname.match(/^\/v2\/projects\/([^/]+)\/import$/)
    if (importMatch) {
      const project = byId(importMatch[1])
      if (!project) {
        return respond({ message: 'Project not found' }, { status: 404 })
      }
      const entries = unzipSync(init?.body as Uint8Array)
      const decoder = new TextDecoder()
      const documents: Record<string, string> = {}
      for (const [name, content] of Object.entries(entries)) {
        documents[name] = decoder.decode(content)
      }
      importCalls.push({ projectId: project.id, url, filenames: Object.keys(entries).sort(), documents })
      if (project.importError) {
        return respond({ message: project.importError.message }, { status: project.importError.status })
      }
      const forced = url.searchParams.get('force') === 'true'
      if (project.importConflict === 'always' || (project.importConflict === 'unless-forced' && !forced)) {
        return respond({ message: 'Project changed after baseModifiedAt' }, { status: 409 })
      }
      if (project.notebooksAfterImport) {
        project.notebooks = project.notebooksAfterImport
      }
      if (project.nameAfterImport) {
        project.name = project.nameAfterImport
      }
      return respond({
        project: { id: project.id, modifiedAt: '2026-01-09T00:00:00.000Z', contentHash: '0'.repeat(64) },
        notebooks: [{ id: 'nb-main', name: 'Main', action: 'overwritten' }],
      })
    }

    if (url.pathname === '/v2/files') {
      if (init?.method === 'DELETE') {
        deletedPaths.push(`${url.searchParams.get('projectId')}:${url.searchParams.get('path')}`)
        return respond('', { status: 204 })
      }
      const form = init?.body as FormData
      const uploadPath = String(form.get('path'))
      const projectId = String(form.get('projectId'))
      uploadedPaths.push(`${projectId}:${uploadPath}`)
      const uploadError = byId(projectId)?.fileUploadError
      if (uploadError) {
        return respond({ message: uploadError.message }, { status: uploadError.status })
      }
      return respond(
        {
          file: {
            path: byId(projectId)?.fileUploadPath ?? uploadPath,
            size: 7,
            updatedAt: '2026-01-09T00:00:00.000Z',
          },
        },
        { status: 201 }
      )
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

  return { downloadedPaths, importCalls, uploadedPaths, deletedPaths }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tempDir, { recursive: true, force: true })
})

const baseOptions = { baseUrl: API_URL, token: TOKEN }

const teamFolder = { id: 'f1', name: 'Team', path: [{ id: 'f1', name: 'Team' }] }

/** Collects the events a run delivers, in delivery order. */
function collectEvents(): { events: SyncEvent[]; onEvent: (event: SyncEvent) => void } {
  const events: SyncEvent[] = []
  return { events, onEvent: event => events.push(event) }
}

const outcomesOf = (events: readonly SyncEvent[]) =>
  events.flatMap(event => (event.kind === 'project-outcome' ? [event.outcome] : []))
const warningsOf = (events: readonly SyncEvent[]) =>
  events.flatMap(event => (event.kind === 'warning' ? [event.message] : []))

describe('syncWorkspace', () => {
  it('mirrors the workspace folder tree as a directory per project and records it in the manifest', async () => {
    installCloud([
      { id: 'p-alpha', name: 'Alpha', notebooks: singleNotebook('p-alpha', '2026-01-02T00:00:00.000Z') },
      {
        id: 'p-beta',
        name: 'Beta',
        folder: {
          id: 'f1',
          name: 'Reports',
          path: [
            { id: 'ft', name: 'Team' },
            { id: 'fr', name: 'Reports' },
          ],
        },
        notebooks: singleNotebook('p-beta', '2026-01-03T00:00:00.000Z'),
      },
    ])

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.success).toBe(true)
    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p-alpha', action: 'pulled', path: 'Alpha' }),
      expect.objectContaining({ projectId: 'p-beta', action: 'pulled', path: 'Team/Reports/Beta' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(
      notebookYaml('p-alpha', 'nb-main', '2026-01-02T00:00:00.000Z')
    )
    expect(await fs.readFile(path.join(tempDir, 'Team', 'Reports', 'Beta', 'main.deepnote'), 'utf-8')).toBe(
      notebookYaml('p-beta', 'nb-main', '2026-01-03T00:00:00.000Z')
    )

    const manifest = await loadSyncManifest(tempDir)
    expect(manifest.projects['p-alpha']).toEqual(
      expect.objectContaining({
        dir: 'Alpha',
        notebooks: ['main.deepnote'],
        modifiedAt: '2026-01-02T00:00:00.000Z',
      })
    )
  })

  it('writes one file per notebook and removes a notebook file the cloud deleted', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: [
          { filename: 'main.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z') },
          { filename: 'setup.deepnote', content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z') },
        ],
      },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'setup.deepnote'), 'utf-8')).toContain('nb-setup')

    // The cloud drops the setup notebook: the next pull deletes its stale local file.
    projects[0].notebooks = [
      { filename: 'main.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-05T00:00:00.000Z', 'edit') },
    ]
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    await expect(fs.stat(path.join(tempDir, 'Alpha', 'setup.deepnote'))).rejects.toThrow()
    expect((await loadSyncManifest(tempDir)).projects.p1?.notebooks).toEqual(['main.deepnote'])
  })

  it('uses a temporary rename when a notebook filename changes only by case', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: [
          { filename: 'report.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z') },
        ],
      },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    projects[0].notebooks = [
      {
        filename: 'Report.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-05T00:00:00.000Z', 'cloud-edit'),
      },
    ]
    const renameSpy = vi.spyOn(fs, 'rename')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const projectDir = path.join(tempDir, 'Alpha')
    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    expect(renameSpy).toHaveBeenCalledTimes(2)
    expect(renameSpy.mock.calls[0][0]).toBe(path.join(projectDir, 'report.deepnote'))
    expect(renameSpy.mock.calls[0][1]).toBe(renameSpy.mock.calls[1][0])
    expect(renameSpy.mock.calls[1][1]).toBe(path.join(projectDir, 'Report.deepnote'))
    expect(await fs.readdir(projectDir)).toEqual(['Report.deepnote'])
    expect(await fs.readFile(path.join(projectDir, 'Report.deepnote'), 'utf-8')).toContain('cloud-edit')
  })

  it('is a no-op when nothing changed — the deterministic export makes this a hash comparison', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
  })

  it('pulls a cloud edit over an unmodified local project', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    projects[0].notebooks = singleNotebook('p1', '2026-01-05T00:00:00.000Z', 'cloud-edit')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit')
  })

  it('pushes a local edit: imports the notebook documents and rewrites from the canonical re-export', async () => {
    const canonical = [
      { filename: 'main.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-09T00:00:00.000Z', 'canonical') },
    ]
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: canonical,
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'pushed',
        notebooks: [{ id: 'nb-main', name: 'Main', action: 'overwritten' }],
      }),
    ])
    // The import was called once, sending the edited notebook document zipped up, with the base
    // fingerprints for lost-update protection.
    expect(cloud.importCalls).toHaveLength(1)
    expect(cloud.importCalls[0].filenames).toEqual(['main.deepnote'])
    // The uploaded document carries the actual local edit, not stale or empty content.
    expect(cloud.importCalls[0].documents['main.deepnote']).toBe(localEdit)
    expect(cloud.importCalls[0].url.searchParams.get('baseModifiedAt')).toBe('2026-01-02T00:00:00.000Z')
    expect(cloud.importCalls[0].url.searchParams.get('baseContentHash')).toBe(
      canonicalProjectHash(singleNotebook('p1', '2026-01-02T00:00:00.000Z'))
    )
    expect(cloud.importCalls[0].url.searchParams.get('force')).toBeNull()
    // The local file is refreshed from the canonical re-export, and the manifest fingerprints it.
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(canonical[0].content)
    expect((await loadSyncManifest(tempDir)).projects.p1?.modifiedAt).toBe('2026-01-09T00:00:00.000Z')
  })

  it('pushes a shared project name and integration update, then moves the directory on the next sync', async () => {
    const integrations: DocumentIntegration[] = [{ id: 'integration-new', name: 'Warehouse', type: 'pgsql' }]
    const initial = [
      {
        filename: 'main.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'initial-main', {
          notebookName: 'Main',
        }),
      },
      {
        filename: 'setup.deepnote',
        content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z', 'initial-setup', {
          notebookName: 'Setup',
        }),
      },
    ]
    const canonical = [
      {
        filename: 'main.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-09T00:00:00.000Z', 'canonical-main', {
          projectName: 'Renamed project',
          notebookName: 'Main',
          integrations,
        }),
      },
      {
        filename: 'setup.deepnote',
        content: notebookYaml('p1', 'nb-setup', '2026-01-09T00:00:00.000Z', 'canonical-setup', {
          projectName: 'Renamed project',
          notebookName: 'Setup',
          integrations,
        }),
      },
    ]
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: initial,
        notebooksAfterImport: canonical,
        nameAfterImport: 'Renamed project',
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const edited = [
      {
        filename: 'main.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-main', {
          projectName: 'Renamed project',
          notebookName: 'Main',
          integrations,
        }),
      },
      {
        filename: 'setup.deepnote',
        content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z', 'local-setup', {
          projectName: 'Renamed project',
          notebookName: 'Setup',
          integrations,
        }),
      },
    ]
    for (const file of edited) {
      await fs.writeFile(path.join(tempDir, 'Alpha', file.filename), file.content, 'utf-8')
    }

    const pushed = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(pushed.projects).toEqual([expect.objectContaining({ action: 'pushed', path: 'Alpha' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(cloud.importCalls[0].documents).toEqual(
      Object.fromEntries(edited.map(file => [file.filename, file.content]))
    )
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(canonical[0].content)
    await expect(fs.stat(path.join(tempDir, 'Renamed project'))).rejects.toThrow()

    const moved = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(moved.projects).toEqual([
      expect.objectContaining({ action: 'unchanged', path: 'Renamed project', detail: 'moved from Alpha' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Renamed project', 'setup.deepnote'), 'utf-8')).toBe(
      canonical[1].content
    )
    await expect(fs.stat(path.join(tempDir, 'Alpha'))).rejects.toThrow()
    expect(cloud.importCalls).toHaveLength(1)
  })

  it('does not delete every cloud notebook from an empty local project when conflict handling skips', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))
    const result = await syncWorkspace({
      ...baseOptions,
      rootDir: tempDir,
      deleteMissingNotebooks: true,
      onConflict: 'skip',
    })

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'skipped-conflict',
        detail: 'local directory has no notebooks; refusing to delete every cloud notebook',
      }),
    ])
    expect(cloud.importCalls).toEqual([])
    expect(projects[0].notebooks).toHaveLength(1)
    expect((await loadSyncManifest(tempDir)).projects.p1?.contentHash).toBe(baselineHash)
  })

  it('deletes every cloud notebook from an empty local project only after explicit override', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: [],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))
    const result = await syncWorkspace({
      ...baseOptions,
      rootDir: tempDir,
      deleteMissingNotebooks: true,
      onConflict: 'override',
    })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(cloud.importCalls[0].filenames).toEqual([])
    expect(cloud.importCalls[0].url.searchParams.get('deleteMissingNotebooks')).toBe('true')
    expect(projects[0].notebooks).toEqual([])
  })

  it('skips a push 409 under --on-conflict skip, leaving both sides untouched', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        importConflict: 'always',
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'skip' })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
  })

  it('reports a suspended-project import 409 as an error instead of a conflict', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        importError: { status: 409, message: 'Project is suspended' },
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'skip' })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'error', detail: 'Project is suspended' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
    expect((await loadSyncManifest(tempDir)).projects.p1?.contentHash).toBe(baselineHash)
  })

  it('retries a push 409 with force under --on-conflict override', async () => {
    const canonical = [
      { filename: 'main.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-09T00:00:00.000Z', 'forced') },
    ]
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        importConflict: 'unless-forced',
        notebooksAfterImport: canonical,
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'override' })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed' })])
    expect(cloud.importCalls).toHaveLength(2)
    expect(cloud.importCalls[1].url.searchParams.get('force')).toBe('true')
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(canonical[0].content)
  })

  it('reports a project-not-found import as an error while preserving the local edit and manifest baseline', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        importError: { status: 404, message: 'Project not found' },
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'error', detail: 'Project not found' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
    expect((await loadSyncManifest(tempDir)).projects.p1?.contentHash).toBe(baselineHash)
  })

  it.each([
    {
      caseName: 'documents with inconsistent project names',
      message: 'Project import documents contain different project names: setup.deepnote',
      edited: [
        {
          filename: 'main.deepnote',
          content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-main', {
            projectName: 'First name',
            notebookName: 'Main',
          }),
        },
        {
          filename: 'setup.deepnote',
          content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z', 'local-setup', {
            projectName: 'Second name',
            notebookName: 'Setup',
          }),
        },
      ],
    },
    {
      caseName: 'an unavailable integration',
      message: 'Integration Missing warehouse not found',
      edited: [
        {
          filename: 'main.deepnote',
          content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-main', {
            notebookName: 'Main',
            integrations: [{ id: 'missing-integration', name: 'Missing warehouse', type: 'pgsql' }],
          }),
        },
        {
          filename: 'setup.deepnote',
          content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z', 'local-setup', {
            notebookName: 'Setup',
            integrations: [{ id: 'missing-integration', name: 'Missing warehouse', type: 'pgsql' }],
          }),
        },
      ],
    },
  ])('reports $caseName as an import error without changing local state', async ({ message, edited }) => {
    const initial = [
      {
        filename: 'main.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'initial-main', {
          notebookName: 'Main',
        }),
      },
      {
        filename: 'setup.deepnote',
        content: notebookYaml('p1', 'nb-setup', '2026-01-02T00:00:00.000Z', 'initial-setup', {
          notebookName: 'Setup',
        }),
      },
    ]
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: initial,
        importError: { status: 422, message },
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash
    for (const file of edited) {
      await fs.writeFile(path.join(tempDir, 'Alpha', file.filename), file.content, 'utf-8')
    }

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'error', detail: message })])
    expect(cloud.importCalls).toHaveLength(1)
    for (const file of edited) {
      expect(await fs.readFile(path.join(tempDir, 'Alpha', file.filename), 'utf-8')).toBe(file.content)
    }
    expect((await loadSyncManifest(tempDir)).projects.p1?.contentHash).toBe(baselineHash)
  })

  it('uploads changed local files on push with --all-files (delete-then-upload overwrite)', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    // Edit a notebook (to trigger the push) and drop in a local working-directory file.
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.mkdir(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'a,b,c', 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
    expect(cloud.uploadedPaths).toEqual(['p1:data/input.csv'])
    expect(cloud.deletedPaths).toEqual(['p1:data/input.csv'])
  })

  it('re-uploads a same-size local file edit on push (change detected by content hash, not size)', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [{ path: 'data/input.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a,b' }],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true }) // downloads input.csv, records its hash

    // Edit the notebook (to trigger the push) and the file to different 3-byte content (same size).
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'x,y', 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
    expect(cloud.uploadedPaths).toEqual(['p1:data/input.csv'])
  })

  describe('working files changed in Deepnote since the last sync', () => {
    async function setUpDivergedFile(
      cloudAfter: CloudFile[],
      folder?: CloudProject['folder']
    ): Promise<{ cloud: InstalledCloud; projects: CloudProject[] }> {
      const projectDir = path.join(tempDir, ...(folder?.path.map(ancestor => ancestor.name) ?? []), 'Alpha')
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          folder,
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [
            { path: '_deepnote_static/index.html', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' },
          ],
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

      projects[0].files = cloudAfter
      await fs.writeFile(
        path.join(projectDir, 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(projectDir, '.files', '_deepnote_static', 'index.html'), 'mine', 'utf-8')
      return { cloud, projects }
    }

    const republished: CloudFile[] = [
      { path: '_deepnote_static/index.html', size: 9, updatedAt: '2026-01-05T00:00:00.000Z', content: 'published' },
    ]

    it('keeps the Deepnote copy and reports it rather than overwriting it', async () => {
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
    })

    it('asks a function policy about the diverged files by their project-relative paths', async () => {
      await setUpDivergedFile(republished)
      const onConflict = vi.fn(async (_conflict: SyncConflict) => 'skip' as const)

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [
          {
            kind: 'working-files-changed',
            projectId: 'p1',
            projectName: 'Alpha',
            projectDir: 'Alpha',
            files: [{ path: '_deepnote_static/index.html', reason: 'changed in Deepnote' }],
          },
        ],
      ])
    })

    it('names the project directory with its folder, apart from the project-relative file paths', async () => {
      await setUpDivergedFile(republished, teamFolder)
      const onConflict = vi.fn(async (_conflict: SyncConflict) => 'skip' as const)

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [
          {
            kind: 'working-files-changed',
            projectId: 'p1',
            projectName: 'Alpha',
            projectDir: 'Team/Alpha',
            files: [{ path: '_deepnote_static/index.html', reason: 'changed in Deepnote' }],
          },
        ],
      ])
    })

    it('overwrites it with --on-conflict override', async () => {
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'override' })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(result.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toEqual(['p1:_deepnote_static/index.html'])
    })

    it('treats a cloud copy deleted since the last sync as a conflict, not a re-upload', async () => {
      const { cloud } = await setUpDivergedFile([])

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      expect(cloud.uploadedPaths).toEqual([])
    })

    it('does not treat an unchanged cloud copy as a conflict', async () => {
      const { cloud } = await setUpDivergedFile([
        { path: '_deepnote_static/index.html', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' },
      ])

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(cloud.uploadedPaths).toEqual(['p1:_deepnote_static/index.html'])
    })

    it('finishes a pending replacement whose cloud copy is already gone', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [{ path: 'report.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' }],
          fileUploadError: { status: 500, message: 'Upload failed' },
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'mine', 'utf-8')

      // Create the interrupted replacement state this retry must recover from.
      const failed = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      expect(failed.projects).toEqual([expect.objectContaining({ action: 'error' })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['report.csv'])

      projects[0].files = []
      delete projects[0].fileUploadError
      const retried = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(retried.projects).toEqual([expect.objectContaining({ filesUploaded: 1 })])
      expect(retried.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toContain('p1:report.csv')
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()
    })

    it('keeps the baseline of a cloud-deleted file across a pull, so a later push still asks', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [{ path: 'report.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' }],
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

      // Deleted in Deepnote (`publish --prune`, or by hand); the local copy stays without --prune.
      projects[0].files = []
      const { events, onEvent } = collectEvents()
      const pulled = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onEvent })

      expect(pulled.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
      expect(warningsOf(events)).toEqual([expect.stringContaining('deleted in Deepnote but kept locally')])
      await expect(fs.readFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'utf-8')).resolves.toEqual('old')
      expect((await loadSyncManifest(tempDir)).projects.p1?.files?.['report.csv']).toBeDefined()

      // An edited copy must surface the deletion as a conflict, not silently resurrect the file.
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-09T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'mine', 'utf-8')
      const pushed = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(pushed.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      expect(cloud.uploadedPaths).toEqual([])
    })

    it('keeps a cloud-deleted file under a symlinked directory when a pull prunes nothing', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          files: [{ path: 'data/old.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' }],
        },
      ]
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-files-outside-'))
      await fs.writeFile(path.join(outsideDir, 'old.csv'), 'old', 'utf-8')
      await fs.rm(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true, force: true })
      await fs.symlink(outsideDir, path.join(tempDir, 'Alpha', '.files', 'data'))
      projects[0].files = []

      try {
        const { events, onEvent } = collectEvents()
        const pulled = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onEvent })

        expect(pulled.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
        expect(warningsOf(events)).toEqual([expect.stringContaining('deleted in Deepnote but kept locally')])
        expect((await loadSyncManifest(tempDir)).projects.p1?.files?.['data/old.csv']).toBeDefined()
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
      }
    })

    it('reports the files an override dry run would upload instead of pretending to skip them', async () => {
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace({
        ...baseOptions,
        rootDir: tempDir,
        allFiles: true,
        dryRun: true,
        onConflict: 'override',
      })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(result.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
    })

    it('settles each uploaded baseline on disk before the next replacement is marked pending', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [
            { path: 'data/a.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a' },
            { path: 'data/b.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'b' },
          ],
        },
      ]
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'a.csv'), 'a-edited', 'utf-8')
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'b.csv'), 'b-edited', 'utf-8')
      const manifestWrites: string[] = []
      const realWriteFile = fs.writeFile
      const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, ...rest) => {
        if (String(file).endsWith('.deepnote-sync.json')) {
          manifestWrites.push(String(data))
        }
        return realWriteFile.call(fs, file, data, ...rest)
      })

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      writeSpy.mockRestore()

      // While b.csv's replacement is pending on disk, a.csv must already carry its uploaded baseline
      // (the fixture reports uploaded size 7); an interruption here must not read a.csv as pending.
      const states = manifestWrites.map(content => JSON.parse(content).projects.p1)
      expect(states).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pendingFileUploads: ['data/b.csv'],
            files: expect.objectContaining({ 'data/a.csv': expect.objectContaining({ size: 7 }) }),
          }),
        ])
      )
    })

    it('lets a kept re-created conflict fall back to ordinary sync instead of sticking', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          files: [{ path: 'report.csv', size: 4, updatedAt: '2026-01-09T00:00:00.000Z', content: 'mine' }],
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

      // A run interrupted after its own upload landed but before the manifest was saved leaves the
      // path pending against an older baseline, with the cloud copy being ours.
      const manifest = await loadSyncManifest(tempDir)
      const p1 = manifest.projects.p1
      if (!p1) {
        throw new Error('expected project p1 in the manifest')
      }
      p1.pendingFileUploads = ['report.csv']
      p1.files = { ...p1.files, 'report.csv': { size: 3, hash: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' } }
      await saveSyncManifest(tempDir, manifest)
      const uploadsBefore = cloud.uploadedPaths.length

      const kept = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(kept.projects).toEqual([expect.objectContaining({ filesSkipped: 1 })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()

      // With the retry dropped, the next run is an ordinary pull: the cloud copy comes down.
      const recovered = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(recovered.projects).toEqual([expect.objectContaining({ action: 'unchanged', filesDownloaded: 1 })])
      expect(recovered.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths.length).toEqual(uploadsBefore)
    })

    it('treats a pending path re-created in the cloud as a conflict, not a retry', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [{ path: 'report.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' }],
          fileUploadError: { status: 500, message: 'Upload failed' },
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'mine', 'utf-8')

      const failed = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      expect(failed.projects).toEqual([expect.objectContaining({ action: 'error' })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['report.csv'])

      // Another writer put content at the pending path — "our own unfinished delete" no longer holds.
      projects[0].files = [{ path: 'report.csv', size: 6, updatedAt: '2026-01-06T00:00:00.000Z', content: 'theirs' }]
      delete projects[0].fileUploadError
      const uploadsBeforeRetry = cloud.uploadedPaths.length
      const retried = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict: 'skip' })

      expect(retried.projects).toEqual([expect.objectContaining({ filesUploaded: 0, filesSkipped: 1 })])
      expect(cloud.uploadedPaths.length).toEqual(uploadsBeforeRetry)
      // Keeping the cloud copy ends the retry: the path is an ordinary diverged file from here on,
      // so the next pull can bring the cloud copy down instead of the conflict re-raising forever.
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()
    })
  })

  it('rejects a non-canonical local file path before deleting its normalized cloud path', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [{ path: 'report.csv', size: 5, updatedAt: '2026-01-01T00:00:00.000Z', content: 'cloud' }],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', ' report.csv'), 'local', 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'error',
        detail: 'Cannot upload local file with leading or trailing whitespace: " report.csv"',
      }),
    ])
    expect(cloud.deletedPaths).toEqual([])
    expect(cloud.uploadedPaths).toEqual([])
  })

  it('retries a failed file replacement without pruning the local copy', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [{ path: 'data/input.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a,b' }],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'x,y', 'utf-8')
    projects[0].fileUploadError = { status: 500, message: 'Upload failed' }

    const failed = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, prune: true })

    expect(failed.success).toBe(false)
    expect(failed.projects).toEqual([expect.objectContaining({ action: 'error', detail: 'Upload failed' })])
    expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['data/input.csv'])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('x,y')

    // The delete succeeded before the failed upload, so the next detail response omits the file.
    projects[0].files = []
    projects[0].fileUploadError = undefined
    const retried = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, prune: true })

    expect(retried.projects).toEqual([expect.objectContaining({ action: 'unchanged', filesUploaded: 1 })])
    expect(cloud.deletedPaths).toEqual(['p1:data/input.csv', 'p1:data/input.csv'])
    expect(cloud.uploadedPaths).toEqual(['p1:data/input.csv', 'p1:data/input.csv'])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('x,y')
    expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()
  })

  it('rejects and cleans up a file replacement stored under a different path', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [],
        fileUploadPath: 'data/input-20260810-120000.csv',
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.mkdir(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'a,b', 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'error',
        detail: 'Deepnote stored "data/input.csv" at unexpected path "data/input-20260810-120000.csv"',
      }),
    ])
    expect(cloud.deletedPaths).toEqual(['p1:data/input.csv', 'p1:data/input-20260810-120000.csv'])
    expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['data/input.csv'])
  })

  it('treats "changed locally AND in the cloud" as a conflict: override takes the cloud version', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'override' })

    expect(result.projects).toEqual([
      expect.objectContaining({ action: 'pulled', detail: 'conflict resolved: local changes overwritten' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit')
  })

  it('skips a both-sides conflict when no conflict policy is given, keeping the local edit', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
  })

  it('re-throws ExitPromptError so Ctrl+C on a conflict prompt aborts the whole sync', async () => {
    const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
    const onConflict = vi.fn().mockRejectedValueOnce(exitError)
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    projects.push({ id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') })

    // Force a both-sides conflict so the policy is asked, then have it reject like Ctrl+C.
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')

    await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict, concurrency: 1 })).rejects.toBe(
      exitError
    )
    expect(onConflict).toHaveBeenCalled()
    await expect(fs.access(path.join(tempDir, 'Beta'))).rejects.toThrow()
  })

  it('downloads working-directory files incrementally with --all-files', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        files: [
          { path: 'data/input.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a,b' },
          // Hostile inventory entries must be skipped, not written outside the sync root.
          { path: '../escape.txt', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'x' },
        ],
      },
    ]
    const cloud = installCloud(projects)

    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b')
    expect(cloud.downloadedPaths).toEqual(['p1:data/input.csv'])
    await expect(fs.stat(path.join(path.dirname(tempDir), 'escape.txt'))).rejects.toThrow()

    // Unchanged size/updatedAt: the second sync downloads nothing.
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(1)

    // A changed fingerprint re-downloads.
    projects[0].files = [{ path: 'data/input.csv', size: 5, updatedAt: '2026-01-08T00:00:00.000Z', content: 'a,b,c' }]
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(2)
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b,c')
  })

  it('rejects a symbolic-link working-files directory before reading or writing through it', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        files: [{ path: 'report.csv', size: 5, updatedAt: '2026-01-01T00:00:00.000Z', content: 'cloud' }],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-files-outside-'))
    await fs.writeFile(path.join(outsideDir, 'private.txt'), 'private', 'utf-8')
    await fs.symlink(outsideDir, path.join(tempDir, 'Alpha', '.files'))

    try {
      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

      expect(result.projects).toEqual([
        expect.objectContaining({
          action: 'error',
          detail: 'Path "Alpha/.files" contains a symbolic-link ancestor',
        }),
      ])
      expect(cloud.downloadedPaths).toEqual([])
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
      expect(await fs.readFile(path.join(outsideDir, 'private.txt'), 'utf-8')).toBe('private')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects an oversized working-directory file before downloading it', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        files: [
          {
            path: 'large.bin',
            size: MAX_BUFFERED_PROJECT_FILE_BYTES + 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            content: 'small fixture',
          },
        ],
      },
    ]
    const cloud = installCloud(projects)

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'error',
        detail: 'Project file "large.bin" exceeds the 100 MiB --all-files limit.',
      }),
    ])
    expect(cloud.downloadedPaths).toEqual([])
  })

  it('rejects an oversized local working-directory file before uploading it', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [],
      },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const largeFile = path.join(tempDir, 'Alpha', '.files', 'large.bin')
    await fs.mkdir(path.dirname(largeFile), { recursive: true })
    await fs.writeFile(largeFile, '')
    await fs.truncate(largeFile, MAX_BUFFERED_PROJECT_FILE_BYTES + 1)

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'error',
        detail: 'Project file "large.bin" exceeds the 100 MiB --all-files limit.',
      }),
    ])
    expect(cloud.deletedPaths).toEqual([])
    expect(cloud.uploadedPaths).toEqual([])
  })

  it('refuses to prune when no tracked project IDs match the current workspace', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects.splice(0, 1, {
      id: 'p2',
      name: 'Beta',
      notebooks: singleNotebook('p2', '2026-01-03T00:00:00.000Z'),
    })

    await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, prune: true })).rejects.toThrow(
      'Refusing to prune because no project IDs in .deepnote-sync.json match the workspace returned by https://api.example.com. ' +
        'The API token or --url may point to a different workspace. Local files were left unchanged; verify the connection before retrying.'
    )

    expect(cloud.importCalls).toEqual([])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
    await expect(fs.stat(path.join(tempDir, 'Beta'))).rejects.toThrow()
    expect((await loadSyncManifest(tempDir)).projects.p1?.dir).toBe('Alpha')
  })

  it('keeps local directories for projects that left the cloud, unless --prune opts into deletion', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
      { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    projects.splice(0, 1)
    const kept = await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    expect(kept.projects).toEqual([
      expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      expect.objectContaining({ projectId: 'p1', action: 'missing-in-cloud' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('p1')

    const pruned = await syncWorkspace({ ...baseOptions, rootDir: tempDir, prune: true })
    expect(pruned.projects).toEqual([
      expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      expect.objectContaining({ projectId: 'p1', action: 'pruned' }),
    ])
    await expect(fs.stat(path.join(tempDir, 'Alpha'))).rejects.toThrow()
    expect(Object.keys((await loadSyncManifest(tempDir)).projects)).toEqual(['p2'])
  })

  it('does not prune a directory reused by a recreated cloud project', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
      { id: 'p3', name: 'Beta', notebooks: singleNotebook('p3', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects.splice(0, 1, {
      id: 'p2',
      name: 'Alpha',
      notebooks: singleNotebook('p2', '2026-01-03T00:00:00.000Z'),
    })

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'skip', prune: true })

    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p2', action: 'skipped-conflict' }),
      expect.objectContaining({ projectId: 'p3', action: 'unchanged' }),
      expect.objectContaining({ projectId: 'p1', action: 'missing-in-cloud' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
    expect(Object.keys((await loadSyncManifest(tempDir)).projects)).toEqual(['p3'])
  })

  it('moves the local directory when the project was renamed in the cloud', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    projects[0].name = 'Gamma'
    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.projects).toEqual([
      expect.objectContaining({ action: 'unchanged', path: 'Gamma', detail: 'moved from Alpha' }),
    ])
    await expect(fs.stat(path.join(tempDir, 'Alpha'))).rejects.toThrow()
    expect(await fs.readFile(path.join(tempDir, 'Gamma', 'main.deepnote'), 'utf-8')).toContain('p1')
  })

  it('does not adopt an occupied destination when the tracked directory is missing', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    const cloud = installCloud(projects)
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    await fs.rm(path.join(tempDir, 'Alpha'), { recursive: true })
    projects[0].folder = { id: 'f1', name: 'Team', path: [{ id: 'f1', name: 'Team' }] }
    const unrelated = notebookYaml('other-project', 'other-notebook', '2026-01-03T00:00:00.000Z', 'unrelated')
    await fs.mkdir(path.join(tempDir, 'Team', 'Alpha'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Team', 'Alpha', 'main.deepnote'), unrelated, 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict: 'skip' })

    expect(result.projects).toEqual([
      expect.objectContaining({
        action: 'skipped-conflict',
        detail: 'untracked local directory differs from the cloud',
      }),
    ])
    expect(cloud.importCalls).toEqual([])
    expect(await fs.readFile(path.join(tempDir, 'Team', 'Alpha', 'main.deepnote'), 'utf-8')).toBe(unrelated)
    expect((await loadSyncManifest(tempDir)).projects.p1?.dir).toBe('Alpha')
  })

  it('reports untracked local .deepnote files without touching them', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
    await fs.writeFile(path.join(tempDir, 'stray.deepnote'), 'version: 1.0.0\n', 'utf-8')

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.untrackedFiles).toEqual(['stray.deepnote'])
    expect(await fs.readFile(path.join(tempDir, 'stray.deepnote'), 'utf-8')).toBe('version: 1.0.0\n')
  })

  it('writes nothing at all in a dry run', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
    const missingRoot = path.join(tempDir, 'missing')

    const result = await syncWorkspace({ ...baseOptions, rootDir: missingRoot, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    await expect(fs.stat(missingRoot)).rejects.toThrow()
  })

  it('resolves a relative rootDir against the working directory', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])

    const result = await syncWorkspace({ ...baseOptions, rootDir: path.relative(process.cwd(), tempDir) })

    expect(result.root).toBe(tempDir)
  })

  it('isolates a failing project so the rest of the workspace still syncs', async () => {
    installCloud([
      { id: 'p-bad', name: 'Bad', notebooks: [], exportFails: true },
      { id: 'p-good', name: 'Good', notebooks: singleNotebook('p-good', '2026-01-02T00:00:00.000Z') },
    ])

    const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir })

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p-bad', action: 'error', detail: 'Project is suspended' }),
      expect.objectContaining({ projectId: 'p-good', action: 'pulled' }),
    ])
  })

  it.each([0, -1, 0.5, Number.NaN])(
    'rejects concurrency %s with a RangeError before creating the root or calling the API',
    async concurrency => {
      installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
      const rootDir = path.join(tempDir, 'missing')

      const rejection = syncWorkspace({ ...baseOptions, rootDir, concurrency })

      await expect(rejection).rejects.toBeInstanceOf(RangeError)
      await expect(rejection).rejects.toThrow('concurrency must be a positive integer')
      expect(fetch).not.toHaveBeenCalled()
      await expect(fs.stat(rootDir)).rejects.toThrow()
    }
  )

  it('never reads or writes process.env, even with a .env holding DEEPNOTE_TOKEN in the root', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
    await fs.writeFile(path.join(tempDir, '.env'), 'DEEPNOTE_TOKEN=token-from-dotenv\n', 'utf-8')
    vi.stubEnv('DEEPNOTE_TOKEN', undefined)
    try {
      const before = { ...process.env }

      await syncWorkspace({ ...baseOptions, rootDir: tempDir })

      expect(process.env).toEqual(before)
      const authorizations = vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization)
      expect(new Set(authorizations)).toEqual(new Set(['Bearer tok-1']))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports listing, file transfers and project outcomes as events', async () => {
    const projects: CloudProject[] = [
      {
        id: 'p1',
        name: 'Alpha',
        notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [{ path: 'data/input.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a,b' }],
      },
    ]
    installCloud(projects)

    const pulled = collectEvents()
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onEvent: pulled.onEvent })

    expect(pulled.events).toEqual([
      { kind: 'listing-projects', baseUrl: API_URL },
      { kind: 'file-transferred', direction: 'download', projectName: 'Alpha', path: 'data/input.csv', bytes: 3 },
      {
        kind: 'project-outcome',
        outcome: { projectId: 'p1', name: 'Alpha', path: 'Alpha', action: 'pulled', filesDownloaded: 1 },
      },
    ])

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    // Five bytes, so the event's size is neither the fixture's stored size (7) nor the old one (3).
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'x,y,z', 'utf-8')
    const pushed = collectEvents()
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onEvent: pushed.onEvent })

    expect(pushed.events).toEqual([
      { kind: 'listing-projects', baseUrl: API_URL },
      { kind: 'file-transferred', direction: 'upload', projectName: 'Alpha', path: 'data/input.csv', bytes: 5 },
      {
        kind: 'project-outcome',
        outcome: expect.objectContaining({ projectId: 'p1', action: 'pushed', filesUploaded: 1 }),
      },
    ])

    projects.splice(0, 1)
    const missing = collectEvents()
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, onEvent: missing.onEvent })

    expect(outcomesOf(missing.events)).toEqual([
      expect.objectContaining({ projectId: 'p1', path: 'Alpha', action: 'missing-in-cloud' }),
    ])
  })

  it('reports the file uploads a dry run would make as events', async () => {
    const cloud = installCloud([
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'), files: [] },
    ])
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.mkdir(path.join(tempDir, 'Alpha', '.files'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'one.csv'), 'abc', 'utf-8')

    const { events, onEvent } = collectEvents()
    await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, dryRun: true, onEvent })

    expect(events).toContainEqual({
      kind: 'file-transferred',
      direction: 'upload',
      projectName: 'Alpha',
      path: 'one.csv',
      bytes: 3,
    })
    expect(cloud.uploadedPaths).toEqual([])
  })

  it('treats a string policy other than override as skip', async () => {
    const cloud = installCloud([
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ])
    await syncWorkspace({ ...baseOptions, rootDir: tempDir })
    await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))

    const result = await syncWorkspace({
      ...baseOptions,
      rootDir: tempDir,
      deleteMissingNotebooks: true,
      onConflict: 'ask' as SyncConflictDecision,
    })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(cloud.importCalls).toEqual([])
  })

  describe('conflicts asked of a function policy', () => {
    const skipAll = () => vi.fn(async (_conflict: SyncConflict) => 'skip' as const)

    it('asks about an empty local directory before it deletes every cloud notebook', async () => {
      installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, deleteMissingNotebooks: true, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'empty-local-directory', projectId: 'p1', projectName: 'Alpha' }],
      ])
    })

    it('asks about a push that the cloud rejected as changed after the local edit', async () => {
      installCloud([
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          importConflict: 'always',
        },
      ])
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'cloud-changed-after-local-edit', projectId: 'p1', projectName: 'Alpha' }],
      ])
    })

    it('asks about a tracked project changed on both sides', async () => {
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'changed-on-both-sides', projectId: 'p1', projectName: 'Alpha', projectDir: 'Alpha' }],
      ])
    })

    it('asks about an untracked local directory that differs from the cloud', async () => {
      installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
      await fs.mkdir(path.join(tempDir, 'Alpha'))
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'untracked'),
        'utf-8'
      )
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'untracked-local-directory', projectId: 'p1', projectName: 'Alpha', projectDir: 'Alpha' }],
      ])
    })

    it('names a tracked project changed on both sides by its folder-relative directory', async () => {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          folder: teamFolder,
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        },
      ]
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      await fs.writeFile(
        path.join(tempDir, 'Team', 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'changed-on-both-sides', projectId: 'p1', projectName: 'Alpha', projectDir: 'Team/Alpha' }],
      ])
    })

    it('names an untracked local directory by its folder-relative directory', async () => {
      installCloud([
        {
          id: 'p1',
          name: 'Alpha',
          folder: teamFolder,
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
        },
      ])
      await fs.mkdir(path.join(tempDir, 'Team', 'Alpha'), { recursive: true })
      await fs.writeFile(
        path.join(tempDir, 'Team', 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'untracked'),
        'utf-8'
      )
      const onConflict = skipAll()

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

      expect(onConflict.mock.calls).toEqual([
        [{ kind: 'untracked-local-directory', projectId: 'p1', projectName: 'Alpha', projectDir: 'Team/Alpha' }],
      ])
    })

    it('pulls the cloud version when the function answers override', async () => {
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')

      const result = await syncWorkspace({
        ...baseOptions,
        rootDir: tempDir,
        onConflict: async () => 'override',
      })

      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'pulled', detail: 'conflict resolved: local changes overwritten' }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit')
    })

    // Answers outside SyncConflictDecision, as an untyped (JS or MCP) caller could give them.
    describe.each([undefined, 'OVERRIDE', 'maybe'])('when the function answers %j', answer => {
      const onConflict = async (_conflict: SyncConflict) => answer as SyncConflictDecision

      it('keeps every cloud notebook of an empty local directory', async () => {
        const cloud = installCloud([
          { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        ])
        await syncWorkspace({ ...baseOptions, rootDir: tempDir })
        await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))

        const result = await syncWorkspace({
          ...baseOptions,
          rootDir: tempDir,
          deleteMissingNotebooks: true,
          onConflict,
        })

        expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
        expect(cloud.importCalls).toEqual([])
      })

      it('does not force a push the cloud rejected', async () => {
        const cloud = installCloud([
          {
            id: 'p1',
            name: 'Alpha',
            notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
            importConflict: 'unless-forced',
          },
        ])
        await syncWorkspace({ ...baseOptions, rootDir: tempDir })
        await fs.writeFile(
          path.join(tempDir, 'Alpha', 'main.deepnote'),
          notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
          'utf-8'
        )

        const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })

        expect(result.projects).toEqual([
          expect.objectContaining({ action: 'skipped-conflict', detail: 'cloud changed after the local edit' }),
        ])
        expect(cloud.importCalls).toHaveLength(1)
      })
    })
  })

  describe('parallel projects', () => {
    /** A promise the test settles by hand, to order concurrent work without timers. */
    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve = () => {}
      const promise = new Promise<void>(settle => {
        resolve = settle
      })
      return { promise, resolve }
    }

    /** Wraps the installed cloud fetch so `hold` can see each request and pause it on a promise. */
    function holdRequests(hold: (url: URL) => unknown): void {
      const inner = vi.mocked(fetch).getMockImplementation() as typeof fetch
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        await hold(new URL(String(url)))
        return inner(url, init)
      })
    }

    const projectsNamed = (...names: string[]): CloudProject[] =>
      names.map(name => ({ id: `p-${name}`, name, notebooks: singleNotebook(`p-${name}`, '2026-01-02T00:00:00.000Z') }))

    /** Leaves projects A and B edited both locally and in the cloud; C and D unchanged. */
    async function setUpTwoConflicts(): Promise<void> {
      const projects = projectsNamed('A', 'B', 'C', 'D')
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      for (const project of projects.slice(0, 2)) {
        project.notebooks = singleNotebook(project.id, '2026-01-07T00:00:00.000Z', 'cloud-edit')
        const localEdit = notebookYaml(project.id, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
        await fs.writeFile(path.join(tempDir, project.name, 'main.deepnote'), localEdit, 'utf-8')
      }
    }

    /** Resolves after the microtasks queued so far have run: an unchanged project's work after its
     * export response is all microtasks, so this lets it finish. */
    const afterQueuedMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve))

    /** Records how many projects are in progress each time one's export starts. A project starts
     * with a symbolic-link check of its directory and ends when its outcome event arrives. */
    function sampleProjectsInProgress(dirs: readonly string[]): {
      samples: number[]
      onEvent: (event: SyncEvent) => void
    } {
      vi.mocked(assertNoSymbolicLinkAncestors).mockClear()
      let finished = 0
      const samples: number[] = []
      holdRequests(url => {
        if (!url.pathname.endsWith('/export')) return
        const started = vi
          .mocked(assertNoSymbolicLinkAncestors)
          .mock.calls.filter(([, relativePath]) => dirs.includes(relativePath)).length
        samples.push(started - finished)
      })
      return {
        samples,
        onEvent: event => {
          if (event.kind === 'project-outcome' && /pulled|unchanged/.test(event.outcome.action)) finished++
        },
      }
    }

    it.each([
      { concurrency: undefined, expected: 8 },
      { concurrency: 3, expected: 3 },
    ])('syncs at most $expected projects at once (--concurrency $concurrency)', async ({ concurrency, expected }) => {
      const names = 'ABCDEFGHIJKL'.split('')
      installCloud(projectsNamed(...names))
      const { samples, onEvent } = sampleProjectsInProgress(names)

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, concurrency, onEvent })

      expect(Math.max(...samples)).toBe(expected)
      expect(result.projects.map(outcome => outcome.action)).toEqual(Array(names.length).fill('pulled'))
    })

    it('syncs one project at a time when a tracked project directory moves', async () => {
      const projects = projectsNamed('A', 'B', 'C')
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      projects[1].name = 'Renamed'
      const { samples, onEvent } = sampleProjectsInProgress(['A', 'C', 'Renamed'])

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onEvent })

      expect(samples).toEqual([1, 1, 1])
      expect(result.projects).toContainEqual(expect.objectContaining({ path: 'Renamed', detail: 'moved from B' }))
    })

    it('reports outcomes sorted by path regardless of completion order', async () => {
      installCloud(projectsNamed('C', 'A', 'B'))
      const { events, onEvent: collect } = collectEvents()
      const othersDone = deferred()
      const onEvent = (event: SyncEvent) => {
        collect(event)
        if (outcomesOf(events).filter(outcome => /^[BC]$/.test(outcome.path)).length === 2) othersDone.resolve()
      }
      // A finishes last: its export waits until B and C have reported their outcomes.
      holdRequests(url => (url.pathname === '/v2/projects/p-A/export' ? othersDone.promise : undefined))

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onEvent })

      expect(outcomesOf(events).at(-1)).toMatchObject({ action: 'pulled', path: 'A' })
      expect(result.projects.map(outcome => outcome.path)).toEqual(['A', 'B', 'C'])
    })

    it('opens one conflict prompt at a time and holds progress lines while it is open', async () => {
      await setUpTwoConflicts()
      const { events, onEvent } = collectEvents()
      // C and D export only once the first prompt is open, so they finish while it is.
      const promptOpen = deferred()
      const exported = { 'p-C': deferred(), 'p-D': deferred() }
      const inner = vi.mocked(fetch).getMockImplementation() as typeof fetch
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const projectId = String(url).match(/\/v2\/projects\/(p-[CD])\/export$/)?.[1] as keyof typeof exported
        if (!projectId) return inner(url, init)
        await promptOpen.promise
        if (projectId === 'p-D') {
          // D finishes after C, so the order the held outcomes are delivered in is not left to chance.
          await exported['p-C'].promise
          await afterQueuedMicrotasks()
        }
        const response = await inner(url, init)
        exported[projectId].resolve()
        return response
      })
      let open = 0
      let peakOpen = 0
      const eventsWhileOpen: SyncEvent[] = []
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        peakOpen = Math.max(peakOpen, ++open)
        const before = events.length
        promptOpen.resolve()
        await Promise.all([exported['p-C'].promise, exported['p-D'].promise])
        await afterQueuedMicrotasks()
        eventsWhileOpen.push(...events.slice(before))
        open--
        return 'skip' as const
      })

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict, onEvent })

      expect(onConflict).toHaveBeenCalledTimes(2)
      expect(peakOpen).toBe(1)
      expect(eventsWhileOpen).toEqual([])
      expect(outcomesOf(events).filter(outcome => outcome.action === 'unchanged')).toHaveLength(2)
      expect(
        outcomesOf(events)
          .filter(outcome => outcome.action === 'unchanged')
          .map(outcome => outcome.path)
      ).toEqual(['C', 'D'])
      expect(result.projects.map(outcome => outcome.action)).toEqual([
        'skipped-conflict',
        'skipped-conflict',
        'unchanged',
        'unchanged',
      ])
    })

    it('still delivers the events held while a policy call that then rejects was pending', async () => {
      await setUpTwoConflicts()
      const promptOpen = deferred()
      const atExport = { 'p-C': deferred(), 'p-D': deferred() }
      holdRequests(url => {
        const projectId = url.pathname.match(/^\/v2\/projects\/(p-[CD])\/export$/)?.[1] as keyof typeof atExport
        if (!projectId) return
        atExport[projectId].resolve()
        return promptOpen.promise
      })
      const policyError = new Error('policy failed')
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        await Promise.all([atExport['p-C'].promise, atExport['p-D'].promise])
        promptOpen.resolve()
        // C and D finish within this turn, while their events are held.
        await afterQueuedMicrotasks()
        throw policyError
      })
      const { events, onEvent } = collectEvents()

      await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict, onEvent })).rejects.toBe(policyError)

      expect(
        outcomesOf(events)
          .map(outcome => outcome.path)
          .sort()
      ).toEqual(['C', 'D'])
    })

    it('holds warnings from other projects while a conflict prompt is open', async () => {
      const projects = projectsNamed('A', 'C').map(project => ({ ...project, files: [] as CloudFile[] }))
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      projects[0].notebooks = singleNotebook('p-A', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      const localEdit = notebookYaml('p-A', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
      await fs.writeFile(path.join(tempDir, 'A', 'main.deepnote'), localEdit, 'utf-8')
      // C warns about the unsafe path, then downloads the safe file after it.
      projects[1].files = [
        { path: '../evil.csv', size: 1, updatedAt: '2026-01-07T00:00:00.000Z', content: 'x' },
        { path: 'data.csv', size: 1, updatedAt: '2026-01-07T00:00:00.000Z', content: 'y' },
      ]
      const promptOpen = deferred()
      const cWarned = deferred()
      holdRequests(url => {
        if (url.pathname === '/v2/projects/p-C') return promptOpen.promise
        if (url.searchParams.get('path') === 'data.csv') cWarned.resolve()
      })
      const { events, onEvent } = collectEvents()
      const eventsWhileOpen: SyncEvent[] = []
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        const before = events.length
        promptOpen.resolve()
        await cWarned.promise
        eventsWhileOpen.push(...events.slice(before))
        return 'skip' as const
      })

      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict, onEvent })

      expect(eventsWhileOpen).toEqual([])
      expect(warningsOf(events)).toEqual(['Skipping file with unsafe path in "C": ../evil.csv'])
      // Flushed in the order they were emitted.
      expect(events.filter(event => event.kind === 'warning' || event.kind === 'file-transferred')).toEqual([
        { kind: 'warning', message: 'Skipping file with unsafe path in "C": ../evil.csv' },
        { kind: 'file-transferred', direction: 'download', projectName: 'C', path: 'data.csv', bytes: 1 },
      ])
    })

    it('opens no further prompt after Ctrl+C on the first one', async () => {
      await setUpTwoConflicts()
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      const onConflict = vi.fn().mockRejectedValue(exitError)

      await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })).rejects.toBe(exitError)

      expect(onConflict).toHaveBeenCalledTimes(1)
    })

    it('rejects with the error a function policy throws synchronously', async () => {
      await setUpTwoConflicts()
      const policyError = new Error('policy failed')
      const onConflict = vi.fn((_conflict: SyncConflict): Promise<SyncConflictDecision> => {
        throw policyError
      })

      await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })).rejects.toBe(policyError)

      expect(onConflict).toHaveBeenCalledTimes(1)
    })

    it('starts no cloud write after Ctrl+C and keeps the manifest of finished projects', async () => {
      const [a, b, c] = projectsNamed('A', 'B', 'C')
      const installed = installCloud([a, b, c])
      await syncWorkspace({ ...baseOptions, rootDir: tempDir })
      // A conflicts, B has only a local edit (a push), C has only a cloud edit (a pull).
      for (const project of [a, c]) {
        project.notebooks = singleNotebook(project.id, '2026-01-07T00:00:00.000Z', 'cloud-edit')
      }
      for (const name of ['A', 'B']) {
        const localEdit = notebookYaml(`p-${name}`, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
        await fs.writeFile(path.join(tempDir, name, 'main.deepnote'), localEdit, 'utf-8')
      }
      const cPulled = deferred()
      const bExporting = deferred()
      const releaseB = deferred()
      holdRequests(url => {
        if (url.pathname === '/v2/projects/p-A/export') return cPulled.promise
        if (url.pathname === '/v2/projects/p-B/export') {
          bExporting.resolve()
          return releaseB.promise
        }
      })
      const onEvent = (event: SyncEvent) => {
        if (event.kind === 'project-outcome' && event.outcome.action === 'pulled' && event.outcome.path === 'C') {
          cPulled.resolve()
        }
      }
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        await bExporting.promise
        // B's export returns from `setImmediate`, after the rejection below has settled.
        setImmediate(releaseB.resolve)
        throw exitError
      })

      await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict, onEvent })).rejects.toBe(exitError)

      expect(installed.importCalls).toEqual([])
      const manifest = await loadSyncManifest(tempDir)
      expect(manifest.projects['p-C'].modifiedAt).toBe('2026-01-07T00:00:00.000Z')
      expect(manifest.projects['p-B'].modifiedAt).toBe('2026-01-02T00:00:00.000Z')
    })

    it('starts no file replacement when Ctrl+C lands while its pending mark is saved', async () => {
      const [a, b] = projectsNamed('A', 'B').map(project => ({
        ...project,
        notebooksAfterImport: singleNotebook(project.id, '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [] as CloudFile[],
      }))
      const installed = installCloud([a, b])
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      // A conflicts; B pushes, then replaces one working file.
      a.notebooks = singleNotebook('p-A', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      for (const name of ['A', 'B']) {
        const localEdit = notebookYaml(`p-${name}`, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
        await fs.writeFile(path.join(tempDir, name, 'main.deepnote'), localEdit, 'utf-8')
      }
      await fs.mkdir(path.join(tempDir, 'B', '.files'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'B', '.files', 'one.csv'), 'a', 'utf-8')
      const actual = await vi.importActual<typeof syncManifest>('./sync-manifest')
      const bSaving = deferred()
      const releaseSave = deferred()
      vi.mocked(saveSyncManifest).mockImplementation(async (...args) => {
        bSaving.resolve()
        await releaseSave.promise
        await actual.saveSyncManifest(...args)
      })
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        await bSaving.promise
        // B's save finishes from `setImmediate`, after the rejection below has settled.
        setImmediate(releaseSave.resolve)
        throw exitError
      })

      try {
        await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, onConflict })).rejects.toBe(
          exitError
        )

        expect(installed.deletedPaths).toEqual([])
        expect(installed.uploadedPaths).toEqual([])
      } finally {
        vi.mocked(saveSyncManifest).mockImplementation(actual.saveSyncManifest)
      }
    })

    it('never calls a function policy in a dry run, where every conflict is skipped', async () => {
      await setUpTwoConflicts()
      const onConflict = vi.fn(async (_conflict: SyncConflict) => 'override' as const)

      const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, dryRun: true, onConflict })

      expect(onConflict).not.toHaveBeenCalled()
      expect(result.projects.map(outcome => [outcome.path, outcome.action])).toEqual([
        ['A', 'skipped-conflict'],
        ['B', 'skipped-conflict'],
        ['C', 'unchanged'],
        ['D', 'unchanged'],
      ])
    })

    it('rejects only once every worker has settled', async () => {
      await setUpTwoConflicts()
      const releaseC = deferred()
      holdRequests(url => (url.pathname === '/v2/projects/p-C/export' ? releaseC.promise : undefined))
      const policyRejected = deferred()
      const policyError = new Error('policy failed')
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        policyRejected.resolve()
        throw policyError
      })
      const { events, onEvent } = collectEvents()
      const actual = await vi.importActual<typeof syncManifest>('./sync-manifest')
      // Instant, so only the still-running worker can hold the rejection back.
      vi.mocked(saveSyncManifest).mockResolvedValue(undefined)
      try {
        const run = syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict, onEvent })
        const settled = vi.fn()
        run.then(settled, settled)
        await policyRejected.promise
        await afterQueuedMicrotasks()

        expect(settled).not.toHaveBeenCalled()

        releaseC.resolve()
        await expect(run).rejects.toBe(policyError)
        expect(outcomesOf(events)).toContainEqual(expect.objectContaining({ path: 'C', action: 'unchanged' }))
      } finally {
        vi.mocked(saveSyncManifest).mockImplementation(actual.saveSyncManifest)
      }
    })

    it('rejects with the policy error when the final manifest save fails', async () => {
      await setUpTwoConflicts()
      const policyError = new Error('policy failed')
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        throw policyError
      })
      const actual = await vi.importActual<typeof syncManifest>('./sync-manifest')
      vi.mocked(saveSyncManifest).mockClear()
      vi.mocked(saveSyncManifest).mockRejectedValue(new Error('disk full'))
      try {
        await expect(syncWorkspace({ ...baseOptions, rootDir: tempDir, onConflict })).rejects.toBe(policyError)

        expect(saveSyncManifest).toHaveBeenCalledTimes(1)
      } finally {
        vi.mocked(saveSyncManifest).mockImplementation(actual.saveSyncManifest)
      }
    })

    it('finishes a started file replacement after the policy rejects, and starts no other', async () => {
      const [a, b] = projectsNamed('A', 'B').map(project => ({
        ...project,
        notebooksAfterImport: singleNotebook(project.id, '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [] as CloudFile[],
      }))
      const installed = installCloud([a, b])
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      // A conflicts; B pushes, then replaces two new working files one after the other.
      a.notebooks = singleNotebook('p-A', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      for (const name of ['A', 'B']) {
        const localEdit = notebookYaml(`p-${name}`, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
        await fs.writeFile(path.join(tempDir, name, 'main.deepnote'), localEdit, 'utf-8')
      }
      await fs.mkdir(path.join(tempDir, 'B', '.files'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'B', '.files', 'one.csv'), 'a', 'utf-8')
      await fs.writeFile(path.join(tempDir, 'B', '.files', 'two.csv'), 'b', 'utf-8')
      const deleteSent = deferred()
      const policyRejected = deferred()
      holdRequests(url => {
        const isDeleteOfOne =
          url.pathname === '/v2/files' &&
          url.searchParams.get('projectId') === 'p-B' &&
          url.searchParams.get('path') === 'one.csv'
        if (!isDeleteOfOne) return
        deleteSent.resolve()
        return policyRejected.promise
      })
      const policyError = new Error('policy failed')
      const onConflict = vi.fn(async (_conflict: SyncConflict) => {
        await deleteSent.promise
        // B's delete is released from `setImmediate`, after the rejection below has settled.
        setImmediate(policyRejected.resolve)
        throw policyError
      })

      await expect(
        syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true, concurrency: 2, onConflict })
      ).rejects.toBe(policyError)

      expect(onConflict).toHaveBeenCalledTimes(1)
      expect(installed.deletedPaths).toEqual(['p-B:one.csv'])
      expect(installed.uploadedPaths).toEqual(['p-B:one.csv'])
      const record = (await loadSyncManifest(tempDir)).projects['p-B']
      expect(Object.keys(record.files ?? {})).toEqual(['one.csv'])
      expect(record.pendingFileUploads).toBeUndefined()
    })

    it('never overlaps two manifest saves', async () => {
      const projects = projectsNamed('A', 'B').map(project => ({
        ...project,
        notebooksAfterImport: singleNotebook(project.id, '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [],
      }))
      installCloud(projects)
      await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })
      for (const name of ['A', 'B']) {
        const localEdit = notebookYaml(`p-${name}`, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
        await fs.writeFile(path.join(tempDir, name, 'main.deepnote'), localEdit, 'utf-8')
        await fs.mkdir(path.join(tempDir, name, '.files'), { recursive: true })
        await fs.writeFile(path.join(tempDir, name, '.files', 'one.csv'), 'a', 'utf-8')
        await fs.writeFile(path.join(tempDir, name, '.files', 'two.csv'), 'b', 'utf-8')
      }
      const actual = await vi.importActual<typeof syncManifest>('./sync-manifest')
      let saving = 0
      let peakSaving = 0
      vi.mocked(saveSyncManifest).mockClear()
      vi.mocked(saveSyncManifest).mockImplementation(async (...args) => {
        peakSaving = Math.max(peakSaving, ++saving)
        await new Promise(resolve => setTimeout(resolve, 5))
        await actual.saveSyncManifest(...args)
        saving--
      })
      try {
        const result = await syncWorkspace({ ...baseOptions, rootDir: tempDir, allFiles: true })

        expect(result.projects).toEqual([
          expect.objectContaining({ action: 'pushed', filesUploaded: 2 }),
          expect.objectContaining({ action: 'pushed', filesUploaded: 2 }),
        ])
        // Two saves per uploaded file (mark it pending, then settle it) and the final one.
        expect(saveSyncManifest).toHaveBeenCalledTimes(2 * 2 * 2 + 1)
        expect(peakSaving).toBe(1)
      } finally {
        vi.mocked(saveSyncManifest).mockImplementation(actual.saveSyncManifest)
      }
    })
  })
})

describe('describeCloudFileDivergence', () => {
  const baseline = { size: 3, hash: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' }
  const remote = { path: 'f', size: 3, updatedAt: '2026-01-01T00:00:00.000Z' }

  it('reports nothing when the cloud copy still matches the baseline', () => {
    expect(describeCloudFileDivergence(baseline, remote)).toBeUndefined()
  })

  it('reports a newer timestamp', () => {
    expect(describeCloudFileDivergence(baseline, { ...remote, updatedAt: '2026-01-05T00:00:00.000Z' })).toBe(
      'changed in Deepnote'
    )
  })

  it('reports a changed size even at the same timestamp', () => {
    expect(describeCloudFileDivergence(baseline, { ...remote, size: 9 })).toBe('changed in Deepnote')
  })

  it('reports a cloud copy that is gone', () => {
    expect(describeCloudFileDivergence(baseline, undefined)).toBe('was deleted in Deepnote')
  })

  it('reports an untracked local path that the cloud also holds', () => {
    expect(describeCloudFileDivergence(undefined, remote)).toBe('exists in Deepnote but was never synced here')
  })

  it('reports nothing for a local-only path', () => {
    expect(describeCloudFileDivergence(undefined, undefined)).toBeUndefined()
  })

  it('cannot verify a baseline recorded before updatedAt was tracked, so allows the overwrite', () => {
    expect(
      describeCloudFileDivergence({ size: 3 }, { ...remote, updatedAt: '2026-01-05T00:00:00.000Z' })
    ).toBeUndefined()
  })
})

describe('classifySyncStep', () => {
  const record = { dir: 'Alpha', notebooks: ['main.deepnote'], contentHash: 'base' }

  it('pulls when there is no local directory', () => {
    expect(classifySyncStep({ localHash: null, exportHash: 'x', record })).toBe('pull')
  })

  it('is a noop when local and cloud content match, even untracked', () => {
    expect(classifySyncStep({ localHash: 'x', exportHash: 'x', record: undefined })).toBe('noop')
  })

  it('conflicts on an untracked local directory that differs from the cloud', () => {
    expect(classifySyncStep({ localHash: 'local', exportHash: 'cloud', record: undefined })).toBe('conflict')
  })

  it('separates push, pull, and conflict by comparing both sides to the last-synced hash', () => {
    expect(classifySyncStep({ localHash: 'edited', exportHash: 'base', record })).toBe('push')
    expect(classifySyncStep({ localHash: 'base', exportHash: 'moved', record })).toBe('pull')
    expect(classifySyncStep({ localHash: 'edited', exportHash: 'moved', record })).toBe('conflict')
  })
})

describe('canonicalProjectHash', () => {
  it('matches the cross-side ordinal filename-order digest', () => {
    const files = [
      { filename: 'y.deepnote', content: 'y' },
      { filename: 'j.deepnote', content: 'j' },
      { filename: 'Z.deepnote', content: 'upper' },
      { filename: 'a.deepnote', content: 'lower' },
    ]

    expect(canonicalProjectHash(files)).toBe('56fb700fb72af7c378984c5112600be3b77a56770eaae6691f36662039955778')
  })

  it('is independent of archive entry order', () => {
    const a = { filename: 'a.deepnote', content: 'aaa' }
    const b = { filename: 'b.deepnote', content: 'bbb' }
    expect(canonicalProjectHash([a, b])).toBe(canonicalProjectHash([b, a]))
  })

  it('changes when any document content changes', () => {
    const base = [{ filename: 'main.deepnote', content: 'x' }]
    const edited = [{ filename: 'main.deepnote', content: 'y' }]
    expect(canonicalProjectHash(edited)).not.toBe(canonicalProjectHash(base))
  })
})

describe('readExportModifiedAt', () => {
  it('reads metadata.modifiedAt without validating the whole document', () => {
    expect(readExportModifiedAt(notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z'))).toBe(
      '2026-01-02T00:00:00.000Z'
    )
  })

  it('returns undefined for documents it cannot read', () => {
    expect(readExportModifiedAt('not yaml: [')).toBeUndefined()
    expect(readExportModifiedAt('version: 1.0.0\n')).toBeUndefined()
    expect(readExportModifiedAt(undefined)).toBeUndefined()
  })
})
