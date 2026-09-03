import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_BUFFERED_PROJECT_FILE_BYTES } from '@deepnote/cloud'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { loadSyncManifest } from '../utils/sync-manifest'
import {
  canonicalProjectHash,
  classifySyncStep,
  describeCloudFileDivergence,
  readExportModifiedAt,
  syncWorkspace,
} from './sync'

// `select` is mocked so a conflict prompt can be driven (e.g. simulate a Ctrl+C rejection). Tests
// that resolve conflicts non-interactively (`--on-conflict skip|override`, or no TTY) never call it.
vi.mock('@inquirer/prompts', () => ({ select: vi.fn() }))

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
  setOutputConfig({ quiet: true, color: false, debug: false })
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetOutputConfig()
  await fs.rm(tempDir, { recursive: true, force: true })
})

const baseOptions = { url: API_URL, token: TOKEN }

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

    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'setup.deepnote'), 'utf-8')).toContain('nb-setup')

    // The cloud drops the setup notebook: the next pull deletes its stale local file.
    projects[0].notebooks = [
      { filename: 'main.deepnote', content: notebookYaml('p1', 'nb-main', '2026-01-05T00:00:00.000Z', 'edit') },
    ]
    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

    projects[0].notebooks = [
      {
        filename: 'Report.deepnote',
        content: notebookYaml('p1', 'nb-main', '2026-01-05T00:00:00.000Z', 'cloud-edit'),
      },
    ]
    const renameSpy = vi.spyOn(fs, 'rename')
    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
  })

  it('pulls a cloud edit over an unmodified local project', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)
    projects[0].notebooks = singleNotebook('p1', '2026-01-05T00:00:00.000Z', 'cloud-edit')

    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

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

    const pushed = await syncWorkspace(tempDir, baseOptions)

    expect(pushed.projects).toEqual([expect.objectContaining({ action: 'pushed', path: 'Alpha' })])
    expect(cloud.importCalls).toHaveLength(1)
    expect(cloud.importCalls[0].documents).toEqual(
      Object.fromEntries(edited.map(file => [file.filename, file.content]))
    )
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(canonical[0].content)
    await expect(fs.stat(path.join(tempDir, 'Renamed project'))).rejects.toThrow()

    const moved = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))
    const result = await syncWorkspace(tempDir, {
      ...baseOptions,
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
    await syncWorkspace(tempDir, baseOptions)

    await fs.rm(path.join(tempDir, 'Alpha', 'main.deepnote'))
    const result = await syncWorkspace(tempDir, {
      ...baseOptions,
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
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'skip' })

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
    await syncWorkspace(tempDir, baseOptions)
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'skip' })

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
    await syncWorkspace(tempDir, baseOptions)

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'override' })

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
    await syncWorkspace(tempDir, baseOptions)
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)
    const baselineHash = (await loadSyncManifest(tempDir)).projects.p1?.contentHash
    for (const file of edited) {
      await fs.writeFile(path.join(tempDir, 'Alpha', file.filename), file.content, 'utf-8')
    }

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'error', detail: message })])
    expect(cloud.importCalls).toHaveLength(1)
    for (const file of edited) {
      expect(await fs.readFile(path.join(tempDir, 'Alpha', file.filename), 'utf-8')).toBe(file.content)
    }
    expect((await loadSyncManifest(tempDir)).projects.p1?.contentHash).toBe(baselineHash)
  })

  it('uploads changed local files on push with --all-files (delete-then-upload overwrite)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    // Edit a notebook (to trigger the push) and drop in a local working-directory file.
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.mkdir(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'a,b,c', 'utf-8')

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
    expect(cloud.uploadedPaths).toEqual(['p1:data/input.csv'])
    expect(cloud.deletedPaths).toEqual(['p1:data/input.csv'])
    consoleErrorSpy.mockRestore()
  })

  it('re-uploads a same-size local file edit on push (change detected by content hash, not size)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true }) // downloads input.csv, records its hash

    // Edit the notebook (to trigger the push) and the file to different 3-byte content (same size).
    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'x,y', 'utf-8')

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
    expect(cloud.uploadedPaths).toEqual(['p1:data/input.csv'])
    consoleErrorSpy.mockRestore()
  })

  /** Push must not assume the cloud copy is still the one the manifest recorded: `deepnote publish`
   * and the Deepnote app write the same file store. */
  describe('working files changed in Deepnote since the last sync', () => {
    /** Sync a project with one working file, then simulate another writer rewriting the cloud copy
     * while the notebook and the local file are also edited (so push is the notebook's direction). */
    async function setUpDivergedFile(
      cloudAfter: CloudFile[]
    ): Promise<{ cloud: InstalledCloud; projects: CloudProject[] }> {
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [
            { path: '_deepnote_static/index.html', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' },
          ],
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      projects[0].files = cloudAfter
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', '_deepnote_static', 'index.html'), 'mine', 'utf-8')
      return { cloud, projects }
    }

    const republished: CloudFile[] = [
      { path: '_deepnote_static/index.html', size: 9, updatedAt: '2026-01-05T00:00:00.000Z', content: 'published' },
    ]

    it('keeps the Deepnote copy and reports it rather than overwriting it', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      // Nothing was written, so the live file is intact — no delete-then-upload window either.
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
      consoleErrorSpy.mockRestore()
    })

    it('overwrites it with --on-conflict override', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'override' })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(result.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toEqual(['p1:_deepnote_static/index.html'])
      consoleErrorSpy.mockRestore()
    })

    it('treats a cloud copy deleted since the last sync as a conflict, not a re-upload', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      // What `deepnote publish --prune` leaves behind: gone in the cloud, still in the mirror.
      const { cloud } = await setUpDivergedFile([])

      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      expect(cloud.uploadedPaths).toEqual([])
      consoleErrorSpy.mockRestore()
    })

    it('does not treat an unchanged cloud copy as a conflict', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { cloud } = await setUpDivergedFile([
        { path: '_deepnote_static/index.html', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' },
      ])

      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(cloud.uploadedPaths).toEqual(['p1:_deepnote_static/index.html'])
      consoleErrorSpy.mockRestore()
    })

    it('finishes a pending replacement whose cloud copy is already gone', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'mine', 'utf-8')

      // First push deletes the cloud copy, then fails the upload: the path is left pending.
      const failed = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
      expect(failed.projects).toEqual([expect.objectContaining({ action: 'error' })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['report.csv'])

      // The cloud no longer lists it, but that absence is this sync's own unfinished delete — the
      // retry must finish the replacement, not treat it as someone else's deletion.
      projects[0].files = []
      delete projects[0].fileUploadError
      const retried = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(retried.projects).toEqual([expect.objectContaining({ filesUploaded: 1 })])
      expect(retried.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toContain('p1:report.csv')
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()
      consoleErrorSpy.mockRestore()
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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', ' report.csv'), 'local', 'utf-8')

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'x,y', 'utf-8')
    projects[0].fileUploadError = { status: 500, message: 'Upload failed' }

    const failed = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, prune: true })

    expect(failed.success).toBe(false)
    expect(failed.projects).toEqual([expect.objectContaining({ action: 'error', detail: 'Upload failed' })])
    expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['data/input.csv'])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('x,y')

    // The delete succeeded before the failed upload, so the next detail response omits the file.
    projects[0].files = []
    projects[0].fileUploadError = undefined
    const retried = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, prune: true })

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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    await fs.mkdir(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'a,b', 'utf-8')

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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
    await syncWorkspace(tempDir, baseOptions)

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'override' })

    expect(result.projects).toEqual([
      expect.objectContaining({ action: 'pulled', detail: 'conflict resolved: local changes overwritten' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit')
  })

  it('skips a both-sides conflict by default when no terminal can be asked, keeping the local edit', async () => {
    const projects: CloudProject[] = [
      { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
    ]
    installCloud(projects)
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
    // No onConflict option: vitest has no TTY, so `ask` degrades to skip.
    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.projects).toEqual([expect.objectContaining({ action: 'skipped-conflict' })])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toBe(localEdit)
  })

  it('re-throws ExitPromptError so Ctrl+C on a conflict prompt aborts the whole sync', async () => {
    const { select } = await import('@inquirer/prompts')
    const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
    vi.mocked(select).mockRejectedValueOnce(exitError)
    const priorStdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const priorStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      projects.push({ id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') })

      // Force a both-sides conflict so the (mocked) prompt fires, then have it reject like Ctrl+C.
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')

      await expect(syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' })).rejects.toBe(exitError)
      expect(select).toHaveBeenCalled()
      await expect(fs.access(path.join(tempDir, 'Beta'))).rejects.toThrow()
    } finally {
      if (priorStdin) Object.defineProperty(process.stdin, 'isTTY', priorStdin)
      else Reflect.deleteProperty(process.stdin, 'isTTY')
      if (priorStdout) Object.defineProperty(process.stdout, 'isTTY', priorStdout)
      else Reflect.deleteProperty(process.stdout, 'isTTY')
    }
  })

  it('downloads working-directory files incrementally with --all-files', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b')
    expect(cloud.downloadedPaths).toEqual(['p1:data/input.csv'])
    await expect(fs.stat(path.join(path.dirname(tempDir), 'escape.txt'))).rejects.toThrow()

    // Unchanged size/updatedAt: the second sync downloads nothing.
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(1)

    // A changed fingerprint re-downloads.
    projects[0].files = [{ path: 'data/input.csv', size: 5, updatedAt: '2026-01-08T00:00:00.000Z', content: 'a,b,c' }]
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
    expect(cloud.downloadedPaths).toHaveLength(2)
    expect(await fs.readFile(path.join(tempDir, 'Alpha', '.files', 'data', 'input.csv'), 'utf-8')).toBe('a,b,c')

    consoleErrorSpy.mockRestore()
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
    await syncWorkspace(tempDir, baseOptions)

    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-files-outside-'))
    await fs.writeFile(path.join(outsideDir, 'private.txt'), 'private', 'utf-8')
    await fs.symlink(outsideDir, path.join(tempDir, 'Alpha', '.files'))

    try {
      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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
    await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

    await fs.writeFile(
      path.join(tempDir, 'Alpha', 'main.deepnote'),
      notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
      'utf-8'
    )
    const largeFile = path.join(tempDir, 'Alpha', '.files', 'large.bin')
    await fs.mkdir(path.dirname(largeFile), { recursive: true })
    await fs.writeFile(largeFile, '')
    await fs.truncate(largeFile, MAX_BUFFERED_PROJECT_FILE_BYTES + 1)

    const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects.splice(0, 1, {
      id: 'p2',
      name: 'Beta',
      notebooks: singleNotebook('p2', '2026-01-03T00:00:00.000Z'),
    })

    await expect(syncWorkspace(tempDir, { ...baseOptions, prune: true })).rejects.toThrow(
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
    await syncWorkspace(tempDir, baseOptions)

    projects.splice(0, 1)
    const kept = await syncWorkspace(tempDir, baseOptions)
    expect(kept.projects).toEqual([
      expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      expect.objectContaining({ projectId: 'p1', action: 'missing-in-cloud' }),
    ])
    expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('p1')

    const pruned = await syncWorkspace(tempDir, { ...baseOptions, prune: true })
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
    await syncWorkspace(tempDir, baseOptions)

    const localEdit = notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit')
    await fs.writeFile(path.join(tempDir, 'Alpha', 'main.deepnote'), localEdit, 'utf-8')
    projects.splice(0, 1, {
      id: 'p2',
      name: 'Alpha',
      notebooks: singleNotebook('p2', '2026-01-03T00:00:00.000Z'),
    })

    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'skip', prune: true })

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
    await syncWorkspace(tempDir, baseOptions)

    projects[0].name = 'Gamma'
    const result = await syncWorkspace(tempDir, baseOptions)

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
    await syncWorkspace(tempDir, baseOptions)

    await fs.rm(path.join(tempDir, 'Alpha'), { recursive: true })
    projects[0].folder = { id: 'f1', name: 'Team', path: [{ id: 'f1', name: 'Team' }] }
    const unrelated = notebookYaml('other-project', 'other-notebook', '2026-01-03T00:00:00.000Z', 'unrelated')
    await fs.mkdir(path.join(tempDir, 'Team', 'Alpha'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'Team', 'Alpha', 'main.deepnote'), unrelated, 'utf-8')

    const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'skip' })

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

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.untrackedFiles).toEqual(['stray.deepnote'])
    expect(await fs.readFile(path.join(tempDir, 'stray.deepnote'), 'utf-8')).toBe('version: 1.0.0\n')
  })

  it('writes nothing at all in a dry run', async () => {
    installCloud([{ id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') }])
    const missingRoot = path.join(tempDir, 'missing')

    const result = await syncWorkspace(missingRoot, { ...baseOptions, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.projects).toEqual([expect.objectContaining({ action: 'pulled' })])
    await expect(fs.stat(missingRoot)).rejects.toThrow()
  })

  it('isolates a failing project so the rest of the workspace still syncs', async () => {
    installCloud([
      { id: 'p-bad', name: 'Bad', notebooks: [], exportFails: true },
      { id: 'p-good', name: 'Good', notebooks: singleNotebook('p-good', '2026-01-02T00:00:00.000Z') },
    ])

    const result = await syncWorkspace(tempDir, baseOptions)

    expect(result.success).toBe(false)
    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'p-bad', action: 'error', detail: 'Project is suspended' }),
      expect.objectContaining({ projectId: 'p-good', action: 'pulled' }),
    ])
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

  /** Two writers independently produced the same path — `deepnote publish` writing the static root
   * lands here. */
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
