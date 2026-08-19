import type { DeepnoteFile } from '@deepnote/blocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runnerMock = vi.hoisted(() => ({
  planNotebookSync: vi.fn(),
  syncNotebookContent: vi.fn(),
}))
const promptMock = vi.hoisted(() => ({ promptForBooleanField: vi.fn() }))

vi.mock('@deepnote/local-runner', () => runnerMock)
vi.mock('./inquirer', () => promptMock)

import { pushLocalNotebook } from './push-to-cloud'
import { CloudRunUsageError } from './run-in-cloud'

const FILE = {
  version: '1.0.0',
  metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
  project: { id: 'p1', name: 'Test', notebooks: [{ id: 'nb-local', name: 'NB', blocks: [] }] },
} as unknown as DeepnoteFile

const BASE = {
  file: FILE,
  localNotebookId: 'nb-local',
  notebookId: 'nb-cloud',
  baseUrl: 'https://api.example.com',
  token: 'tok',
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    changes: [{ action: 'update', blockId: 'b1', blockType: 'code', reason: 'content changed' }],
    moves: [],
    isEmpty: false,
    warnings: [],
    remoteOrder: ['b1'],
    targetOrder: ['b1'],
    specs: new Map(),
    ...overrides,
  }
}

function syncResult(overrides: Record<string, unknown> = {}) {
  return {
    ...plan(),
    created: [],
    updated: ['b1'],
    deleted: [],
    movesApplied: 0,
    idRemap: new Map([['b1', 'b1']]),
    ...overrides,
  }
}

let stdinIsTTY: boolean | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stdinIsTTY = process.stdin.isTTY
  // Default to an interactive terminal; individual tests override.
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  runnerMock.syncNotebookContent.mockResolvedValue(syncResult())
  return () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdinIsTTY, configurable: true })
  }
})

describe('pushLocalNotebook', () => {
  it('sends nothing when Deepnote already matches the file', async () => {
    const planned = plan({ isEmpty: true, changes: [] })
    runnerMock.planNotebookSync.mockResolvedValue(planned)

    const outcome = await pushLocalNotebook({ ...BASE })

    expect(outcome).toMatchObject({ applied: false, declined: false, previewed: false })
    expect(outcome.plan).toBe(planned)
    expect(runnerMock.syncNotebookContent).not.toHaveBeenCalled()
    expect(promptMock.promptForBooleanField).not.toHaveBeenCalled()
  })

  it('reports an empty plan as previewed under dryRun, so the caller does not run either', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan({ isEmpty: true, changes: [] }))

    const outcome = await pushLocalNotebook({ ...BASE, dryRun: true })

    expect(outcome.previewed).toBe(true)
    expect(outcome.applied).toBe(false)
    expect(runnerMock.syncNotebookContent).not.toHaveBeenCalled()
  })

  it('previews without sending or prompting when dryRun is set', async () => {
    const planned = plan()
    runnerMock.planNotebookSync.mockResolvedValue(planned)

    const outcome = await pushLocalNotebook({ ...BASE, dryRun: true })

    expect(outcome.previewed).toBe(true)
    expect(outcome.applied).toBe(false)
    // The caller renders machine-output previews itself, so the plan must ride along.
    expect(outcome.plan).toBe(planned)
    expect(runnerMock.syncNotebookContent).not.toHaveBeenCalled()
    expect(promptMock.promptForBooleanField).not.toHaveBeenCalled()
  })

  it('asks before sending, and sends nothing when the answer is no', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())
    promptMock.promptForBooleanField.mockResolvedValue(false)

    const outcome = await pushLocalNotebook({ ...BASE })

    expect(promptMock.promptForBooleanField).toHaveBeenCalled()
    expect(outcome.declined).toBe(true)
    expect(outcome.applied).toBe(false)
    expect(runnerMock.syncNotebookContent).not.toHaveBeenCalled()
  })

  it('sends when the answer is yes', async () => {
    const planned = plan()
    runnerMock.planNotebookSync.mockResolvedValue(planned)
    promptMock.promptForBooleanField.mockResolvedValue(true)

    const outcome = await pushLocalNotebook({ ...BASE })

    expect(outcome.applied).toBe(true)
    expect(runnerMock.syncNotebookContent).toHaveBeenCalledWith(
      FILE,
      'nb-local',
      'nb-cloud',
      expect.objectContaining({ token: 'tok', baseUrl: 'https://api.example.com' })
    )
    // The very plan the user approved is applied — not a re-plan that could differ from it.
    expect(runnerMock.syncNotebookContent.mock.calls[0][3].plan).toBe(planned)
  })

  it('skips the question entirely with --yes', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())

    const outcome = await pushLocalNotebook({ ...BASE, yes: true })

    expect(promptMock.promptForBooleanField).not.toHaveBeenCalled()
    expect(outcome.applied).toBe(true)
  })

  it('refuses rather than hanging when there is no terminal to ask in', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

    // A usage error, so the CLI exits 2 rather than reporting a failed run.
    await expect(pushLocalNotebook({ ...BASE })).rejects.toBeInstanceOf(CloudRunUsageError)
    await expect(pushLocalNotebook({ ...BASE })).rejects.toThrow(/--yes/)
    expect(runnerMock.syncNotebookContent).not.toHaveBeenCalled()
  })

  it('refuses rather than prompting into machine-readable output', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())

    await expect(pushLocalNotebook({ ...BASE, machineOutput: true })).rejects.toBeInstanceOf(CloudRunUsageError)
    expect(promptMock.promptForBooleanField).not.toHaveBeenCalled()
  })

  it('still pushes with --yes under machine output', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())

    const outcome = await pushLocalNotebook({ ...BASE, yes: true, machineOutput: true })

    expect(outcome.applied).toBe(true)
  })

  it('returns the sync result so the caller can remap recreated block ids', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())
    runnerMock.syncNotebookContent.mockResolvedValue(
      syncResult({ created: [{ localId: 'b1', cloudId: 'new-1' }], idRemap: new Map([['b1', 'new-1']]) })
    )

    const outcome = await pushLocalNotebook({ ...BASE, yes: true })

    expect(outcome.result?.idRemap.get('b1')).toBe('new-1')
  })

  it('rethrows a mid-push failure rather than reporting a push that did not happen', async () => {
    // The path a user hits when the API 403s partway through the sync.
    runnerMock.planNotebookSync.mockResolvedValue(plan())
    runnerMock.syncNotebookContent.mockRejectedValue(new Error('403 while updating block b1'))

    await expect(pushLocalNotebook({ ...BASE, yes: true })).rejects.toThrow(/403 while updating block b1/)
  })

  it('plans against the same notebook it later syncs', async () => {
    runnerMock.planNotebookSync.mockResolvedValue(plan())

    await pushLocalNotebook({ ...BASE, yes: true })

    expect(runnerMock.planNotebookSync).toHaveBeenCalledWith(
      FILE,
      'nb-local',
      'nb-cloud',
      expect.objectContaining({ dryRun: true })
    )
  })
})
