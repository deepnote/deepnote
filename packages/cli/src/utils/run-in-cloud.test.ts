import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { type DeepnoteFile, serializeDeepnoteFile, serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { splitDeepnoteFile } from '@deepnote/convert'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExitCode } from '../exit-codes'
import { MissingTokenError } from './auth'
import { InvalidInputError } from './parse-inputs'
import { assertCloudOnlyFlagsRequireCloud, CloudRunUsageError, runInDeepnoteCloud } from './run-in-cloud'

const API_URL = 'https://api.example.com'

function makeFile(notebooks: Array<{ id: string; name: string }>): DeepnoteFile {
  return {
    metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
    project: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'My Project',
      notebooks: notebooks.map(nb => ({ ...nb, blocks: [] })),
    },
    version: '1.0.0',
  }
}

/** A file whose only notebook defines one input of each shape `--input` types differently. */
function makeFileWithInputs(): DeepnoteFile {
  const file = makeFile([{ id: 'nb-single', name: 'Main' }])
  file.project.notebooks[0].blocks = [
    inputBlock('blk-name', '0', 'input-text', { deepnote_variable_name: 'name', deepnote_variable_value: 'Bob' }),
    inputBlock('blk-count', '1', 'input-slider', { deepnote_variable_name: 'count', deepnote_variable_value: '1' }),
  ]
  return file
}

function inputBlock(id: string, sortingKey: string, type: string, metadata: Record<string, unknown>) {
  return {
    id,
    sortingKey,
    blockGroup: sortingKey,
    type,
    content: '',
    metadata,
  } as unknown as DeepnoteFile['project']['notebooks'][number]['blocks'][number]
}

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

interface MockConfig {
  terminalStatus?: string
  snapshotContent?: string
  downloadUrl?: string
  downloadBody?: string
  runError?: unknown
  runId?: string
}

interface InstalledFetch {
  postBodies: Array<Record<string, unknown>>
  /** The `init` of the request made to `downloadUrl` (to assert cross-origin auth handling). */
  getDownloadInit: () => RequestInit | undefined
}

function installFetch(cfg: MockConfig): InstalledFetch {
  const postBodies: Array<Record<string, unknown>> = []
  const runId = cfg.runId ?? 'run-x'
  let downloadInit: RequestInit | undefined
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    const method = (init?.method as string) ?? 'GET'
    if (cfg.downloadUrl && u === cfg.downloadUrl) {
      downloadInit = init
      return response(cfg.downloadBody ?? '')
    }
    if (method === 'POST') {
      postBodies.push(JSON.parse(init?.body as string))
      return response({ run: { id: runId, status: 'pending' } })
    }
    const snapshot =
      cfg.snapshotContent !== undefined
        ? { snapshotContent: cfg.snapshotContent }
        : cfg.downloadUrl
          ? { downloadUrl: cfg.downloadUrl }
          : undefined
    return response({
      run: {
        id: runId,
        status: cfg.terminalStatus ?? 'success',
        ...(cfg.runError !== undefined ? { error: cfg.runError } : {}),
        ...(snapshot ? { snapshot } : {}),
      },
    })
  })
  return { postBodies, getDownloadInit: () => downloadInit }
}

let tmpDir: string
const savedToken = process.env.DEEPNOTE_TOKEN

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'run-cloud-'))
  delete process.env.DEEPNOTE_TOKEN
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = 0
  if (savedToken !== undefined) {
    process.env.DEEPNOTE_TOKEN = savedToken
  } else {
    delete process.env.DEEPNOTE_TOKEN
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFixture(name: string, file: DeepnoteFile): Promise<string> {
  const path = join(tmpDir, name)
  await fs.writeFile(path, serializeDeepnoteFile(file), 'utf-8')
  return path
}

async function listSnapshots(dir = join(tmpDir, 'snapshots')): Promise<string[]> {
  return fs.readdir(dir).catch(() => [])
}

describe('runInDeepnoteCloud — usage guards', () => {
  it('rejects --push as not yet implemented', async () => {
    await expect(
      runInDeepnoteCloud(undefined, { cloud: true, push: true, notebookId: 'nb', token: 't' })
    ).rejects.toBeInstanceOf(CloudRunUsageError)
  })

  it('rejects local-only flags in cloud mode', async () => {
    await expect(
      runInDeepnoteCloud(undefined, { cloud: true, notebookId: 'nb', token: 't', python: '/usr/bin/python' })
    ).rejects.toThrow(/--python/)
    await expect(
      runInDeepnoteCloud(undefined, { cloud: true, notebookId: 'nb', token: 't', dryRun: true })
    ).rejects.toThrow(/--dry-run/)
  })

  it('rejects cloud-only flags without --cloud', () => {
    expect(() => assertCloudOnlyFlagsRequireCloud({ notebookId: 'nb' })).toThrow(/--notebook-id requires --cloud/)
    expect(() => assertCloudOnlyFlagsRequireCloud({ out: 'snap.deepnote' })).toThrow(/--out requires --cloud/)
    expect(() => assertCloudOnlyFlagsRequireCloud({ timeout: 30 })).toThrow(/--timeout requires --cloud/)
    expect(() => assertCloudOnlyFlagsRequireCloud({ push: true })).toThrow(/--push requires --cloud/)
    expect(() =>
      assertCloudOnlyFlagsRequireCloud({ notebookId: 'nb', out: 'snap.deepnote', timeout: 30, push: true })
    ).toThrow(/--notebook-id, --out, --timeout, --push require --cloud/)
  })

  it('allows cloud-only flags when --cloud is set', () => {
    expect(() =>
      assertCloudOnlyFlagsRequireCloud({ cloud: true, notebookId: 'nb', out: 'snap.deepnote', timeout: 30, push: true })
    ).not.toThrow()
  })

  it('requires a token (missing)', async () => {
    await expect(runInDeepnoteCloud(undefined, { cloud: true, notebookId: 'nb' })).rejects.toBeInstanceOf(
      MissingTokenError
    )
  })

  it('treats a blank token as missing', async () => {
    await expect(runInDeepnoteCloud(undefined, { cloud: true, notebookId: 'nb', token: '   ' })).rejects.toBeInstanceOf(
      MissingTokenError
    )
  })

  it('rejects a non-.deepnote file', async () => {
    const txt = join(tmpDir, 'notes.txt')
    await fs.writeFile(txt, 'hello', 'utf-8')
    await expect(runInDeepnoteCloud(txt, { cloud: true, token: 't' })).rejects.toThrow(/Unsupported file type/)
  })

  it('errors on an ambiguous multi-notebook file with no --notebook/--notebook-id', async () => {
    installFetch({})
    const path = await writeFixture(
      'multi.deepnote',
      makeFile([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ])
    )
    await expect(runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL })).rejects.toThrow(
      /multiple notebooks/i
    )
  })
})

describe('runInDeepnoteCloud — notebook id resolution', () => {
  it('reads the notebook id from a single-notebook .deepnote file', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    const { postBodies } = installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL })

    expect(postBodies[0].notebookId).toBe('nb-single')
  })

  it('picks a notebook by name with --notebook', async () => {
    const file = makeFile([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ])
    const { postBodies } = installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('multi.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, notebook: 'Beta' })

    expect(postBodies[0].notebookId).toBe('b')
  })

  it('runs a remote notebook by --notebook-id with no local file (writing to --out)', async () => {
    const file = makeFile([{ id: 'ignored', name: 'Main' }])
    const { postBodies } = installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const out = join(tmpDir, 'downloaded.snapshot.deepnote')

    await runInDeepnoteCloud(undefined, { cloud: true, token: 't', url: API_URL, notebookId: 'nb-remote', out })

    expect(postBodies[0].notebookId).toBe('nb-remote')
    await expect(fs.stat(out)).resolves.toBeDefined()
  })
})

describe('runInDeepnoteCloud — inputs and blocks', () => {
  it('types inputs against their input blocks, exactly as a local run does', async () => {
    const file = makeFileWithInputs()
    const { postBodies } = installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, {
      cloud: true,
      token: 't',
      url: API_URL,
      input: ['name=Alice', 'count=42'],
      block: 'blk-1',
    })

    expect(postBodies[0]).toMatchObject({
      notebookId: 'nb-single',
      // `count` is a slider, so it is sent as the numeric string its schema requires — not the
      // JSON number an untyped parse would have produced.
      inputs: { name: 'Alice', count: '42' },
      blockIds: ['blk-1'],
    })
  })

  it('rejects an input no block defines, and one the block cannot store', async () => {
    const file = makeFileWithInputs()
    installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)
    const options = { cloud: true, token: 't', url: API_URL }

    await expect(runInDeepnoteCloud(path, { ...options, input: ['nope=1'] })).rejects.toThrow(InvalidInputError)
    await expect(runInDeepnoteCloud(path, { ...options, input: ['count=abc'] })).rejects.toThrow(/numeric string/)
  })

  it('requires the .deepnote file to type inputs when only --notebook-id is given', async () => {
    const { postBodies } = installFetch({})

    // Without the file there are no input blocks to type against, so we ask for it rather than
    // send an unchecked payload.
    await expect(
      runInDeepnoteCloud(undefined, {
        cloud: true,
        token: 't',
        url: API_URL,
        notebookId: 'nb-remote',
        input: ['count=42'],
      })
    ).rejects.toThrow(CloudRunUsageError)
    expect(postBodies).toHaveLength(0)

    // ...but a run with no inputs at all still works from just the id.
    await runInDeepnoteCloud(undefined, { cloud: true, token: 't', url: API_URL, notebookId: 'nb-remote' })
    expect(postBodies[0]).toMatchObject({ notebookId: 'nb-remote' })
  })
})

describe('runInDeepnoteCloud — snapshot writing', () => {
  it('writes both timestamped and latest snapshots from a full-file payload', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    installFetch({ snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL })

    const snaps = await listSnapshots()
    expect(snaps.filter(n => n.endsWith('.snapshot.deepnote')).length).toBeGreaterThanOrEqual(2)
    expect(snaps.some(n => n.includes('latest'))).toBe(true)
  })

  it('accepts a snapshot-document payload', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    const snapshotDoc = serializeDeepnoteSnapshot(splitDeepnoteFile(file).snapshot)
    installFetch({ snapshotContent: snapshotDoc })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL })

    const snaps = await listSnapshots()
    expect(snaps.some(n => n.endsWith('.snapshot.deepnote'))).toBe(true)
  })

  it('downloads a snapshot via a cross-origin downloadUrl without forwarding auth', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    const { getDownloadInit } = installFetch({
      downloadUrl: 'https://s3.example.com/snap.yaml',
      downloadBody: serializeDeepnoteFile(file),
    })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL })

    const snaps = await listSnapshots()
    expect(snaps.some(n => n.endsWith('.snapshot.deepnote'))).toBe(true)

    // The presigned S3 URL is a different origin; the bearer token must not leak to it.
    const downloadHeaders = new Headers(getDownloadInit()?.headers)
    expect(downloadHeaders.has('authorization')).toBe(false)
  })

  it('sanitizes a path-like runId so the fallback snapshot cannot escape ./snapshots', async () => {
    // Raw, unrecognizable content + no local file → the runId-named fallback path. A malicious
    // API-provided runId with `..` segments must not write outside the snapshots directory.
    const prevCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      installFetch({ runId: 'x/../../../outside', snapshotContent: 'unrecognizable raw content' })

      await runInDeepnoteCloud(undefined, { cloud: true, notebookId: 'nb', token: 't', url: API_URL })

      // Unsanitized, this runId would resolve to `<parent of tmpDir>/outside.snapshot.deepnote`.
      const escaped = join(tmpDir, '..', 'outside.snapshot.deepnote')
      await expect(
        fs.access(escaped).then(
          () => true,
          () => false
        )
      ).resolves.toBe(false)

      // Exactly one sanitized file lands inside ./snapshots, with no path separators in its name.
      const snaps = await listSnapshots(join(tmpDir, 'snapshots'))
      expect(snaps).toHaveLength(1)
      expect(snaps[0]).toMatch(/^deepnote-run-[A-Za-z0-9_-]+\.snapshot\.deepnote$/)
    } finally {
      process.chdir(prevCwd)
    }
  })

  it('writes raw bytes to --out when the payload is unrecognizable', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    installFetch({ snapshotContent: 'just some text' })
    const path = await writeFixture('single.deepnote', file)
    const out = join(tmpDir, 'raw.out')

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, out })

    await expect(fs.readFile(out, 'utf-8')).resolves.toBe('just some text')
  })
})

describe('runInDeepnoteCloud — output and exit codes', () => {
  it('emits a success JSON result and exits 0', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    installFetch({ terminalStatus: 'success', snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, output: 'json' })

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string
    const result = JSON.parse(logged)
    expect(result).toMatchObject({ success: true, runId: 'run-x', status: 'success' })
    expect(result.snapshotPath).toBeTruthy()
    expect(process.exitCode).toBe(ExitCode.Success)
  })

  it('fails a successful run that returns no snapshot content (exit 1, success=false)', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    installFetch({ terminalStatus: 'success' }) // no snapshotContent, no downloadUrl
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, output: 'json' })

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string
    const result = JSON.parse(logged)
    expect(result.success).toBe(false)
    expect(result.status).toBe('success')
    expect(result.error).toMatch(/no snapshot content/i)
    expect(result.snapshotPath).toBeUndefined()
    expect(process.exitCode).toBe(ExitCode.Error)
  })

  it('reports runId and status when the defensive snapshot re-fetch fails', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    const path = await writeFixture('single.deepnote', file)

    // Poll returns a terminal run with no inline snapshot, so the command re-fetches it — and that
    // re-fetch fails. The run itself finished, so its runId/status must survive into the result
    // rather than being lost to a thrown error.
    let gets = 0
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      if (((init?.method as string) ?? 'GET') === 'POST') {
        return response({ run: { id: 'run-x', status: 'pending' } })
      }
      gets += 1
      if (gets === 1) {
        return response({ run: { id: 'run-x', status: 'success' } }) // terminal, no snapshot
      }
      return response('upstream exploded', { ok: false, status: 503, statusText: 'Service Unavailable' })
    })

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, output: 'json' })

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string
    const result = JSON.parse(logged)
    expect(result.success).toBe(false)
    expect(result.runId).toBe('run-x')
    expect(result.status).toBe('success')
    expect(result.error).toMatch(/no snapshot content/i)
    expect(process.exitCode).toBe(ExitCode.Error)
  })

  it('exits 1 on a failed run but preserves runId, status, error, and snapshotPath', async () => {
    const file = makeFile([{ id: 'nb-single', name: 'Main' }])
    installFetch({ terminalStatus: 'error', runError: 'kernel died', snapshotContent: serializeDeepnoteFile(file) })
    const path = await writeFixture('single.deepnote', file)

    await runInDeepnoteCloud(path, { cloud: true, token: 't', url: API_URL, output: 'json' })

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string
    const result = JSON.parse(logged)
    expect(result).toMatchObject({
      success: false,
      runId: 'run-x',
      status: 'error',
      error: 'kernel died',
    })
    expect(result.snapshotPath).toBeTruthy()
    expect(process.exitCode).toBe(ExitCode.Error)
  })
})
