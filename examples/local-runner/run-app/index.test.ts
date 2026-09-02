import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import {
  describeRunError,
  fetchSnapshotContent,
  getNotebook,
  getRun,
  isFailedStatus,
  isSuccessStatus,
  isTerminalStatus,
  listNotebookRuns,
  pollRunUntilComplete,
  triggerNotebookRun,
  upsertNotebookSchedule,
  waitForRunSnapshot,
} from '@deepnote/cloud'
import { extractOutputs, type PipelineStepResult, pipelineOutputs } from '@deepnote/pipelines'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The run app talks to Deepnote directly, so its request and response handling is real logic with
 * no server to hide behind. These tests extract the page's own helpers and drive them against a
 * fake API shaped like the live one.
 *
 * The page reads every cloud call off the `DeepnotePipelines` bundle global. Here the sandbox gets
 * the same functions from source, so the tests prove the page's calls match the library — its
 * signatures, and what it does with the live API's response envelopes — rather than a hand-written
 * fake of it.
 *
 * The response shapes here were captured from api.deepnote.com, not assumed. An earlier version of
 * this page read a run's status at the top level, which the live API does not use — the poll loop
 * never saw a terminal status and span forever. Mocks that encoded the same wrong assumption
 * passed happily, which is the reason these fixtures are pinned to observed responses.
 */

const HELPERS = [
  'runNotebook',
  'loadRun',
  'settledSnapshot',
  'runData',
  'outputsFromRun',
  'loadNotebook',
  'normalizeInputs',
  'scheduleNotebook',
  'toRunInputs',
  'toCron',
  'describeCadence',
  'loadCloudRuns',
  'readDecision',
]

interface Sandbox {
  [key: string]: unknown
  /** What the page asked `renderRuns` to paint; the DOM itself is not loaded here. */
  renderedRuns: unknown[]
}

function loadPageHelpers(): Sandbox {
  const html = readFileSync(join(__dirname, 'index.html'), 'utf8')
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]
  if (!script) {
    throw new Error('Could not find the run app module script')
  }

  const sources = HELPERS.map(name => {
    const match = script.match(new RegExp(`\\n      (?:async )?function ${name}\\(([\\s\\S]*?)\\n      \\}\\n`))
    if (!match) {
      throw new Error(`Could not extract ${name} from index.html`)
    }
    return match[0]
  })
  const hasParsedBlocks = script.match(/const hasParsedBlocks = .*/)?.[0] ?? ''

  const renderedRuns: Sandbox['renderedRuns'] = []
  const sandbox = {
    console,
    setTimeout,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    // The library, as the page gets it from the bundle global.
    triggerNotebookRun,
    pollRunUntilComplete,
    waitForRunSnapshot,
    getRun,
    fetchSnapshotContent,
    describeRunError,
    isTerminalStatus,
    isSuccessStatus,
    isFailedStatus,
    getNotebook,
    listNotebookRuns,
    upsertNotebookSchedule,
    extractOutputs,
    pipelineOutputs,
    renderRuns: (data: unknown) => renderedRuns.push(data),
    renderedRuns,
    APP_CONFIG: { baseUrl: 'https://api.test', notebookId: 'nb-1' },
    apiToken: 'viewer-token',
  } as unknown as Sandbox

  vm.createContext(sandbox)
  vm.runInContext([hasParsedBlocks, ...sources].join('\n'), sandbox as unknown as vm.Context)
  return sandbox
}

const page = loadPageHelpers()
const call = <T>(name: string, ...args: unknown[]): T => (page[name] as (...a: unknown[]) => T)(...args)

interface RecordedCall {
  url: string
  method: string
  auth?: string
  body?: unknown
}

type Route = (
  url: string,
  call: RecordedCall,
  priorCalls: RecordedCall[]
) => { status?: number; body: unknown } | undefined

/** Stand in for api.deepnote.com: the library's `fetch` lands here, and every request is recorded. */
function fakeApi(route: Route): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    const recorded: RecordedCall = {
      url,
      method: init?.method ?? 'GET',
      auth: headers.get('authorization') ?? undefined,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    const prior = [...calls]
    calls.push(recorded)
    const response = route(url, recorded, prior)
    if (!response) {
      throw new Error(`unexpected request: ${recorded.method} ${url}`)
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return calls
}

afterEach(() => {
  vi.restoreAllMocks()
  page.renderedRuns.length = 0
})

const snapshotYaml = readFileSync(join(__dirname, '..', '..', 'snapshot-showcase.snapshot.deepnote'), 'utf8')

describe('run app · running a notebook through the library', () => {
  it('starts the run, polls to a terminal status, and reads the outputs the API attached', async () => {
    const calls = fakeApi((url, call, prior) => {
      if (url === 'https://api.test/v2/runs' && call.method === 'POST') {
        // Observed: POST returns the run flat, with no envelope.
        return { body: { runId: 'run-9', status: 'pending', createdAt: 'now' } }
      }
      if (url.startsWith('https://api.test/v2/runs/run-9')) {
        const polls = prior.filter(c => c.url.startsWith('https://api.test/v2/runs/run-9')).length
        // Observed: GET nests the run under `run`. A static-app token gets the executed blocks'
        // outputs pre-parsed as `snapshotBlocks` rather than the raw snapshot.
        return {
          body: {
            run:
              polls > 0
                ? {
                    runId: 'run-9',
                    status: 'success',
                    viewUrl: 'https://deepnote.com/runs/run-9',
                    snapshotBlocks: [{ id: 'b1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi' }] }],
                  }
                : { runId: 'run-9', status: 'pending' },
          },
        }
      }
      return undefined
    })

    const statuses: string[] = []
    const result = await call<
      Promise<{ status: string; runId: string; success: boolean; viewUrl?: string; outputs: unknown[] }>
    >('runNotebook', 'nb-1', { count: 6, live: true }, (status: string) => statuses.push(status))

    expect(result).toMatchObject({
      runId: 'run-9',
      status: 'success',
      success: true,
      viewUrl: 'https://deepnote.com/runs/run-9',
    })
    expect(result.outputs).toEqual([
      { blockId: 'b1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi' }] },
    ])
    expect(statuses).toEqual(['pending', 'pending', 'success'])

    // The library shapes the request: a detached, full-notebook run with the coerced inputs.
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.test/v2/runs',
      body: { notebookId: 'nb-1', inputs: { count: '6', live: true }, detached: true },
    })
    expect(calls.slice(1).map(c => c.url)).toEqual(['https://api.test/v2/runs/run-9', 'https://api.test/v2/runs/run-9'])
    expect(calls.every(c => c.url.startsWith('https://api.test/') && c.auth === 'Bearer viewer-token')).toBe(true)
  })

  it('shows a past run from the inline snapshot the API returns', async () => {
    const calls = fakeApi(url => {
      if (url === 'https://api.test/v2/runs/run-3?snapshotDelivery=inline') {
        // Observed: the snapshot arrives inline as YAML under `snapshot.snapshotContent`.
        return { body: { run: { runId: 'run-3', status: 'success', snapshot: { snapshotContent: snapshotYaml } } } }
      }
      return undefined
    })

    const data = await call<Promise<{ success: boolean; outputs: unknown[]; error?: string }>>('loadRun', 'run-3')

    expect(data.success).toBe(true)
    expect(data.error).toBeUndefined()
    expect(data.outputs).toEqual(extractOutputs(snapshotYaml))
    expect(data.outputs.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].auth).toBe('Bearer viewer-token')
  })

  it("reports a failed run with the API's own error message", async () => {
    fakeApi(() => ({
      body: { run: { runId: 'run-4', status: 'error', error: { message: 'Kernel died' } } },
    }))

    const data = await call<Promise<{ success: boolean; status: string; outputs: unknown[]; error?: string }>>(
      'loadRun',
      'run-4'
    )

    expect(data).toMatchObject({ success: false, status: 'error', error: 'Kernel died', outputs: [] })
  })

  it("surfaces the library's error when the token may not run the notebook", async () => {
    fakeApi(() => ({ status: 403, body: { message: 'Forbidden' } }))

    await expect(call<Promise<unknown>>('runNotebook', 'nb-1', {})).rejects.toThrow(/Forbidden/)
  })
})

describe('run app · the notebook and its schedule through the library', () => {
  it('builds controls from the notebook detail, keeping the slider bounds and select options', async () => {
    const calls = fakeApi(url => {
      if (url === 'https://api.test/v2/notebooks/nb-1') {
        // Observed shape of GET /v2/notebooks/{id} → { notebook: { inputs: [...] } }.
        return {
          body: {
            notebook: {
              id: 'nb-1',
              name: 'Sales review',
              blocks: [],
              inputs: [
                {
                  blockId: 'b',
                  name: 'count',
                  label: 'Count',
                  type: 'input-slider',
                  value: '3',
                  min: 1,
                  max: 100,
                  step: 1,
                },
                {
                  blockId: 'c',
                  name: 'region',
                  type: 'input-select',
                  value: ['eu'],
                  options: ['eu', 'na'],
                  multiple: true,
                },
              ],
            },
          },
        }
      }
      return undefined
    })

    const info = await call<Promise<{ name: string; inputs: Record<string, unknown>[] }>>('loadNotebook', 'nb-1')

    expect(info.name).toBe('Sales review')
    expect(info.inputs).toEqual([
      expect.objectContaining({
        variableName: 'count',
        label: 'Count',
        type: 'input-slider',
        value: '3',
        min: 1,
        max: 100,
        step: 1,
      }),
      expect.objectContaining({ variableName: 'region', type: 'input-select', options: ['eu', 'na'], multiple: true }),
    ])
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.test/v2/notebooks/nb-1',
      auth: 'Bearer viewer-token',
    })
  })

  it('saves the cadence as a cron schedule and reports when it next runs', async () => {
    const calls = fakeApi((url, call) => {
      if (url === 'https://api.test/v2/notebooks/nb-1/schedule' && call.method === 'POST') {
        return {
          body: {
            schedule: {
              notebookId: 'nb-1',
              cron: '5 7 * * 3',
              timezone: 'Europe/Prague',
              nextRunAt: '2026-09-02T05:05:00.000Z',
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            },
          },
        }
      }
      return undefined
    })

    const saved = await call<Promise<{ nextRunAt: string }>>(
      'scheduleNotebook',
      { frequency: 'weekly', time: '07:05', dayOfWeek: 3 },
      'Europe/Prague'
    )

    expect(saved.nextRunAt).toBe('2026-09-02T05:05:00.000Z')
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.test/v2/notebooks/nb-1/schedule',
      auth: 'Bearer viewer-token',
      body: { cron: '5 7 * * 3', timezone: 'Europe/Prague' },
    })
  })
})

describe('run app · request shaping', () => {
  it('coerces inputs to what POST /v2/runs accepts', () => {
    // Observed: a slider takes a string, but a checkbox is rejected unless it is a real boolean.
    expect(call('toRunInputs', { months: 6, live: true, name: 'eu', tags: ['x'], bad: { a: 1 } })).toEqual({
      months: '6',
      live: true,
      name: 'eu',
      tags: ['x'],
    })
  })

  it('maps the schedule builder onto cron', () => {
    expect(call('toCron', { frequency: 'daily', time: '09:30' })).toBe('30 9 * * *')
    expect(call('toCron', { frequency: 'weekly', time: '07:05', dayOfWeek: 3 })).toBe('5 7 * * 3')
    expect(call('toCron', { frequency: 'monthly', time: '23:00', dayOfMonth: 15 })).toBe('0 23 15 * *')
  })
})

describe('run app · run history through the library', () => {
  it('lists the notebook runs with `listNotebookRuns` and renders the page it returns', async () => {
    const calls = fakeApi(() => ({
      body: {
        runs: [
          { runId: 'run-2', status: 'success', createdAt: '2026-08-01T10:00:00Z', completedAt: '2026-08-01T10:01:00Z' },
          { runId: 'run-1', status: 'error', createdAt: '2026-07-31T10:00:00Z', completedAt: null },
        ],
        pagination: { hasMore: false },
      },
    }))

    await call<Promise<void>>('loadCloudRuns')

    expect(calls[0]).toMatchObject({ url: 'https://api.test/v2/notebooks/nb-1/runs', auth: 'Bearer viewer-token' })
    expect(page.renderedRuns).toEqual([
      {
        runs: [
          { runId: 'run-2', status: 'success', createdAt: '2026-08-01T10:00:00Z', completedAt: '2026-08-01T10:01:00Z' },
          { runId: 'run-1', status: 'error', createdAt: '2026-07-31T10:00:00Z', completedAt: null },
        ],
      },
    ])
  })

  it('leaves the panel alone when the token may not list runs', async () => {
    // A published app's static-app token can run a notebook but not enumerate its runs.
    fakeApi(() => ({ status: 403, body: { message: 'Forbidden' } }))

    await expect(call<Promise<void>>('loadCloudRuns')).resolves.toBeUndefined()
    expect(page.renderedRuns).toEqual([])
  })
})

/** A finished cloud step whose snapshot holds the given blocks; only what `lastJson` reads is filled in. */
function stepWithBlocks(blocks: { id: string; type: string; outputs: unknown[] }[]): PipelineStepResult {
  return {
    id: 'decision-gpt',
    target: 'cloud',
    success: true,
    status: 'success',
    outputs: [],
    snapshotYaml: null,
    snapshot: { notebooks: [{ id: 'nb', name: 'GPT decision review', inputs: [], blocks }] },
    startedAt: '2026-08-01T10:00:00Z',
    finishedAt: '2026-08-01T10:01:00Z',
    durationMs: 60_000,
  } as unknown as PipelineStepResult
}

const agentProse = {
  id: 'executive-agent',
  type: 'agent',
  outputs: [
    { output_type: 'display_data', data: { 'text/markdown': 'Decision: INTERVENE\n\nForecast trails target.' } },
  ],
}

const emitted = (json: string) => ({
  id: 'emit-decision',
  type: 'code',
  outputs: [{ output_type: 'stream', name: 'stdout', text: `${json}\n` }],
})

describe('run app · decisions as data', () => {
  it('reads the verdict from the JSON the notebook emits, not from the agent prose', () => {
    // The agent's markdown says INTERVENE; the emitted JSON is what counts.
    const step = stepWithBlocks([
      agentProse,
      emitted('{"decision": "proceed", "rationale": "Forecast clears target by $40k.", "nextAction": "Hold plan."}'),
    ])

    expect(call('readDecision', step)).toEqual({
      decision: 'proceed',
      readout: 'Forecast clears target by $40k.\n\nNext: Hold plan.',
      error: undefined,
    })
  })

  it('normalizes the verdict and treats anything but the two words as unavailable', () => {
    expect(
      call('readDecision', stepWithBlocks([emitted('{"decision": " INTERVENE ", "rationale": "Europe is short."}')]))
    ).toMatchObject({ decision: 'intervene', readout: 'Europe is short.' })
    expect(
      call('readDecision', stepWithBlocks([emitted('{"decision": "maybe", "rationale": "Unsure."}')]))
    ).toMatchObject({
      decision: null,
      readout: 'Unsure.',
    })
    // The notebook's own fallback when the agent recorded nothing.
    expect(
      call(
        'readDecision',
        stepWithBlocks([
          emitted(
            '{"decision": null, "rationale": "The agent did not record a structured decision.", "nextAction": null}'
          ),
        ])
      )
    ).toMatchObject({ decision: null, readout: 'The agent did not record a structured decision.' })
  })

  it('reports a step with no JSON output as an error rather than guessing from prose', () => {
    const result = call<{ decision: null; readout: null; error: string }>('readDecision', stepWithBlocks([agentProse]))
    expect(result.decision).toBeNull()
    expect(result.readout).toBeNull()
    expect(result.error).toMatch(/no structured JSON output/)
  })

  it('passes a failed step through with its error', () => {
    const failed = { ...stepWithBlocks([]), success: false, status: 'error', error: 'Kernel died' }
    expect(call('readDecision', failed)).toEqual({ decision: null, readout: null, error: 'Kernel died' })
  })
})
