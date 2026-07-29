import { fileURLToPath } from 'node:url'
import { ApiError } from '@deepnote/database-integrations'
import type { ScheduleInCloudResult } from '@deepnote/local-runner'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig } from '../output'

const localRunnerMock = vi.hoisted(() => ({
  scheduleInCloud: vi.fn(),
}))

vi.mock('@deepnote/local-runner', () => ({
  scheduleInCloud: localRunnerMock.scheduleInCloud,
}))

vi.mock('../utils/browser', () => ({
  openInBrowser: vi.fn().mockResolvedValue(undefined),
}))

import { openInBrowser } from '../utils/browser'
import { createScheduleAction, type ScheduleOptions } from './schedule'

const HELLO_WORLD_FILE = fileURLToPath(new URL('../../../../examples/1_hello_world.deepnote', import.meta.url))
const MULTI_NOTEBOOK_FILE = fileURLToPath(
  new URL('../../../../test-fixtures/Dashboard-using-modules.deepnote', import.meta.url)
)
const NOTEBOOK_ID = '7061f86dec6e4e11893288f295a82017'

const RESULT: ScheduleInCloudResult = {
  notebookId: NOTEBOOK_ID,
  schedule: {
    notebookId: NOTEBOOK_ID,
    cron: '30 8 * * 1',
    timezone: 'Europe/London',
    nextRunAt: '2026-08-03T07:30:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
  viewUrl: 'https://deepnote.com/workspace/workspace/project/-project/notebook/notebook',
}

function options(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    create: true,
    token: 'test-token',
    weekly: 'Monday',
    at: '08:30',
    timezone: 'Europe/London',
    ...overrides,
  }
}

describe('schedule command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetOutputConfig()
    process.exitCode = undefined
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localRunnerMock.scheduleInCloud.mockResolvedValue(RESULT)
    vi.mocked(openInBrowser).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.exitCode = undefined
    resetOutputConfig()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('converts a friendly schedule and installs it without running the notebook', async () => {
    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options())

    expect(localRunnerMock.scheduleInCloud).toHaveBeenCalledOnce()
    expect(localRunnerMock.scheduleInCloud).toHaveBeenCalledWith(HELLO_WORLD_FILE, '30 8 * * 1', {
      token: 'test-token',
      baseUrl: 'https://api.deepnote.com',
      notebookId: undefined,
      timezone: 'Europe/London',
      createIfMissing: true,
      onWarning: expect.any(Function),
    })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Scheduled in Deepnote Cloud')
    expect(process.exitCode).toBeUndefined()
  })

  it('passes the selected local notebook id and no-create behavior', async () => {
    await createScheduleAction(new Command())(
      HELLO_WORLD_FILE,
      options({
        notebook: '1. Hello World - example',
        create: false,
      })
    )

    expect(localRunnerMock.scheduleInCloud).toHaveBeenCalledWith(
      HELLO_WORLD_FILE,
      '30 8 * * 1',
      expect.objectContaining({
        notebookId: NOTEBOOK_ID,
        createIfMissing: false,
      })
    )
  })

  it('outputs a single machine-readable JSON document', async () => {
    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ output: 'json' }))

    const parsed = JSON.parse(logSpy.mock.calls.flat().join('\n'))
    expect(parsed).toEqual({
      success: true,
      path: HELLO_WORLD_FILE,
      notebookId: NOTEBOOK_ID,
      created: false,
      schedule: RESULT.schedule,
      url: RESULT.viewUrl,
    })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('opens the scheduled notebook only when requested', async () => {
    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ open: true }))

    expect(openInBrowser).toHaveBeenCalledWith(RESULT.viewUrl)
  })

  it('reports an unknown notebook as invalid usage', async () => {
    await createScheduleAction(new Command())(
      HELLO_WORLD_FILE,
      options({ weekly: undefined, notebook: 'Missing notebook' })
    )

    expect(process.exitCode).toBe(2)
    expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Missing notebook')
  })

  it('requires exactly one frequency', async () => {
    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ weekly: undefined }))

    expect(process.exitCode).toBe(2)
    expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Choose a schedule')
  })

  it('requires --notebook for a multi-notebook file', async () => {
    await createScheduleAction(new Command())(MULTI_NOTEBOOK_FILE, options())

    expect(process.exitCode).toBe(2)
    expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--notebook')
  })

  it('reports authentication and plan failures as invalid usage', async () => {
    localRunnerMock.scheduleInCloud.mockRejectedValueOnce(new ApiError(403, 'Scheduling is not enabled'))

    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options())

    expect(process.exitCode).toBe(2)
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Scheduling is not enabled')
  })

  it('reports API validation failures as invalid usage', async () => {
    localRunnerMock.scheduleInCloud.mockRejectedValueOnce(new ApiError(400, 'Invalid cron expression'))

    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options())

    expect(process.exitCode).toBe(2)
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Invalid cron expression')
  })

  it('reports other API failures as runtime errors in JSON mode', async () => {
    localRunnerMock.scheduleInCloud.mockRejectedValueOnce(new ApiError(500, 'Cloud unavailable'))

    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ output: 'json' }))

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      success: false,
      error: 'Cloud unavailable',
    })
  })
})
