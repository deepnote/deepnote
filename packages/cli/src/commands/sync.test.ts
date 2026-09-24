import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_BUFFERED_PROJECT_FILE_BYTES } from '@deepnote/cloud'
import { InvalidArgumentError } from 'commander'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { loadSyncManifest, saveSyncManifest } from '../utils/sync-manifest'
import {
  canonicalProjectHash,
  classifySyncStep,
  describeCloudFileDivergence,
  parseSyncConcurrency,
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
  // The module mock's `select` is not a spy, so restoreAllMocks leaves its calls and behavior.
  vi.mocked((await import('@inquirer/prompts')).select).mockReset()
  resetOutputConfig()
  await fs.rm(tempDir, { recursive: true, force: true })
})

const baseOptions = { url: API_URL, token: TOKEN }

/** Run `fn` as if stdin and stdout were a terminal, so `--on-conflict ask` really prompts. */
async function withTty(fn: () => Promise<void>): Promise<void> {
  const priorStdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const priorStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  try {
    await fn()
  } finally {
    if (priorStdin) Object.defineProperty(process.stdin, 'isTTY', priorStdin)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
    if (priorStdout) Object.defineProperty(process.stdout, 'isTTY', priorStdout)
    else Reflect.deleteProperty(process.stdout, 'isTTY')
  }
}

/** {@link withTty} for a call whose result the test needs. */
async function withTtyResult<T>(fn: () => Promise<T>): Promise<T> {
  let result: T | undefined
  await withTty(async () => {
    result = await fn()
  })
  return result as T
}

/** A promise the test settles by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** Wrap the fake cloud's fetch so a test can intercept project exports before they are answered. */
function interceptExports(intercept: (projectId: string, respond: () => Promise<Response>) => Promise<Response>): void {
  const fetchMock = vi.mocked(global.fetch)
  const inner = fetchMock.getMockImplementation()
  if (!inner) {
    throw new Error('installCloud must run first')
  }
  fetchMock.mockImplementation(async (rawUrl, init) => {
    const match = new URL(String(rawUrl)).pathname.match(/^\/v2\/projects\/([^/]+)\/export$/)
    return match ? intercept(match[1], () => inner(rawUrl, init)) : inner(rawUrl, init)
  })
}

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

  describe('working files changed in Deepnote since the last sync', () => {
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

      // Create the interrupted replacement state this retry must recover from.
      const failed = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
      expect(failed.projects).toEqual([expect.objectContaining({ action: 'error' })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['report.csv'])

      projects[0].files = []
      delete projects[0].fileUploadError
      const retried = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(retried.projects).toEqual([expect.objectContaining({ filesUploaded: 1 })])
      expect(retried.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toContain('p1:report.csv')
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()
      consoleErrorSpy.mockRestore()
    })

    it('keeps the baseline of a cloud-deleted file across a pull, so a later push still asks', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      // Deleted in Deepnote (`publish --prune`, or by hand); the local copy stays without --prune.
      projects[0].files = []
      const pulled = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      expect(pulled.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('deleted in Deepnote but kept locally'))
      await expect(fs.readFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'utf-8')).resolves.toEqual('old')
      expect((await loadSyncManifest(tempDir)).projects.p1?.files?.['report.csv']).toBeDefined()

      // An edited copy must surface the deletion as a conflict, not silently resurrect the file.
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-09T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'report.csv'), 'mine', 'utf-8')
      const pushed = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(pushed.projects).toEqual([
        expect.objectContaining({ action: 'pushed', filesUploaded: 0, filesSkipped: 1 }),
      ])
      expect(cloud.uploadedPaths).toEqual([])
      consoleErrorSpy.mockRestore()
    })

    it('keeps a cloud-deleted file under a symlinked directory when a pull prunes nothing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          files: [{ path: 'data/old.csv', size: 3, updatedAt: '2026-01-01T00:00:00.000Z', content: 'old' }],
        },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-files-outside-'))
      await fs.writeFile(path.join(outsideDir, 'old.csv'), 'old', 'utf-8')
      await fs.rm(path.join(tempDir, 'Alpha', '.files', 'data'), { recursive: true, force: true })
      await fs.symlink(outsideDir, path.join(tempDir, 'Alpha', '.files', 'data'))
      projects[0].files = []

      try {
        const pulled = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

        expect(pulled.projects).toEqual([expect.objectContaining({ action: 'unchanged' })])
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('deleted in Deepnote but kept locally'))
        expect((await loadSyncManifest(tempDir)).projects.p1?.files?.['data/old.csv']).toBeDefined()
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true })
        consoleErrorSpy.mockRestore()
      }
    })

    it('reports the files an override dry run would upload instead of pretending to skip them', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { cloud } = await setUpDivergedFile(republished)

      const result = await syncWorkspace(tempDir, {
        ...baseOptions,
        allFiles: true,
        dryRun: true,
        onConflict: 'override',
      })

      expect(result.projects).toEqual([expect.objectContaining({ action: 'pushed', filesUploaded: 1 })])
      expect(result.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
      consoleErrorSpy.mockRestore()
    })

    it('settles each uploaded baseline on disk before the next replacement is marked pending', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
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

      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
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
      consoleErrorSpy.mockRestore()
    })

    it('lets a kept re-created conflict fall back to ordinary sync instead of sticking', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          files: [{ path: 'report.csv', size: 4, updatedAt: '2026-01-09T00:00:00.000Z', content: 'mine' }],
        },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

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

      const kept = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(kept.projects).toEqual([expect.objectContaining({ filesSkipped: 1 })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toBeUndefined()

      // With the retry dropped, the next run is an ordinary pull: the cloud copy comes down.
      const recovered = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(recovered.projects).toEqual([expect.objectContaining({ action: 'unchanged', filesDownloaded: 1 })])
      expect(recovered.projects[0].filesSkipped).toBeUndefined()
      expect(cloud.uploadedPaths.length).toEqual(uploadsBefore)
      consoleErrorSpy.mockRestore()
    })

    it('treats a pending path re-created in the cloud as a conflict, not a retry', async () => {
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

      const failed = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
      expect(failed.projects).toEqual([expect.objectContaining({ action: 'error' })])
      expect((await loadSyncManifest(tempDir)).projects.p1?.pendingFileUploads).toEqual(['report.csv'])

      // Another writer put content at the pending path — "our own unfinished delete" no longer holds.
      projects[0].files = [{ path: 'report.csv', size: 6, updatedAt: '2026-01-06T00:00:00.000Z', content: 'theirs' }]
      delete projects[0].fileUploadError
      const uploadsBeforeRetry = cloud.uploadedPaths.length
      const retried = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'skip' })

      expect(retried.projects).toEqual([expect.objectContaining({ filesUploaded: 0, filesSkipped: 1 })])
      expect(cloud.uploadedPaths.length).toEqual(uploadsBeforeRetry)
      // Keeping the cloud copy ends the retry: the path is an ordinary diverged file from here on,
      // so the next pull can bring the cloud copy down instead of the conflict re-raising forever.
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

  describe('Ctrl+C on a conflict prompt', () => {
    async function setUpConflictAndNewProject(): Promise<void> {
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
    }

    it('re-throws ExitPromptError so it aborts the whole sync, prompting inline with --concurrency 1', async () => {
      const { select } = await import('@inquirer/prompts')
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      vi.mocked(select).mockRejectedValueOnce(exitError)
      await withTty(async () => {
        await setUpConflictAndNewProject()

        await expect(syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask', concurrency: 1 })).rejects.toBe(
          exitError
        )
        expect(select).toHaveBeenCalled()
        // Asked inline, in path order: Beta was never reached.
        await expect(fs.access(path.join(tempDir, 'Beta'))).rejects.toThrow()
      })
    })

    it('aborts after the parallel phase, keeping what already finished in the manifest', async () => {
      const { select } = await import('@inquirer/prompts')
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      vi.mocked(select).mockRejectedValueOnce(exitError)
      await withTty(async () => {
        await setUpConflictAndNewProject()

        await expect(syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' })).rejects.toBe(exitError)
        expect(select).toHaveBeenCalledTimes(1)
        expect(await fs.readFile(path.join(tempDir, 'Beta', 'main.deepnote'), 'utf-8')).toContain('p2')
        expect((await loadSyncManifest(tempDir)).projects.p2).toEqual(expect.objectContaining({ dir: 'Beta' }))
        expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('local-edit')
      })
    })
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

  describe('parallel sync', () => {
    const manyProjects = (names: string[]): CloudProject[] =>
      names.map((name, index) => ({
        id: `p${index}`,
        name,
        notebooks: singleNotebook(`p${index}`, '2026-01-02T00:00:00.000Z'),
      }))

    it('exports several projects at once, but never more than --concurrency', async () => {
      installCloud(manyProjects(['A', 'B', 'C', 'D', 'E', 'F', 'G']))
      const gate = deferred()
      let inFlight = 0
      let maxInFlight = 0
      interceptExports(async (_projectId, respond) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await gate.promise
        inFlight--
        return respond()
      })

      const run = syncWorkspace(tempDir, { ...baseOptions, concurrency: 3 })
      await vi.waitFor(() => expect(inFlight).toBe(3))
      // With three exports blocked, no fourth one may start.
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(inFlight).toBe(3)
      gate.resolve()
      const result = await run

      expect(maxInFlight).toBe(3)
      expect(result.projects.map(outcome => outcome.action)).toEqual(Array(7).fill('pulled'))
    })

    it('syncs 8 projects at once by default', async () => {
      installCloud(manyProjects(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']))
      const gate = deferred()
      let inFlight = 0
      interceptExports(async (_projectId, respond) => {
        inFlight++
        await gate.promise
        return respond()
      })

      const run = syncWorkspace(tempDir, baseOptions)
      await vi.waitFor(() => expect(inFlight).toBe(8))
      gate.resolve()
      await run
    })

    it('reports outcomes in path order whatever order the projects finish in', async () => {
      installCloud(manyProjects(['Delta', 'Alpha', 'Gamma', 'Beta']))
      const gates = new Map<string, ReturnType<typeof deferred>>()
      interceptExports(async (projectId, respond) => {
        const gate = deferred()
        gates.set(projectId, gate)
        await gate.promise
        return respond()
      })
      const progress: string[] = []
      vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        progress.push(String(line))
      })
      setOutputConfig({ quiet: false, color: false, debug: false })

      const run = syncWorkspace(tempDir, { ...baseOptions, concurrency: 4 })
      await vi.waitFor(() => expect(gates.size).toBe(4))
      // Finish in reverse path order: Gamma (p2), Delta (p0), Beta (p3), Alpha (p1).
      for (const [finished, projectId] of ['p2', 'p0', 'p3', 'p1'].entries()) {
        gates.get(projectId)?.resolve()
        await vi.waitFor(() => expect(progress.filter(line => line.includes('pulled'))).toHaveLength(finished + 1))
      }
      const result = await run

      expect(result.projects.map(outcome => outcome.path)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
      // Progress lines stream as projects finish, so they follow completion order instead.
      expect(progress.filter(line => line.includes('pulled')).map(line => line.trim().split(/\s+/).pop())).toEqual([
        'Gamma',
        'Delta',
        'Beta',
        'Alpha',
      ])
    })

    it('pushes the files on disk when a deferred push conflict is overridden, not the ones read earlier', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      const alphaFile = path.join(tempDir, 'Alpha', 'main.deepnote')
      await fs.writeFile(alphaFile, notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'first-edit'), 'utf-8')
      projects[0].importConflict = 'unless-forced'
      projects[1].notebooks = singleNotebook('p2', '2026-01-05T00:00:00.000Z', 'cloud-edit')

      // While the question waits, the user keeps editing.
      vi.mocked(select).mockImplementation(async () => {
        await fs.writeFile(
          alphaFile,
          notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'edited-while-waiting'),
          'utf-8'
        )
        return 'override'
      })

      const result = await withTtyResult(() => syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' }))

      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p1', action: 'pushed' }),
        expect.objectContaining({ projectId: 'p2', action: 'pulled' }),
      ])
      const forced = cloud.importCalls.filter(call => call.url.searchParams.get('force') === 'true')
      expect(forced).toHaveLength(1)
      expect(forced[0]?.documents['main.deepnote']).toContain('edited-while-waiting')
    })

    it('force-pushes after a deferred push conflict is overridden, even if the cloud changed again meanwhile', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].importConflict = 'unless-forced'
      projects[0].notebooksAfterImport = singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'local-edit-imported')

      // While the question waits, someone edits Alpha in Deepnote again.
      vi.mocked(select).mockImplementation(async () => {
        projects[0].notebooks = singleNotebook('p1', '2026-01-08T00:00:00.000Z', 'cloud-edit-meanwhile')
        return 'override'
      })

      const result = await withTtyResult(() => syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' }))

      expect(select).toHaveBeenCalledTimes(1)
      const forced = cloud.importCalls.filter(call => call.url.searchParams.get('force') === 'true')
      expect(forced).toHaveLength(1)
      expect(forced[0]?.documents['main.deepnote']).toContain('local-edit')
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p1', action: 'pushed' }),
        expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('local-edit-imported')
    })

    it('does not delete cloud notebooks when an empty directory was refilled while its question waited', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      const alphaFile = path.join(tempDir, 'Alpha', 'main.deepnote')
      const alphaContent = await fs.readFile(alphaFile, 'utf-8')
      await fs.rm(alphaFile)

      // The user restores the notebook before answering "push and delete everything".
      vi.mocked(select).mockImplementation(async () => {
        await fs.writeFile(alphaFile, alphaContent, 'utf-8')
        return 'override'
      })

      const result = await withTtyResult(() =>
        syncWorkspace(tempDir, { ...baseOptions, deleteMissingNotebooks: true, onConflict: 'ask' })
      )

      expect(select).toHaveBeenCalledTimes(1)
      expect(cloud.importCalls).toEqual([])
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p1', action: 'unchanged' }),
        expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      ])
    })

    it('pulls the fresh export when the cloud changed again while an overwrite question waited', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')

      const newest = singleNotebook('p1', '2026-01-08T00:00:00.000Z', 'cloud-edit-again')
      vi.mocked(select).mockImplementation(async () => {
        projects[0].notebooks = newest
        return 'override'
      })

      const result = await withTtyResult(() => syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' }))

      expect(select).toHaveBeenCalledTimes(1)
      expect(result.projects).toEqual([
        expect.objectContaining({
          projectId: 'p1',
          action: 'pulled',
          detail: 'conflict resolved: local changes overwritten',
        }),
        expect.objectContaining({ projectId: 'p2', action: 'unchanged' }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit-again')
      expect((await loadSyncManifest(tempDir)).projects.p1).toEqual(
        expect.objectContaining({ contentHash: canonicalProjectHash(newest), modifiedAt: '2026-01-08T00:00:00.000Z' })
      )
    })

    it('re-plans file uploads after a deferred "skip", keeping a file that changed in Deepnote meanwhile', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [
            { path: 'data.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a' },
            { path: 'other.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'b' },
          ],
        },
      ]
      const cloud = installCloud(projects)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      // Local edits to the notebook (so it pushes) and both files; data.csv also changed in Deepnote.
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data.csv'), 'local-a', 'utf-8')
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'other.csv'), 'local-b', 'utf-8')
      projects[0].files = [
        { path: 'data.csv', size: 7, updatedAt: '2026-01-06T00:00:00.000Z', content: 'cloud-a' },
        { path: 'other.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'b' },
      ]

      // Only data.csv is in conflict when asked; while the question waits, a colleague edits other.csv.
      vi.mocked(select).mockImplementation(async config => {
        expect(config.message).toContain('data.csv')
        expect(config.message).not.toContain('other.csv')
        projects[0].files = [
          { path: 'data.csv', size: 7, updatedAt: '2026-01-06T00:00:00.000Z', content: 'cloud-a' },
          { path: 'other.csv', size: 9, updatedAt: '2026-01-07T00:00:00.000Z', content: 'colleague' },
        ]
        return 'skip'
      })

      const result = await withTtyResult(() =>
        syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'ask' })
      )

      expect(select).toHaveBeenCalledTimes(1)
      expect(cloud.uploadedPaths).toEqual([])
      expect(cloud.deletedPaths).toEqual([])
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p1', action: 'pushed', filesUploaded: 0, filesSkipped: 2 }),
      ])
    })

    it('asks one project two questions in turn when its push conflicts and its files do too', async () => {
      const { select } = await import('@inquirer/prompts')
      const projects: CloudProject[] = [
        {
          id: 'p1',
          name: 'Alpha',
          notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z'),
          notebooksAfterImport: singleNotebook('p1', '2026-01-09T00:00:00.000Z', 'canonical'),
          files: [{ path: 'data.csv', size: 1, updatedAt: '2026-01-01T00:00:00.000Z', content: 'a' }],
        },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z'), files: [] },
      ]
      const cloud = installCloud(projects)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })

      // Alpha: a local notebook and file edit, while Deepnote changed both the project (the import
      // 409s until forced) and the same file.
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      await fs.writeFile(path.join(tempDir, 'Alpha', '.files', 'data.csv'), 'local', 'utf-8')
      projects[0].importConflict = 'unless-forced'
      projects[0].files = [{ path: 'data.csv', size: 5, updatedAt: '2026-01-06T00:00:00.000Z', content: 'cloud' }]
      projects[1].notebooks = singleNotebook('p2', '2026-01-05T00:00:00.000Z', 'cloud-edit')

      const messages: string[] = []
      vi.mocked(select).mockImplementation(async config => {
        messages.push(config.message)
        return 'override'
      })

      const result = await withTtyResult(() =>
        syncWorkspace(tempDir, { ...baseOptions, allFiles: true, onConflict: 'ask' })
      )

      expect(messages).toEqual([
        expect.stringContaining('"Alpha" changed in Deepnote after your local edit'),
        expect.stringContaining('Working files of "Alpha" changed in Deepnote since the last sync'),
      ])
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p1', action: 'pushed', filesUploaded: 1 }),
        expect.objectContaining({ projectId: 'p2', action: 'pulled' }),
      ])
      expect(cloud.uploadedPaths).toEqual(['p1:data.csv'])
    })

    it('asks conflict questions one at a time, only after every other project has finished', async () => {
      const { select } = await import('@inquirer/prompts')
      await withTty(async () => {
        const projects: CloudProject[] = [
          { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
          {
            id: 'p2',
            name: 'Beta',
            notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z'),
            notebooksAfterImport: singleNotebook('p2', '2026-01-09T00:00:00.000Z', 'canonical'),
          },
        ]
        const cloud = installCloud(projects)
        await syncWorkspace(tempDir, baseOptions)

        // Alpha: changed on both sides. Beta: a local edit whose push the server rejects with a 409
        // until forced. Gamma: new in the cloud, no question needed.
        await fs.writeFile(
          path.join(tempDir, 'Alpha', 'main.deepnote'),
          notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
          'utf-8'
        )
        projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
        await fs.writeFile(
          path.join(tempDir, 'Beta', 'main.deepnote'),
          notebookYaml('p2', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
          'utf-8'
        )
        projects[1].importConflict = 'unless-forced'
        projects.push({ id: 'p3', name: 'Gamma', notebooks: singleNotebook('p3', '2026-01-02T00:00:00.000Z') })

        // Hold Gamma's export until Alpha and Beta have both reached their questions.
        const gammaGate = deferred()
        let gammaRequested = false
        let alphaExported = false
        interceptExports(async (projectId, respond) => {
          if (projectId === 'p3') {
            gammaRequested = true
            await gammaGate.promise
          }
          const response = await respond()
          if (projectId === 'p1') {
            alphaExported = true
          }
          return response
        })

        const asked: { message: string; gammaSynced: boolean; openPrompts: number }[] = []
        let openPrompts = 0
        vi.mocked(select).mockImplementation(async config => {
          openPrompts++
          const gammaSynced = await fs
            .access(path.join(tempDir, 'Gamma', 'main.deepnote'))
            .then(() => true)
            .catch(() => false)
          await new Promise(resolve => setTimeout(resolve, 5))
          asked.push({ message: config.message, gammaSynced, openPrompts })
          openPrompts--
          return 'override'
        })

        const run = syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask' })
        await vi.waitFor(() => {
          expect(gammaRequested).toBe(true)
          expect(alphaExported).toBe(true)
          expect(cloud.importCalls.map(call => call.projectId)).toContain('p2')
        })
        // Both questions are known now. Asking either while Gamma is still in flight would share the
        // terminal with its progress, so nothing may be asked until Gamma finishes.
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(select).not.toHaveBeenCalled()
        gammaGate.resolve()
        const result = await run

        // Both questions came after Gamma synced, one at a time, in path order.
        expect(asked).toEqual([
          {
            message: expect.stringContaining('"Alpha" changed both locally and in Deepnote'),
            gammaSynced: true,
            openPrompts: 1,
          },
          {
            message: expect.stringContaining('"Beta" changed in Deepnote after your local edit'),
            gammaSynced: true,
            openPrompts: 1,
          },
        ])
        expect(result.projects).toEqual([
          expect.objectContaining({
            projectId: 'p1',
            action: 'pulled',
            detail: 'conflict resolved: local changes overwritten',
          }),
          expect.objectContaining({ projectId: 'p2', action: 'pushed' }),
          expect.objectContaining({ projectId: 'p3', action: 'pulled' }),
        ])
        expect(await fs.readFile(path.join(tempDir, 'Alpha', 'main.deepnote'), 'utf-8')).toContain('cloud-edit')
        expect(await fs.readFile(path.join(tempDir, 'Beta', 'main.deepnote'), 'utf-8')).toContain('canonical')
      })
    })

    it('never writes the manifest from two projects at once', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const projects: CloudProject[] = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
        id: `p${index}`,
        name,
        notebooks: singleNotebook(`p${index}`, '2026-01-02T00:00:00.000Z'),
        notebooksAfterImport: singleNotebook(`p${index}`, '2026-01-09T00:00:00.000Z', 'canonical'),
        files: [],
      }))
      installCloud(projects)
      await syncWorkspace(tempDir, { ...baseOptions, allFiles: true })
      for (const [index, project] of projects.entries()) {
        await fs.writeFile(
          path.join(tempDir, project.name, 'main.deepnote'),
          notebookYaml(`p${index}`, 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
          'utf-8'
        )
        await fs.mkdir(path.join(tempDir, project.name, '.files'), { recursive: true })
        await fs.writeFile(path.join(tempDir, project.name, '.files', 'a.csv'), 'a', 'utf-8')
        await fs.writeFile(path.join(tempDir, project.name, '.files', 'b.csv'), 'b', 'utf-8')
      }

      let writing = 0
      let maxWriting = 0
      let manifestWrites = 0
      const realWriteFile = fs.writeFile
      vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, ...rest) => {
        if (!String(file).endsWith('.deepnote-sync.json')) {
          return realWriteFile.call(fs, file, data, ...rest)
        }
        manifestWrites++
        writing++
        maxWriting = Math.max(maxWriting, writing)
        try {
          // Widen the window in which two saves that are not queued would overlap.
          await new Promise(resolve => setTimeout(resolve, 2))
          return await realWriteFile.call(fs, file, data, ...rest)
        } finally {
          writing--
        }
      })

      const result = await syncWorkspace(tempDir, { ...baseOptions, allFiles: true, concurrency: 3 })

      expect(result.projects.map(outcome => [outcome.action, outcome.filesUploaded])).toEqual([
        ['pushed', 2],
        ['pushed', 2],
        ['pushed', 2],
      ])
      expect(manifestWrites).toBeGreaterThan(3)
      expect(maxWriting).toBe(1)
      const manifest = await loadSyncManifest(tempDir)
      for (const projectId of ['p0', 'p1', 'p2']) {
        expect(Object.keys(manifest.projects[projectId]?.files ?? {})).toEqual(['a.csv', 'b.csv'])
        expect(manifest.projects[projectId]?.pendingFileUploads).toBeUndefined()
      }
      consoleErrorSpy.mockRestore()
    })

    /** The first export of each project answers 429 with `retryAfter` seconds. */
    function rateLimitFirstExports(retryAfter: string): () => number {
      const limited = new Set<string>()
      interceptExports(async (projectId, respond) => {
        if (!limited.has(projectId)) {
          limited.add(projectId)
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'Retry-After': retryAfter }),
            text: () => Promise.resolve(JSON.stringify({ message: 'Rate limit exceeded. Please retry later.' })),
          } as unknown as Response
        }
        return respond()
      })
      return () => limited.size
    }

    it('retries a rate-limited export instead of reporting the project as failed', async () => {
      installCloud(manyProjects(['Alpha', 'Beta']))
      const rateLimited = rateLimitFirstExports('0')

      const result = await syncWorkspace(tempDir, baseOptions)

      expect(rateLimited()).toBe(2)
      expect(result.success).toBe(true)
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p0', action: 'pulled' }),
        expect.objectContaining({ projectId: 'p1', action: 'pulled' }),
      ])
    })

    it('says once when parallel requests wait on the same rate limit', async () => {
      installCloud(manyProjects(['Alpha', 'Beta', 'Gamma']))
      const rateLimited = rateLimitFirstExports('30')
      const lines: string[] = []
      vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        lines.push(String(line))
      })
      setOutputConfig({ quiet: false, color: false, debug: false })
      // Fake the clock and the retry sleep: the wait is instant, and all three 429s land at the same
      // instant, so "once per wait" does not depend on how fast the machine is.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        let done = false
        const run = syncWorkspace(tempDir, baseOptions).finally(() => {
          done = true
        })
        while (!done) {
          await vi.advanceTimersByTimeAsync(1_000)
          await new Promise(resolve => setImmediate(resolve))
        }
        await run
      } finally {
        vi.useRealTimers()
      }

      expect(rateLimited()).toBe(3)
      expect(lines.filter(line => line.includes('Rate limited'))).toEqual([
        'Rate limited by the Deepnote API; waiting 30 s…',
      ])
    })

    it('keeps rate-limit notices out of machine-readable output', async () => {
      installCloud(manyProjects(['Alpha']))
      rateLimitFirstExports('0')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      setOutputConfig({ quiet: false, color: false, debug: false })

      await syncWorkspace(tempDir, { ...baseOptions, output: 'json' })

      expect(log).not.toHaveBeenCalled()
    })

    it('moves renamed directories before any project writes, so a new project inside an old path stays put', async () => {
      const projects: CloudProject[] = [
        { id: 'p-x', name: 'Foo', notebooks: singleNotebook('p-x', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)

      // X is renamed away from `Foo`, and a new folder `Foo` now holds project Y.
      projects[0].name = 'Zed'
      projects.push({
        id: 'p-y',
        name: 'Y',
        folder: { id: 'f-foo', name: 'Foo', path: [{ id: 'f-foo', name: 'Foo' }] },
        notebooks: singleNotebook('p-y', '2026-01-03T00:00:00.000Z'),
      })

      const result = await syncWorkspace(tempDir, baseOptions)

      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p-y', action: 'pulled', path: 'Foo/Y' }),
        expect.objectContaining({ projectId: 'p-x', action: 'unchanged', path: 'Zed', detail: 'moved from Foo' }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'Foo', 'Y', 'main.deepnote'), 'utf-8')).toContain('p-y')
      expect(await fs.readFile(path.join(tempDir, 'Zed', 'main.deepnote'), 'utf-8')).toContain('p-x')
      await expect(fs.access(path.join(tempDir, 'Zed', 'Y'))).rejects.toThrow()
    })

    it('moves a project out of a directory before another project moves into it', async () => {
      const projects: CloudProject[] = [
        { id: 'p-x', name: 'Foo', notebooks: singleNotebook('p-x', '2026-01-02T00:00:00.000Z') },
        { id: 'p-y', name: 'Y', notebooks: singleNotebook('p-y', '2026-01-02T00:00:00.000Z') },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      await fs.writeFile(
        path.join(tempDir, 'Y', 'main.deepnote'),
        notebookYaml('p-y', 'nb-main', '2026-01-02T00:00:00.000Z', 'pending-local-edit'),
        'utf-8'
      )

      // X leaves `Foo` for `Zed`; Y, with a local edit not yet pushed, moves into a new folder `Foo`. Y's move
      // sorts first by destination, but must wait until X has vacated `Foo`.
      projects[0].name = 'Zed'
      projects[1].folder = { id: 'f-foo', name: 'Foo', path: [{ id: 'f-foo', name: 'Foo' }] }
      const manifestDirs: Record<string, string | undefined>[] = []
      const realWriteFile = fs.writeFile
      vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, ...rest) => {
        if (String(file).endsWith('.deepnote-sync.json')) {
          const saved = JSON.parse(String(data)).projects
          manifestDirs.push({ x: saved['p-x']?.dir, y: saved['p-y']?.dir })
        }
        return realWriteFile.call(fs, file, data, ...rest)
      })

      const result = await syncWorkspace(tempDir, baseOptions)

      // Each rename is on disk in the manifest before the next one starts.
      expect(manifestDirs.slice(0, 2)).toEqual([
        { x: 'Zed', y: 'Y' },
        { x: 'Zed', y: 'Foo/Y' },
      ])
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p-y', action: 'pushed', path: 'Foo/Y' }),
        expect.objectContaining({ projectId: 'p-x', action: 'unchanged', path: 'Zed', detail: 'moved from Foo' }),
      ])
      expect(cloud.importCalls).toHaveLength(1)
      expect(cloud.importCalls[0]?.projectId).toBe('p-y')
      expect(cloud.importCalls[0]?.documents['main.deepnote']).toContain('pending-local-edit')
      await expect(fs.access(path.join(tempDir, 'Zed', 'Y'))).rejects.toThrow()
      expect(await fs.readFile(path.join(tempDir, 'Zed', 'main.deepnote'), 'utf-8')).toContain('p-x')
    })

    it('reports a move whose manifest save failed as that project’s error and keeps syncing the rest', async () => {
      const projects: CloudProject[] = [
        { id: 'p-x', name: 'Foo', notebooks: singleNotebook('p-x', '2026-01-02T00:00:00.000Z') },
        { id: 'p-y', name: 'Other', notebooks: singleNotebook('p-y', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      projects[0].name = 'Zed'
      projects[1].notebooks = singleNotebook('p-y', '2026-01-05T00:00:00.000Z', 'cloud-edit')

      const realWriteFile = fs.writeFile
      let failedOnce = false
      vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, ...rest) => {
        if (String(file).endsWith('.deepnote-sync.json') && !failedOnce) {
          failedOnce = true
          throw new Error('disk full')
        }
        return realWriteFile.call(fs, file, data, ...rest)
      })

      const result = await syncWorkspace(tempDir, baseOptions)

      expect(failedOnce).toBe(true)
      expect(result.success).toBe(false)
      expect(result.projects).toEqual([
        expect.objectContaining({ projectId: 'p-y', action: 'pulled' }),
        expect.objectContaining({
          projectId: 'p-x',
          action: 'error',
          path: 'Zed',
          detail: 'moved to Zed but the manifest could not be saved: disk full',
        }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'Zed', 'main.deepnote'), 'utf-8')).toContain('p-x')
      expect((await loadSyncManifest(tempDir)).projects['p-x']?.dir).toBe('Zed')
    })

    it('fails both halves of a directory swap without moving anything, as a one-at-a-time sync would', async () => {
      const projects: CloudProject[] = [
        { id: 'p-a', name: 'A', notebooks: singleNotebook('p-a', '2026-01-02T00:00:00.000Z') },
        { id: 'p-b', name: 'B', notebooks: singleNotebook('p-b', '2026-01-02T00:00:00.000Z') },
      ]
      installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)
      const manifestBefore = await fs.readFile(path.join(tempDir, '.deepnote-sync.json'), 'utf-8')

      projects[0].name = 'B'
      projects[1].name = 'A'
      const result = await syncWorkspace(tempDir, baseOptions)

      expect(result.success).toBe(false)
      expect(result.projects).toEqual([
        expect.objectContaining({
          projectId: 'p-b',
          action: 'error',
          path: 'A',
          detail: expect.stringMatching(/rename/),
        }),
        expect.objectContaining({
          projectId: 'p-a',
          action: 'error',
          path: 'B',
          detail: expect.stringMatching(/rename/),
        }),
      ])
      expect(await fs.readFile(path.join(tempDir, 'A', 'main.deepnote'), 'utf-8')).toContain('p-a')
      expect(await fs.readFile(path.join(tempDir, 'B', 'main.deepnote'), 'utf-8')).toContain('p-b')
      expect((await fs.readdir(tempDir)).sort()).toEqual(['.deepnote-sync.json', 'A', 'B'])
      expect(await fs.readFile(path.join(tempDir, '.deepnote-sync.json'), 'utf-8')).toBe(manifestBefore)
    })

    it('records directory moves before syncing, so an interrupted run cannot orphan a local edit', async () => {
      const { select } = await import('@inquirer/prompts')
      const exitError = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
      vi.mocked(select).mockRejectedValueOnce(exitError)
      const projects: CloudProject[] = [
        { id: 'p1', name: 'Alpha', notebooks: singleNotebook('p1', '2026-01-02T00:00:00.000Z') },
        { id: 'p2', name: 'Beta', notebooks: singleNotebook('p2', '2026-01-02T00:00:00.000Z') },
      ]
      const cloud = installCloud(projects)
      await syncWorkspace(tempDir, baseOptions)

      // Beta has a local edit not yet pushed and is renamed to Zed in the cloud. Alpha changed on both sides; its
      // prompt comes first and is aborted, so the run stops after the move but before Zed syncs.
      await fs.writeFile(
        path.join(tempDir, 'Beta', 'main.deepnote'),
        notebookYaml('p2', 'nb-main', '2026-01-02T00:00:00.000Z', 'pending-local-edit'),
        'utf-8'
      )
      projects[1].name = 'Zed'
      await fs.writeFile(
        path.join(tempDir, 'Alpha', 'main.deepnote'),
        notebookYaml('p1', 'nb-main', '2026-01-02T00:00:00.000Z', 'local-edit'),
        'utf-8'
      )
      projects[0].notebooks = singleNotebook('p1', '2026-01-07T00:00:00.000Z', 'cloud-edit')
      await withTty(async () => {
        await expect(syncWorkspace(tempDir, { ...baseOptions, onConflict: 'ask', concurrency: 1 })).rejects.toBe(
          exitError
        )
      })
      expect((await loadSyncManifest(tempDir)).projects.p2?.dir).toBe('Zed')

      // The next run still knows Zed is Beta's tracked directory, so the edit is pushed, not
      // overwritten as an untracked directory.
      const result = await syncWorkspace(tempDir, { ...baseOptions, onConflict: 'override' })

      expect(result.projects).toContainEqual(expect.objectContaining({ projectId: 'p2', action: 'pushed' }))
      expect(cloud.importCalls.map(call => call.projectId)).toEqual(['p2'])
      expect(cloud.importCalls[0]?.documents['main.deepnote']).toContain('pending-local-edit')
    })

    it('rejects a concurrency below 1 before contacting the API', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch')

      await expect(syncWorkspace(tempDir, { ...baseOptions, concurrency: 0 })).rejects.toThrow(
        'Concurrency must be an integer from 1 to 32. Got 0.'
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})

describe('parseSyncConcurrency', () => {
  it.each([
    ['1', 1],
    ['8', 8],
    [' 16 ', 16],
    ['32', 32],
  ])('accepts %j', (value, expected) => {
    expect(parseSyncConcurrency(value)).toBe(expected)
  })

  it.each(['0', '-1', '1.5', 'four', '', '1e3', '33'])('rejects %j', value => {
    expect(() => parseSyncConcurrency(value)).toThrow(InvalidArgumentError)
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
