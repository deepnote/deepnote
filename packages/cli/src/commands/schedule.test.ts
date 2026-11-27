import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Schedule } from '@deepnote/cloud'
import { ApiError } from '@deepnote/database-integrations'
import {
  type addScheduleInCloud,
  type listSchedulesInCloud,
  MultipleSchedulesError,
  type removeScheduleInCloud,
  type ScheduleInCloudResult,
  ScheduleNotFoundError,
  type scheduleInCloud,
  type UpdateScheduleInCloudResult,
  type unscheduleInCloud,
  type updateScheduleInCloud,
} from '@deepnote/local-runner'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'

const localRunnerMock = vi.hoisted(() => ({
  addScheduleInCloud: vi.fn<typeof addScheduleInCloud>(),
  scheduleInCloud: vi.fn<typeof scheduleInCloud>(),
  unscheduleInCloud: vi.fn<typeof unscheduleInCloud>(),
  listSchedulesInCloud: vi.fn<typeof listSchedulesInCloud>(),
  updateScheduleInCloud: vi.fn<typeof updateScheduleInCloud>(),
  removeScheduleInCloud: vi.fn<typeof removeScheduleInCloud>(),
}))

vi.mock('@deepnote/local-runner', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/local-runner')>()
  return {
    MultipleSchedulesError: actual.MultipleSchedulesError,
    ScheduleNotFoundError: actual.ScheduleNotFoundError,
    addScheduleInCloud: localRunnerMock.addScheduleInCloud,
    scheduleInCloud: localRunnerMock.scheduleInCloud,
    unscheduleInCloud: localRunnerMock.unscheduleInCloud,
    listSchedulesInCloud: localRunnerMock.listSchedulesInCloud,
    updateScheduleInCloud: localRunnerMock.updateScheduleInCloud,
    removeScheduleInCloud: localRunnerMock.removeScheduleInCloud,
  }
})

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
const COMPOSED_FILE = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: project-local
  name: Composed report
  initNotebookId: notebook-init
  notebooks:
    - id: notebook-init
      name: Setup
      blocks: []
    - id: notebook-main
      name: Daily report
      blocks: []
version: '1.0.0'
`

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

function removeOptions(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    create: true,
    token: 'test-token',
    remove: true,
    ...overrides,
  }
}

const STORED: Schedule = {
  id: '15',
  notebookId: NOTEBOOK_ID,
  cron: '0 9 * * *',
  timezone: 'Europe/Prague',
  nextRunAt: '2026-11-28T08:00:00.000Z',
  isPaused: false,
  pauseReason: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-02T12:00:00.000Z',
  name: 'Morning refresh',
  inputs: { region: 'EU', api_secret: 'hunter2' },
  updatesNotebook: true,
}

const PAUSED: Schedule = {
  ...STORED,
  id: '16',
  cron: '0 18 * * 1-5',
  timezone: 'UTC',
  isPaused: true,
  pauseReason: 'consecutive-failures',
  name: null,
  inputs: null,
  updatesNotebook: false,
}

const UPDATE_RESULT: UpdateScheduleInCloudResult = {
  notebookId: NOTEBOOK_ID,
  previous: STORED,
  schedule: { ...STORED, cron: '30 7 * * *', nextRunAt: '2026-11-28T06:30:00.000Z' },
  changed: true,
  viewUrl: RESULT.viewUrl,
}

const SEVERAL_SCHEDULES =
  'Notebook has several schedules; list them with GET /v2/schedules?notebookId=<id>, then use PATCH or DELETE /v2/schedules/{scheduleId}.'

function listOptions(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return { create: true, token: 'test-token', list: true, ...overrides }
}

function updateOptions(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return { create: true, token: 'test-token', scheduleId: '15', daily: true, at: '07:30', ...overrides }
}

function addOptions(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    create: true,
    token: 'test-token',
    add: true,
    daily: true,
    at: '18:00',
    timezone: 'Europe/Prague',
    ...overrides,
  }
}

const INPUTS_FILE = fileURLToPath(new URL('../../../../examples/6_with_inputs.deepnote', import.meta.url))

const ADDED: Schedule = {
  ...STORED,
  id: '17',
  cron: '0 18 * * *',
  nextRunAt: '2026-11-27T17:00:00.000Z',
  name: 'Evening',
  inputs: { greeting: 'Hi', enabled: true },
  updatesNotebook: false,
}

const STORED_JSON = {
  id: '15',
  name: 'Morning refresh',
  cron: '0 9 * * *',
  timezone: 'Europe/Prague',
  nextRunAt: '2026-11-28T08:00:00.000Z',
  isPaused: false,
  pauseReason: null,
  updatesNotebook: true,
  inputNames: ['region', 'api_secret'],
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-02T12:00:00.000Z',
}

describe('schedule command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  const tempDirs: string[] = []

  function writeTempFile(name: string, contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cli-schedule-'))
    tempDirs.push(dir)
    const path = join(dir, name)
    writeFileSync(path, contents)
    return path
  }

  beforeEach(() => {
    resetOutputConfig()
    setOutputConfig({ color: false })
    process.exitCode = undefined
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localRunnerMock.scheduleInCloud.mockResolvedValue(RESULT)
    localRunnerMock.unscheduleInCloud.mockResolvedValue({ notebookId: NOTEBOOK_ID, removed: true })
    localRunnerMock.listSchedulesInCloud.mockResolvedValue({ notebookId: NOTEBOOK_ID, schedules: [STORED, PAUSED] })
    localRunnerMock.updateScheduleInCloud.mockResolvedValue(UPDATE_RESULT)
    localRunnerMock.removeScheduleInCloud.mockResolvedValue({ notebookId: NOTEBOOK_ID, removed: true })
    localRunnerMock.addScheduleInCloud.mockResolvedValue({
      notebookId: NOTEBOOK_ID,
      added: true,
      schedule: ADDED,
      viewUrl: RESULT.viewUrl,
    })
    vi.mocked(openInBrowser).mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.exitCode = undefined
    resetOutputConfig()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop() as string, { recursive: true, force: true })
    }
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
      onCreateProgress: expect.any(Function),
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

    expect(localRunnerMock.scheduleInCloud).toHaveBeenCalledWith(
      HELLO_WORLD_FILE,
      expect.any(String),
      expect.objectContaining({ onCreateProgress: undefined })
    )
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

  it('does not open the scheduled notebook by default', async () => {
    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ open: false }))

    expect(openInBrowser).not.toHaveBeenCalled()
  })

  it('reports creation progress in human-readable mode', async () => {
    localRunnerMock.scheduleInCloud.mockImplementationOnce(async (_path, _cron, scheduleOptions) => {
      scheduleOptions?.onCreateProgress?.(3, 7)
      return RESULT
    })

    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options())

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Creating notebook in Deepnote Cloud: 3/7 blocks')
  })

  it('keeps a successful schedule successful when the browser cannot be opened', async () => {
    vi.mocked(openInBrowser).mockRejectedValueOnce(new Error('browser unavailable'))

    await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ open: true }))

    expect(process.exitCode).toBeUndefined()
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Scheduled in Deepnote Cloud')
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('schedule was created')
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('browser unavailable')
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

  it('reports a malformed file as invalid usage', async () => {
    // The command's own help text promises exit code 2 for a file it cannot read, and the
    // other file commands already classify a ParseError that way.
    const path = writeTempFile('broken.deepnote', 'project: [unclosed\n')

    await createScheduleAction(new Command())(path, options())

    expect(process.exitCode).toBe(2)
    expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
  })

  it('reports a file that fails the schema as invalid usage', async () => {
    const path = writeTempFile('wrong-shape.deepnote', 'version: "1.0.0"\nproject: "not an object"\n')

    await createScheduleAction(new Command())(path, options())

    expect(process.exitCode).toBe(2)
    expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
  })

  it('schedules the main notebook of a composed [init, main] file without --notebook', async () => {
    // Two notebooks, but only one of them is runnable — the other is the init that runs before it.
    // Every other command resolves this shape rather than calling it ambiguous.
    const path = writeTempFile('composed.deepnote', COMPOSED_FILE)

    await createScheduleAction(new Command())(path, options())

    expect(process.exitCode).toBeUndefined()
    expect(localRunnerMock.scheduleInCloud).toHaveBeenCalledWith(
      path,
      '30 8 * * 1',
      expect.objectContaining({ notebookId: 'notebook-main' })
    )
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

  describe('--remove', () => {
    it('removes the notebook schedule without scheduling or creating anything', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions())

      expect(localRunnerMock.unscheduleInCloud).toHaveBeenCalledOnce()
      expect(localRunnerMock.unscheduleInCloud).toHaveBeenCalledWith(HELLO_WORLD_FILE, {
        token: 'test-token',
        baseUrl: 'https://api.deepnote.com',
        notebookId: undefined,
      })
      expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Schedule removed from Deepnote Cloud')
      expect(process.exitCode).toBeUndefined()
    })

    it('reports a notebook without a schedule as nothing to remove', async () => {
      localRunnerMock.unscheduleInCloud.mockResolvedValueOnce({ notebookId: NOTEBOOK_ID, removed: false })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions())

      const printed = logSpy.mock.calls.flat().join('\n')
      expect(printed).toContain('Nothing to remove: this notebook has no schedule.')
      expect(printed).not.toContain('Schedule removed')
      expect(process.exitCode).toBeUndefined()
    })

    it('reports a notebook missing from Deepnote Cloud without claiming a removal', async () => {
      localRunnerMock.unscheduleInCloud.mockResolvedValueOnce({ notebookId: null, removed: false })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions())

      const printed = logSpy.mock.calls.flat().join('\n')
      expect(printed).toContain('Nothing removed: this notebook was not found in Deepnote Cloud.')
      expect(printed).not.toContain('Schedule removed')
      expect(process.exitCode).toBeUndefined()
    })

    it.each([
      ['--hourly', { hourly: true }],
      ['--daily', { daily: true }],
      ['--weekly', { weekly: 'Monday' }],
      ['--monthly', { monthly: '1' }],
      ['--cron', { cron: '0 9 * * *' }],
      ['--at', { at: '09:00' }],
      ['--timezone', { timezone: 'UTC' }],
      ['--open', { open: true }],
      ['--add', { add: true }],
      ['--name', { name: 'Evening' }],
      ['--input', { input: ['region=EU'] }],
      ['--clear-inputs', { clearInputs: true }],
    ] satisfies Array<[string, Partial<ScheduleOptions>]>)(
      'rejects --remove combined with %s',
      async (flag, overrides) => {
        await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions(overrides))

        expect(process.exitCode).toBe(2)
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(`--remove cannot be combined with ${flag}`)
        expect(localRunnerMock.unscheduleInCloud).not.toHaveBeenCalled()
        expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
      }
    )

    it('removes the schedule of the notebook selected with --notebook', async () => {
      await createScheduleAction(new Command())(MULTI_NOTEBOOK_FILE, removeOptions({ notebook: 'Data' }))

      expect(process.exitCode).toBeUndefined()
      expect(localRunnerMock.unscheduleInCloud).toHaveBeenCalledWith(
        MULTI_NOTEBOOK_FILE,
        expect.objectContaining({ notebookId: 'efceb59f45724c68b1e39b366bd30ff2' })
      )
    })

    it('requires --notebook to remove a schedule from a multi-notebook file', async () => {
      await createScheduleAction(new Command())(MULTI_NOTEBOOK_FILE, removeOptions())

      expect(process.exitCode).toBe(2)
      expect(localRunnerMock.unscheduleInCloud).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('--notebook')
    })

    it.each([
      [{ notebookId: NOTEBOOK_ID, removed: true }, NOTEBOOK_ID, true],
      [{ notebookId: NOTEBOOK_ID, removed: false }, NOTEBOOK_ID, false],
      [{ notebookId: null, removed: false }, null, false],
    ])(
      'outputs a single machine-readable JSON document for a removal (case %#)',
      async (result, notebookId, removed) => {
        localRunnerMock.unscheduleInCloud.mockResolvedValueOnce(result)

        await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions({ output: 'json' }))

        expect(JSON.parse(logSpy.mock.calls.flat().join('\n'))).toEqual({
          success: true,
          path: HELLO_WORLD_FILE,
          notebookId,
          removed,
        })
        expect(errorSpy).not.toHaveBeenCalled()
      }
    )

    it('requires a token before calling Deepnote', async () => {
      vi.stubEnv('DEEPNOTE_TOKEN', '')

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions({ token: undefined }))

      expect(process.exitCode).toBe(2)
      expect(localRunnerMock.unscheduleInCloud).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Missing authentication token')
    })

    it('reports an authentication failure as invalid usage', async () => {
      localRunnerMock.unscheduleInCloud.mockRejectedValueOnce(
        new ApiError(401, 'Authentication failed. Please check your API token.')
      )

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions())

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Authentication failed')
    })
  })

  describe('--list', () => {
    it("lists the notebook's schedules with input names but no input values", async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, listOptions())

      expect(localRunnerMock.listSchedulesInCloud).toHaveBeenCalledWith(HELLO_WORLD_FILE, {
        token: 'test-token',
        baseUrl: 'https://api.deepnote.com',
        notebookId: undefined,
      })
      const printed = logSpy.mock.calls.flat().join('\n')
      expect(printed).toBe(
        [
          'Schedule 15: Morning refresh (updates notebook)',
          '  Cron: 0 9 * * * (Europe/Prague)',
          '  Next run: 2026-11-28T08:00:00.000Z',
          '  Inputs: region, api_secret',
          '',
          'Schedule 16',
          '  Cron: 0 18 * * 1-5 (UTC)',
          '  Next run: paused (consecutive-failures)',
        ].join('\n')
      )
      expect(printed).not.toContain('hunter2')
      expect(process.exitCode).toBeUndefined()
      expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
    })

    it('outputs the schedules as JSON with input names but no input values', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, listOptions({ output: 'json' }))

      const printed = logSpy.mock.calls.flat().join('\n')
      expect(JSON.parse(printed)).toStrictEqual({
        success: true,
        path: HELLO_WORLD_FILE,
        notebookId: NOTEBOOK_ID,
        schedules: [
          STORED_JSON,
          {
            ...STORED_JSON,
            id: '16',
            name: null,
            cron: '0 18 * * 1-5',
            timezone: 'UTC',
            isPaused: true,
            pauseReason: 'consecutive-failures',
            updatesNotebook: false,
            inputNames: [],
          },
        ],
      })
      expect(printed).not.toContain('hunter2')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it.each([
      [{ notebookId: NOTEBOOK_ID, schedules: [] }, 'This notebook has no schedules.'],
      [{ notebookId: null, schedules: [] }, 'This notebook was not found in Deepnote Cloud.'],
    ])('succeeds with nothing to list (case %#)', async (result, message) => {
      localRunnerMock.listSchedulesInCloud.mockResolvedValueOnce(result)

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, listOptions())

      expect(logSpy.mock.calls.flat().join('\n')).toBe(message)
      expect(process.exitCode).toBeUndefined()
    })

    it.each([
      ['--daily', { daily: true }],
      ['--remove', { remove: true }],
      ['--schedule-id', { scheduleId: '15' }],
      ['--add', { add: true }],
    ] satisfies Array<[string, Partial<ScheduleOptions>]>)(
      'rejects --list combined with %s',
      async (flag, overrides) => {
        await createScheduleAction(new Command())(HELLO_WORLD_FILE, listOptions(overrides))

        expect(process.exitCode).toBe(2)
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(`--list cannot be combined with ${flag}`)
        expect(localRunnerMock.listSchedulesInCloud).not.toHaveBeenCalled()
        expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
        expect(localRunnerMock.unscheduleInCloud).not.toHaveBeenCalled()
        expect(localRunnerMock.removeScheduleInCloud).not.toHaveBeenCalled()
      }
    )
  })

  describe('--schedule-id with timing', () => {
    it('changes one schedule and keeps its timezone when --timezone is omitted', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions())

      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledOnce()
      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledWith(
        HELLO_WORLD_FILE,
        '15',
        { cron: '30 7 * * *' },
        { token: 'test-token', baseUrl: 'https://api.deepnote.com', notebookId: undefined }
      )
      expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
      expect(logSpy.mock.calls.flat().join('\n')).toBe(
        [
          '✓ Schedule 15 updated',
          'Frequency: daily at 07:30',
          'Timezone: Europe/Prague',
          'Next run: 2026-11-28T06:30:00.000Z',
          `URL: ${RESULT.viewUrl}`,
          'Other schedules are not affected.',
        ].join('\n')
      )
      expect(process.exitCode).toBeUndefined()
    })

    it('changes only the timezone', async () => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({
        ...UPDATE_RESULT,
        schedule: { ...STORED, timezone: 'America/New_York' },
      })

      await createScheduleAction(new Command())(
        HELLO_WORLD_FILE,
        updateOptions({ daily: undefined, at: undefined, timezone: 'America/New_York' })
      )

      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledWith(
        HELLO_WORLD_FILE,
        '15',
        { timezone: 'America/New_York' },
        expect.anything()
      )
      const printed = logSpy.mock.calls.flat().join('\n')
      expect(printed).toContain('Frequency: cron 0 9 * * *')
      expect(printed).toContain('Timezone: America/New_York')
    })

    it('says that a paused schedule was resumed', async () => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({ ...UPDATE_RESULT, previous: PAUSED })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions())

      expect(logSpy.mock.calls.flat().join('\n')).toContain('Resumed: it was paused (consecutive-failures).')
    })

    it.each([
      [STORED, 'Next run: 2026-11-28T08:00:00.000Z'],
      [{ ...PAUSED, pauseReason: 'access-revoked' }, 'Next run: paused (access-revoked)'],
    ])('reports an unchanged schedule without claiming a change (case %#)', async (stored, nextRun) => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({
        notebookId: NOTEBOOK_ID,
        previous: stored,
        schedule: stored,
        changed: false,
      })

      await createScheduleAction(new Command())(
        HELLO_WORLD_FILE,
        updateOptions({ scheduleId: stored.id, at: undefined, cron: stored.cron, daily: undefined })
      )

      expect(logSpy.mock.calls.flat().join('\n')).toBe(
        [
          `✓ Schedule ${stored.id} unchanged`,
          `Frequency: cron ${stored.cron}`,
          `Timezone: ${stored.timezone}`,
          nextRun,
        ].join('\n')
      )
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs the changed schedule as JSON with input names but no input values', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ output: 'json' }))

      const printed = logSpy.mock.calls.flat().join('\n')
      expect(JSON.parse(printed)).toStrictEqual({
        success: true,
        path: HELLO_WORLD_FILE,
        notebookId: NOTEBOOK_ID,
        changed: true,
        schedule: { ...STORED_JSON, cron: '30 7 * * *', nextRunAt: '2026-11-28T06:30:00.000Z' },
        url: RESULT.viewUrl,
      })
      expect(printed).not.toContain('hunter2')
    })

    it('opens the notebook when requested', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ open: true }))

      expect(openInBrowser).toHaveBeenCalledWith(RESULT.viewUrl)
    })

    it('requires --at with a frequency', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ at: undefined }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('With --schedule-id, a frequency needs --at')
      expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
    })

    it('requires something to change', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ daily: undefined, at: undefined }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Choose what to change')
      expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
    })

    it('refuses an id that is not one of the notebook’s schedules, pointing to --list', async () => {
      localRunnerMock.updateScheduleInCloud.mockRejectedValueOnce(new ScheduleNotFoundError('99', NOTEBOOK_ID))

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ scheduleId: '99' }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        "Schedule 99 is not one of this notebook's schedules. See them with deepnote schedule <path> --list."
      )
    })

    it('refuses a schedule of a notebook that is not in Deepnote Cloud', async () => {
      localRunnerMock.updateScheduleInCloud.mockRejectedValueOnce(new ScheduleNotFoundError('99', null))

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, updateOptions({ scheduleId: '99' }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'This notebook was not found in Deepnote Cloud, so it has no schedule 99.'
      )
    })
  })

  describe('--schedule-id with --remove', () => {
    it('removes only that schedule', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions({ scheduleId: '15' }))

      expect(localRunnerMock.removeScheduleInCloud).toHaveBeenCalledWith(HELLO_WORLD_FILE, '15', {
        token: 'test-token',
        baseUrl: 'https://api.deepnote.com',
        notebookId: undefined,
      })
      expect(localRunnerMock.unscheduleInCloud).not.toHaveBeenCalled()
      expect(logSpy.mock.calls.flat().join('\n')).toBe('✓ Schedule 15 removed from Deepnote Cloud')
      expect(process.exitCode).toBeUndefined()
    })

    it('reports an absent id as nothing to remove', async () => {
      localRunnerMock.removeScheduleInCloud.mockResolvedValueOnce({ notebookId: NOTEBOOK_ID, removed: false })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions({ scheduleId: '99' }))

      expect(logSpy.mock.calls.flat().join('\n')).toBe('Nothing to remove: schedule 99 is absent from this notebook.')
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs the same JSON as --remove', async () => {
      localRunnerMock.removeScheduleInCloud.mockResolvedValueOnce({ notebookId: NOTEBOOK_ID, removed: false })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, removeOptions({ scheduleId: '99', output: 'json' }))

      expect(JSON.parse(logSpy.mock.calls.flat().join('\n'))).toStrictEqual({
        success: true,
        path: HELLO_WORLD_FILE,
        notebookId: NOTEBOOK_ID,
        removed: false,
      })
      expect(process.exitCode).toBeUndefined()
    })
  })

  it.each([
    [{ name: 'Evening' }, '--name and --input need --add or --schedule-id.'],
    [{ input: ['region=EU'] }, '--name and --input need --add or --schedule-id.'],
    [{ clearInputs: true }, '--clear-inputs needs --schedule-id.'],
  ] satisfies Array<[Partial<ScheduleOptions>, string]>)(
    'refuses %j without --add or --schedule-id',
    async (overrides, message) => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, options(overrides))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(message)
      expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
    }
  )

  describe('--add', () => {
    it('adds a schedule with a name and input values typed by the notebook', async () => {
      await createScheduleAction(new Command())(
        INPUTS_FILE,
        addOptions({ name: 'Evening', input: ['greeting=Hi', 'enabled=true'] })
      )

      expect(localRunnerMock.addScheduleInCloud).toHaveBeenCalledWith(
        INPUTS_FILE,
        { cron: '0 18 * * *', timezone: 'Europe/Prague', name: 'Evening', inputs: { greeting: 'Hi', enabled: true } },
        { token: 'test-token', baseUrl: 'https://api.deepnote.com', notebookId: undefined }
      )
      expect(localRunnerMock.scheduleInCloud).not.toHaveBeenCalled()
      expect(logSpy.mock.calls.flat().join('\n')).toBe(
        [
          '✓ Added schedule 17',
          'Name: Evening',
          'Frequency: daily at 18:00',
          'Timezone: Europe/Prague',
          'Next run: 2026-11-27T17:00:00.000Z',
          'Inputs: greeting, enabled',
          `URL: ${RESULT.viewUrl}`,
          'Other schedules are not affected.',
        ].join('\n')
      )
      expect(process.exitCode).toBeUndefined()
    })

    it('uses the system timezone when --timezone is omitted', async () => {
      const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions({ timezone: undefined }))

      expect(localRunnerMock.addScheduleInCloud).toHaveBeenCalledWith(
        HELLO_WORLD_FILE,
        { cron: '0 18 * * *', timezone: systemTimezone },
        expect.anything()
      )
    })

    it('requires --at with a frequency', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions({ at: undefined }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('With --add, a frequency needs --at')
      expect(localRunnerMock.addScheduleInCloud).not.toHaveBeenCalled()
    })

    it('reports an identical schedule without adding another', async () => {
      localRunnerMock.addScheduleInCloud.mockResolvedValueOnce({
        notebookId: NOTEBOOK_ID,
        added: false,
        schedule: STORED,
      })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions())

      expect(logSpy.mock.calls.flat().join('\n')).toBe(
        'Schedule 15 already exists with the same timing, name and inputs.'
      )
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs the schedule as JSON with input names but no input values', async () => {
      localRunnerMock.addScheduleInCloud.mockResolvedValueOnce({
        notebookId: NOTEBOOK_ID,
        added: false,
        schedule: STORED,
      })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions({ output: 'json' }))

      const printed = logSpy.mock.calls.flat().join('\n')
      expect(JSON.parse(printed)).toStrictEqual({
        success: true,
        path: HELLO_WORLD_FILE,
        notebookId: NOTEBOOK_ID,
        added: false,
        schedule: STORED_JSON,
      })
      expect(printed).not.toContain('hunter2')
    })

    it('refuses a notebook that is not in Deepnote Cloud', async () => {
      localRunnerMock.addScheduleInCloud.mockResolvedValueOnce({ notebookId: null, added: false })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions())

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'This notebook was not found in Deepnote Cloud. Create it first with deepnote schedule <path> and a frequency.'
      )
    })

    it.each([
      ['missing=1', 'Input "missing" is not defined for the selected notebook scope'],
      ['enabled=maybe', 'Input "enabled"'],
    ])('refuses the input %s before calling Deepnote', async (input, message) => {
      await createScheduleAction(new Command())(INPUTS_FILE, addOptions({ input: [input] }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(message)
      expect(localRunnerMock.addScheduleInCloud).not.toHaveBeenCalled()
    })

    it.each([
      [{ scheduleId: '15' }, '--add cannot be combined with --schedule-id.'],
      [{ clearInputs: true }, '--clear-inputs needs --schedule-id.'],
      [{ list: true }, '--list cannot be combined with --daily, --at, --timezone, --add.'],
      [{ remove: true }, '--remove cannot be combined with --daily, --at, --timezone, --add.'],
    ] satisfies Array<[Partial<ScheduleOptions>, string]>)('refuses --add with %j', async (overrides, message) => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions(overrides))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(message)
      expect(localRunnerMock.addScheduleInCloud).not.toHaveBeenCalled()
      expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
    })

    it('opens the notebook when requested', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions({ open: true }))

      expect(openInBrowser).toHaveBeenCalledWith(RESULT.viewUrl)
    })

    it('refuses an input that only the init notebook of a composed file defines', async () => {
      const path = writeTempFile(
        'composed.deepnote',
        COMPOSED_FILE.replace(
          '      name: Setup\n      blocks: []',
          `      name: Setup
      blocks:
        - blockGroup: group-1
          content: ''
          id: block-setup
          metadata:
            deepnote_variable_name: setup_only
            deepnote_variable_value: x
          sortingKey: a0
          type: input-text`
        )
      )

      await createScheduleAction(new Command())(path, addOptions({ input: ['setup_only=y'] }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'Input "setup_only" is not defined for the selected notebook scope'
      )
      expect(localRunnerMock.addScheduleInCloud).not.toHaveBeenCalled()
    })

    it.each(['', '  '])('refuses the blank name %j', async name => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, addOptions({ name }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('--name cannot be empty.')
      expect(localRunnerMock.addScheduleInCloud).not.toHaveBeenCalled()
    })
  })

  describe('--schedule-id with a name or inputs', () => {
    const nameOrInputs = (overrides: Partial<ScheduleOptions>) =>
      updateOptions({ daily: undefined, at: undefined, ...overrides })

    it('renames a schedule without changing its timing', async () => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({
        ...UPDATE_RESULT,
        schedule: { ...STORED, name: 'Morning' },
      })

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, nameOrInputs({ name: 'Morning' }))

      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledWith(
        HELLO_WORLD_FILE,
        '15',
        { name: 'Morning' },
        expect.anything()
      )
      expect(logSpy.mock.calls.flat().join('\n')).toBe(
        [
          '✓ Schedule 15 updated',
          'Frequency: cron 0 9 * * *',
          'Timezone: Europe/Prague',
          'Next run: 2026-11-28T08:00:00.000Z',
          'Name: Morning',
          'Inputs: region, api_secret',
          `URL: ${RESULT.viewUrl}`,
          'Other schedules are not affected.',
        ].join('\n')
      )
    })

    it('sends input values typed by the notebook', async () => {
      await createScheduleAction(new Command())(INPUTS_FILE, nameOrInputs({ input: ['enabled=false', 'count=3'] }))

      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledWith(
        INPUTS_FILE,
        '15',
        { inputs: { enabled: false, count: '3' } },
        expect.anything()
      )
    })

    it('removes all input values with --clear-inputs', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, nameOrInputs({ clearInputs: true }))

      expect(localRunnerMock.updateScheduleInCloud).toHaveBeenCalledWith(
        HELLO_WORLD_FILE,
        '15',
        { inputs: null },
        expect.anything()
      )
    })

    it('refuses a blank name', async () => {
      await createScheduleAction(new Command())(HELLO_WORLD_FILE, nameOrInputs({ name: ' ' }))

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('--name cannot be empty.')
      expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
    })

    it('refuses --clear-inputs with --input', async () => {
      await createScheduleAction(new Command())(
        INPUTS_FILE,
        nameOrInputs({ clearInputs: true, input: ['enabled=true'] })
      )

      expect(process.exitCode).toBe(2)
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('--clear-inputs cannot be combined with --input.')
      expect(localRunnerMock.updateScheduleInCloud).not.toHaveBeenCalled()
    })

    it('warns when inputs stop the schedule from updating the notebook', async () => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({
        ...UPDATE_RESULT,
        schedule: { ...STORED, inputs: { enabled: true }, updatesNotebook: false },
      })

      await createScheduleAction(new Command())(INPUTS_FILE, nameOrInputs({ input: ['enabled=true'] }))

      expect(errorSpy.mock.calls.flat().join('\n')).toBe(
        "This schedule no longer updates the notebook's outputs, because it has inputs."
      )
      expect(logSpy.mock.calls.flat().join('\n')).toContain('Inputs: enabled')
    })

    it.each([
      ['the schedule did not update the notebook before', { updatesNotebook: false }, {}],
      ['the output is JSON', { updatesNotebook: true }, { output: 'json' as const }],
    ])('does not warn when %s', async (_case, previous, overrides) => {
      localRunnerMock.updateScheduleInCloud.mockResolvedValueOnce({
        ...UPDATE_RESULT,
        previous: { ...STORED, ...previous },
        schedule: { ...STORED, updatesNotebook: false },
      })

      await createScheduleAction(new Command())(INPUTS_FILE, nameOrInputs({ input: ['enabled=true'], ...overrides }))

      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('a notebook with several schedules', () => {
    it.each([
      ['scheduling', options(), 'scheduleInCloud', 2],
      ['--remove', removeOptions(), 'unscheduleInCloud', 3],
    ] as const)('tells the user how to pick one when %s', async (_case, commandOptions, fn, scheduleCount) => {
      localRunnerMock[fn].mockRejectedValueOnce(
        new MultipleSchedulesError(SEVERAL_SCHEDULES, NOTEBOOK_ID, scheduleCount)
      )

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, commandOptions)

      expect(errorSpy.mock.calls.flat()).toEqual([
        `This notebook has ${scheduleCount} schedules. Use --list to choose one, then pass --schedule-id <id>.`,
      ])
      expect(process.exitCode).toBe(1)
    })

    it('prints the same hint in JSON', async () => {
      localRunnerMock.scheduleInCloud.mockRejectedValueOnce(
        new MultipleSchedulesError(SEVERAL_SCHEDULES, NOTEBOOK_ID, 2)
      )

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, options({ output: 'json' }))

      expect(JSON.parse(logSpy.mock.calls.flat().join('\n'))).toEqual({
        success: false,
        error: 'This notebook has 2 schedules. Use --list to choose one, then pass --schedule-id <id>.',
      })
      expect(process.exitCode).toBe(1)
    })

    it('keeps the server message for a conflict on a notebook with one schedule', async () => {
      localRunnerMock.scheduleInCloud.mockRejectedValueOnce(new ApiError(409, 'Project is suspended'))

      await createScheduleAction(new Command())(HELLO_WORLD_FILE, options())

      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Project is suspended')
      expect(errorSpy.mock.calls.flat().join('\n')).not.toContain('--schedule-id')
      expect(process.exitCode).toBe(1)
    })
  })
})
