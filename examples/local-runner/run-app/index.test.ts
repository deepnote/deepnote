import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * The run app talks to Deepnote directly, so its request and response handling is real logic with
 * no server to hide behind. These tests extract the page's own helpers and drive them against a
 * fake API shaped like the live one.
 *
 * The response shapes here were captured from api.deepnote.com, not assumed. An earlier version of
 * this page read a run's status at the top level, which the live API does not use — the poll loop
 * never saw a terminal status and span forever. Mocks that encoded the same wrong assumption
 * passed happily, which is the reason these fixtures are pinned to observed responses.
 */

const HELPERS = [
  'apiFetch',
  'unwrapRun',
  'outputsFromRun',
  'runNotebook',
  'toRunInputs',
  'toCron',
  'describeCadence',
  'normalizeInputs',
  'describeError',
]

interface Sandbox {
  [key: string]: unknown
  calls: { url: string; method: string; auth?: string }[]
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
  const terminal = script.match(/const TERMINAL = new Set\(\[[^\]]*\]\)/)?.[0] ?? ''

  const calls: Sandbox['calls'] = []
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
    calls,
    APP_CONFIG: { baseUrl: 'https://api.test' },
    apiToken: 'viewer-token',
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method ?? 'GET', auth: init?.headers?.authorization })
      if (url.endsWith('/v2/runs') && init?.method === 'POST') {
        // Observed: POST returns the run flat, with no envelope.
        return { ok: true, json: async () => ({ runId: 'run-9', status: 'pending', createdAt: 'now' }) }
      }
      if (url.includes('/v2/runs/run-9')) {
        const polls = calls.filter(c => c.url.includes('/v2/runs/run-9')).length
        // Observed: GET nests the run under `run`, and delivers YAML as `snapshotContent`.
        return {
          ok: true,
          json: async () => ({
            run:
              polls > 1
                ? {
                    runId: 'run-9',
                    status: 'success',
                    snapshotBlocks: [{ id: 'b1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi' }] }],
                  }
                : { runId: 'run-9', status: 'pending' },
          }),
        }
      }
      throw new Error(`unexpected request: ${url}`)
    },
  } as unknown as Sandbox

  vm.createContext(sandbox)
  vm.runInContext([terminal, ...sources].join('\n'), sandbox as unknown as vm.Context)
  return sandbox
}

const page = loadPageHelpers()
const call = <T>(name: string, ...args: unknown[]): T => (page[name] as (...a: unknown[]) => T)(...args)

describe('run app · the live API response envelope', () => {
  it('reads a run nested under `run`, as GET /v2/runs/{id} returns it', () => {
    expect(call('unwrapRun', { run: { runId: 'r', status: 'success' } })).toEqual({ runId: 'r', status: 'success' })
  })

  it('also accepts a flat run, as POST /v2/runs returns it', () => {
    expect(call('unwrapRun', { runId: 'r', status: 'pending' })).toEqual({ runId: 'r', status: 'pending' })
  })

  it('polls to a terminal status instead of spinning forever', async () => {
    const statuses: string[] = []
    const result = await call<Promise<{ status: string; runId: string; outputs: unknown[] }>>(
      'runNotebook',
      'nb-1',
      { count: 6 },
      (status: string) => statuses.push(status)
    )

    expect(result.status).toBe('success')
    expect(result.runId).toBe('run-9')
    expect(statuses).toEqual(['pending', 'success'])
    expect(result.outputs).toEqual([
      { blockId: 'b1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi' }] },
    ])
  })

  it('sends the token only to the configured origin', () => {
    expect(page.calls.every(c => c.url.startsWith('https://api.test/'))).toBe(true)
    expect(page.calls.every(c => c.auth === 'Bearer viewer-token')).toBe(true)
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

  it('builds controls from the notebook detail response', () => {
    // Observed shape of GET /v2/notebooks/{id} → { notebook: { inputs: [...] } }.
    const inputs = call<{ variableName: string }[]>('normalizeInputs', {
      inputs: [{ blockId: 'b', name: 'count', label: 'Count', type: 'input-slider', value: '3', min: 1, max: 100 }],
    })
    expect(inputs[0]).toMatchObject({
      variableName: 'count',
      label: 'Count',
      type: 'input-slider',
      value: '3',
      max: 100,
    })
  })
})
