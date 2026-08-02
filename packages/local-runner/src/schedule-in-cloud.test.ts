import { ApiError } from '@deepnote/database-integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloudMock = vi.hoisted(() => ({
  upsertNotebookSchedule: vi.fn(),
  findNotebook: vi.fn(),
  findProject: vi.fn(),
  createProject: vi.fn(),
  addNotebooksToProject: vi.fn(),
  getWorkspace: vi.fn(),
}))

vi.mock('@deepnote/cloud', () => ({
  upsertNotebookSchedule: cloudMock.upsertNotebookSchedule,
  findNotebook: cloudMock.findNotebook,
  findProject: cloudMock.findProject,
  createProject: cloudMock.createProject,
  addNotebooksToProject: cloudMock.addNotebooksToProject,
  getWorkspace: cloudMock.getWorkspace,
  notebookUrl: (params: { workspaceId: string; projectId: string; notebookId: string }) =>
    `https://deepnote.com/workspace/${params.workspaceId}/project/-${params.projectId}/notebook/${params.notebookId}`,
}))

import { scheduleInCloud } from './schedule-in-cloud'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-local
  name: Scheduled report
  notebooks:
    - id: notebook-local
      name: Daily report
      blocks:
        - blockGroup: group-1
          content: print("report")
          id: block-local
          metadata: {}
          sortingKey: a0
          type: code
version: '1.0.0'
`

const MULTI_NOTEBOOK = NOTEBOOK.replace(
  "version: '1.0.0'",
  `    - id: notebook-two
      name: Other report
      blocks: []
version: '1.0.0'`
)

/** A composed `[init, main]` file: the shape whose init designation creation cannot carry over. */
const INIT_NOTEBOOK = NOTEBOOK.replace(
  '  name: Scheduled report',
  '  name: Scheduled report\n  initNotebookId: notebook-init'
).replace(
  "version: '1.0.0'",
  `    - id: notebook-init
      name: Setup
      blocks: []
version: '1.0.0'`
)

function schedule(notebookId: string) {
  return {
    notebookId,
    cron: '0 9 * * 1-5',
    timezone: 'Europe/London',
    nextRunAt: '2026-07-30T08:00:00Z',
    createdAt: '2026-07-29T12:00:00Z',
    updatedAt: '2026-07-29T12:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cloudMock.getWorkspace.mockResolvedValue({ id: 'workspace-1' })
  cloudMock.findNotebook.mockResolvedValue(undefined)
  cloudMock.findProject.mockResolvedValue(undefined)
  cloudMock.upsertNotebookSchedule.mockResolvedValue(schedule('notebook-local'))
})

describe('scheduleInCloud', () => {
  it('schedules the file notebook directly without running or creating it', async () => {
    const result = await scheduleInCloud(NOTEBOOK, '0 9 * * 1-5', {
      token: 'token',
      timezone: 'Europe/London',
    })

    expect(cloudMock.upsertNotebookSchedule).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'token',
      'notebook-local',
      { cron: '0 9 * * 1-5', timezone: 'Europe/London' },
      { requestTimeoutMs: undefined }
    )
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    expect(result).toMatchObject({ notebookId: 'notebook-local' })
    expect(result).not.toHaveProperty('created')
  })

  it('falls back to the cloud notebook matched by project and notebook name', async () => {
    cloudMock.upsertNotebookSchedule
      // Built workspace packages can carry separate ApiError class identities, so this intentionally
      // looks like the public error contract without being an instanceof the local copy.
      .mockRejectedValueOnce(Object.assign(new Error('Notebook not found'), { statusCode: 404 }))
      .mockResolvedValueOnce(schedule('notebook-cloud'))
    cloudMock.findNotebook.mockResolvedValue({ notebookId: 'notebook-cloud', projectId: 'project-cloud' })

    const result = await scheduleInCloud(NOTEBOOK, '0 9 * * *', { token: 'token' })

    expect(cloudMock.findNotebook).toHaveBeenCalledWith('https://api.deepnote.com', 'token', {
      projectName: 'Scheduled report',
      notebookName: 'Daily report',
    })
    expect(cloudMock.upsertNotebookSchedule).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      'token',
      'notebook-cloud',
      { cron: '0 9 * * *' },
      { requestTimeoutMs: undefined }
    )
    expect(result).toMatchObject({ notebookId: 'notebook-cloud' })
    expect(result).not.toHaveProperty('created')
  })

  it('preserves an explicitly empty timezone so the cloud client can validate it', async () => {
    await scheduleInCloud(NOTEBOOK, '0 9 * * *', { token: 'token', timezone: '' })

    expect(cloudMock.upsertNotebookSchedule).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'token',
      'notebook-local',
      { cron: '0 9 * * *', timezone: '' },
      { requestTimeoutMs: undefined }
    )
  })

  it('creates a missing project and then schedules its assigned notebook id', async () => {
    cloudMock.upsertNotebookSchedule
      .mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))
      .mockResolvedValueOnce(schedule('notebook-created'))
    cloudMock.createProject.mockResolvedValue({
      projectId: 'project-created',
      notebooks: [{ id: 'notebook-created', name: 'Daily report', blockIds: ['block-created'] }],
    })
    const progress = vi.fn()

    const result = await scheduleInCloud(NOTEBOOK, '0 * * * *', {
      token: 'token',
      onCreateProgress: progress,
    })

    expect(cloudMock.createProject).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'token',
      expect.objectContaining({
        name: 'Scheduled report',
        notebooks: [
          expect.objectContaining({
            sourceId: 'notebook-local',
            name: 'Daily report',
            blocks: [expect.objectContaining({ type: 'code', content: 'print("report")' })],
          }),
        ],
      }),
      expect.objectContaining({ onProgress: progress })
    )
    expect(cloudMock.upsertNotebookSchedule).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      'token',
      'notebook-created',
      { cron: '0 * * * *' },
      { requestTimeoutMs: undefined }
    )
    expect(result).toMatchObject({
      notebookId: 'notebook-created',
      created: true,
      viewUrl: expect.stringContaining('notebook-created'),
    })
  })

  it('adds a missing notebook to an existing project instead of creating a duplicate project', async () => {
    cloudMock.upsertNotebookSchedule
      .mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))
      .mockResolvedValueOnce(schedule('notebook-created'))
    cloudMock.findProject.mockResolvedValue({
      projectId: 'project-existing',
      notebooks: [{ id: 'other-cloud', name: 'Other report' }],
    })
    cloudMock.addNotebooksToProject.mockResolvedValue({
      projectId: 'project-existing',
      notebooks: [{ id: 'notebook-created', name: 'Daily report', blockIds: ['block-created'] }],
    })

    const result = await scheduleInCloud(NOTEBOOK, '0 * * * *', { token: 'token' })

    expect(cloudMock.addNotebooksToProject).toHaveBeenCalledWith(
      'https://api.deepnote.com',
      'token',
      'project-existing',
      [
        expect.objectContaining({
          sourceId: 'notebook-local',
          name: 'Daily report',
        }),
      ],
      expect.objectContaining({ existingNotebookIds: new Map() })
    )
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      notebookId: 'notebook-created',
      created: true,
    })
  })

  it('does not create content when createIfMissing is false', async () => {
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))

    await expect(scheduleInCloud(NOTEBOOK, '0 9 * * *', { token: 'token', createIfMissing: false })).rejects.toThrow(
      /Notebook not found/
    )
    expect(cloudMock.findProject).not.toHaveBeenCalled()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    expect(cloudMock.addNotebooksToProject).not.toHaveBeenCalled()
  })

  it('does not treat permission or network failures as a missing notebook', async () => {
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(403, 'Scheduling unavailable'))

    await expect(scheduleInCloud(NOTEBOOK, '0 9 * * *', { token: 'token' })).rejects.toThrow(/Scheduling unavailable/)
    expect(cloudMock.findNotebook).not.toHaveBeenCalled()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('requires a local target before creating from a multi-notebook file', async () => {
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))

    await expect(
      scheduleInCloud(MULTI_NOTEBOOK, '0 9 * * *', { token: 'token', notebookId: 'unknown-cloud-id' })
    ).rejects.toThrow(/cannot be matched to local content/)
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('refuses to create content for a file whose init notebook would be lost', async () => {
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))

    await expect(
      scheduleInCloud(INIT_NOTEBOOK, '0 9 * * *', { token: 'token', notebookId: 'notebook-local' })
    ).rejects.toThrow(/init notebook "Setup" cannot be preserved/)
    // Refused before anything is written, so there is no half-built project to clean up.
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    expect(cloudMock.addNotebooksToProject).not.toHaveBeenCalled()
    expect(cloudMock.upsertNotebookSchedule).toHaveBeenCalledOnce()
  })

  it('still schedules an init-backed file that is already in Deepnote', async () => {
    // Nothing is created, so Deepnote keeps whatever init designation the project already has —
    // the refusal above is about the create path only.
    cloudMock.upsertNotebookSchedule.mockReset()
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))
    cloudMock.upsertNotebookSchedule.mockResolvedValueOnce(schedule('notebook-cloud'))
    cloudMock.findNotebook.mockResolvedValue({ notebookId: 'notebook-cloud', projectId: 'project-cloud' })

    const result = await scheduleInCloud(INIT_NOTEBOOK, '0 9 * * *', { token: 'token', notebookId: 'notebook-local' })

    expect(result.notebookId).toBe('notebook-cloud')
    expect(result.created).toBeUndefined()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
  })

  it('adds an init-backed notebook to an existing project rather than refusing it', async () => {
    // The project is in Deepnote and keeps its own init designation; only the notebook is missing.
    // Refusing here would name an action ("import the project first") the user has already taken.
    cloudMock.upsertNotebookSchedule.mockReset()
    cloudMock.upsertNotebookSchedule.mockRejectedValueOnce(new ApiError(404, 'Notebook not found'))
    cloudMock.upsertNotebookSchedule.mockResolvedValueOnce(schedule('notebook-created'))
    cloudMock.findProject.mockResolvedValue({ projectId: 'project-existing', projectType: 'standard', notebooks: [] })
    cloudMock.addNotebooksToProject.mockResolvedValue({
      projectId: 'project-existing',
      notebooks: [{ id: 'notebook-created', name: 'Daily report', blockIds: ['block-created'] }],
    })

    const result = await scheduleInCloud(INIT_NOTEBOOK, '0 9 * * *', { token: 'token', notebookId: 'notebook-local' })

    expect(result).toMatchObject({ notebookId: 'notebook-created', created: true })
    expect(cloudMock.addNotebooksToProject).toHaveBeenCalledOnce()
    expect(cloudMock.createProject).not.toHaveBeenCalled()
    // The retry has to name the notebook that was just created, not the file's own id — the point
    // of the fallback is that Deepnote assigned a different one.
    expect(cloudMock.upsertNotebookSchedule).toHaveBeenLastCalledWith(
      'https://api.deepnote.com',
      'token',
      'notebook-created',
      { cron: '0 9 * * *' },
      { requestTimeoutMs: undefined }
    )
  })

  it('requires a token before making any API call', async () => {
    const original = process.env.DEEPNOTE_TOKEN
    delete process.env.DEEPNOTE_TOKEN
    try {
      await expect(scheduleInCloud(NOTEBOOK, '0 9 * * *')).rejects.toThrow(/API token is required/)
      expect(cloudMock.upsertNotebookSchedule).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) delete process.env.DEEPNOTE_TOKEN
      else process.env.DEEPNOTE_TOKEN = original
    }
  })
})
