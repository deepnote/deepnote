import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMock = vi.hoisted(() => ({
  triggerNotebookRun: vi.fn(),
  pollRunUntilComplete: vi.fn(),
  fetchSnapshotContent: vi.fn(),
  getRun: vi.fn(),
  upsertNotebookSchedule: vi.fn(),
  createProject: vi.fn(),
  addNotebooksToProject: vi.fn(),
  findNotebook: vi.fn(),
  findProject: vi.fn(),
  getWorkspace: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  triggerNotebookRun: cloudMock.triggerNotebookRun,
  pollRunUntilComplete: cloudMock.pollRunUntilComplete,
  fetchSnapshotContent: cloudMock.fetchSnapshotContent,
  getRun: cloudMock.getRun,
  upsertNotebookSchedule: cloudMock.upsertNotebookSchedule,
  createProject: cloudMock.createProject,
  addNotebooksToProject: cloudMock.addNotebooksToProject,
  findNotebook: cloudMock.findNotebook,
  findProject: cloudMock.findProject,
  getWorkspace: cloudMock.getWorkspace,
  isSuccessStatus: (status: string) => status === 'success',
  describeRunError: () => undefined,
  notebookUrl: (params: { projectId: string; notebookId: string }) =>
    `https://deepnote.com/project/-${params.projectId}/notebook/${params.notebookId}`,
}))

import { coordinateCloudNotebook } from './cloud-notebook-coordinator'
import { runInCloud } from './run-in-cloud'
import { scheduleInCloud } from './schedule-in-cloud'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-local
  name: Concurrent report
  notebooks:
    - id: notebook-local
      name: Report
      blocks:
        - blockGroup: group-input
          content: ''
          id: input-local
          metadata:
            deepnote_variable_name: audience
            deepnote_variable_value: Everyone
          sortingKey: a0
          type: input-text
        - blockGroup: group-code
          content: print(audience)
          id: code-local
          metadata: {}
          sortingKey: a1
          type: code
version: '1.0.0'
`

function notFound(): Error & { statusCode: number } {
  return Object.assign(new Error('Notebook not found'), { statusCode: 404 })
}

function schedule(notebookId: string, cron: string) {
  return {
    notebookId,
    cron,
    timezone: 'Europe/London',
    nextRunAt: '2026-08-01T08:00:00Z',
    createdAt: '2026-07-30T12:00:00Z',
    updatedAt: '2026-07-30T12:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.triggerNotebookRun.mockImplementation(
    async (_baseUrl: string, _token: string, request: { notebookId: string }) => {
      if (request.notebookId === 'notebook-local') throw notFound()
      return { runId: 'run-1', status: 'running' }
    }
  )
  cloudMock.upsertNotebookSchedule.mockImplementation(
    async (_baseUrl: string, _token: string, notebookId: string, body: { cron: string }) => {
      if (notebookId === 'notebook-local') throw notFound()
      return schedule(notebookId, body.cron)
    }
  )
  cloudMock.pollRunUntilComplete.mockResolvedValue({
    runId: 'run-1',
    status: 'success',
    snapshot: { snapshotContent: NOTEBOOK },
  })
  cloudMock.fetchSnapshotContent.mockResolvedValue(NOTEBOOK)
  cloudMock.findNotebook.mockResolvedValue(undefined)
  cloudMock.findProject.mockResolvedValue(undefined)
  cloudMock.getWorkspace.mockResolvedValue({ id: 'workspace-1', slug: 'deepnote' })
})

describe('cloud notebook creation coordination', () => {
  it.each(['run', 'schedule'] as const)('shares one create when %s starts before the other operation', async first => {
    let releaseCreate!: (value: {
      projectId: string
      notebooks: Array<{ id: string; name: string; blockIds: string[] }>
    }) => void
    cloudMock.createProject.mockReturnValue(
      new Promise(resolve => {
        releaseCreate = resolve
      })
    )

    let runPromise: ReturnType<typeof runInCloud> | undefined
    let schedulePromise: ReturnType<typeof scheduleInCloud> | undefined
    const startRun = () =>
      runInCloud(
        NOTEBOOK,
        { audience: 'Leadership' },
        { token: 'token', blockIds: ['code-local'], poll: { sleep: async () => undefined } }
      )
    const startSchedule = () => scheduleInCloud(NOTEBOOK, '0 9 * * 1-5', { token: 'token', timezone: 'Europe/London' })

    if (first === 'run') runPromise = startRun()
    else schedulePromise = startSchedule()

    await vi.waitFor(() => expect(cloudMock.createProject).toHaveBeenCalledOnce())

    if (first === 'run') schedulePromise = startSchedule()
    else runPromise = startRun()

    await vi.waitFor(() => {
      expect(cloudMock.triggerNotebookRun).toHaveBeenCalled()
      expect(cloudMock.upsertNotebookSchedule).toHaveBeenCalled()
    })
    expect(cloudMock.createProject).toHaveBeenCalledOnce()

    releaseCreate({
      projectId: 'project-cloud',
      notebooks: [
        {
          id: 'notebook-cloud',
          name: 'Report',
          blockIds: ['input-cloud', 'code-cloud'],
        },
      ],
    })

    const [runResult, scheduleResult] = await Promise.all([runPromise, schedulePromise])

    expect(cloudMock.createProject).toHaveBeenCalledOnce()
    expect(cloudMock.findProject).toHaveBeenCalledOnce()
    expect(cloudMock.findNotebook).toHaveBeenCalledOnce()
    expect(cloudMock.triggerNotebookRun).toHaveBeenLastCalledWith('https://api.deepnote.com', 'token', {
      notebookId: 'notebook-cloud',
      inputs: { audience: 'Leadership' },
      blockIds: ['code-cloud'],
    })
    expect(runResult).toMatchObject({ success: true, created: true })
    expect(scheduleResult).toMatchObject({ notebookId: 'notebook-cloud', created: true })
  })

  it('serializes different notebooks that may mutate the same project', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const shared = {
      baseUrl: 'https://api.deepnote.com',
      token: 'another-token',
      projectName: 'One project',
      allowCreate: true,
    }

    const first = coordinateCloudNotebook({ ...shared, notebookId: 'local-a', notebookName: 'A' }, async () => {
      order.push('a:start')
      await firstGate
      order.push('a:end')
      return { notebookId: 'cloud-a', projectId: 'cloud-project', created: true }
    })
    await vi.waitFor(() => expect(order).toEqual(['a:start']))

    const second = coordinateCloudNotebook({ ...shared, notebookId: 'local-b', notebookName: 'B' }, async () => {
      order.push('b:start')
      return { notebookId: 'cloud-b', projectId: 'cloud-project', created: true }
    })

    await Promise.resolve()
    expect(order).toEqual(['a:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })
})
