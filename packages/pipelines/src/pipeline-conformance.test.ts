import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import type { PipelineStepExecutor } from './pipeline'
import { planPipeline } from './pipeline-plan'
import { runPipelineFileWithExecutor } from './run-pipeline-file'

/**
 * The fixtures are the contract for the pipeline encoding: the shape deepnote.com stores, read the
 * way deepnote.com will read it. Every implementation of the planner — this one, or the product's —
 * must produce these plans for these files, and these execution results for the fake runs below.
 *
 * Each `<name>.deepnote` has a hand-checked `<name>.expected.json` (the plan) and/or a
 * `<name>.expected-results.json` (what ran, what was skipped, and with which inputs).
 */

const FIXTURES = join(__dirname, '../../../test-fixtures/pipeline-conformance')

const fixtures = readdirSync(FIXTURES).filter(name => name.endsWith('.deepnote'))
const has = (name: string) => readdirSync(FIXTURES).includes(name)
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
const readFixture = (name: string) => deserializeDeepnoteFile(readFileSync(join(FIXTURES, name), 'utf8'))

/** Through JSON so key order and undefined-vs-absent cannot differ from the committed file. */
const comparable = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

interface ExpectedResults {
  /** Step (or fan-out element) id → the JSON object its run produces. Absent means `{}`. */
  stepOutputs: Record<string, unknown>
  /** Steps whose run fails. */
  failingSteps: string[]
  /** Step id → the inputs it was run with. */
  ran: Record<string, Record<string, unknown>>
  skipped: string[]
  failed: string[]
  variables: Record<string, unknown>
}

/** An executor that plays back the scenario a results fixture describes. */
function scenarioExecutor(scenario: ExpectedResults) {
  const ran: Record<string, Record<string, unknown>> = {}
  const executor: PipelineStepExecutor = async ({ id, step, startedAt, startedMs }) => {
    ran[id] = (step.inputs ?? {}) as Record<string, unknown>
    const fails = scenario.failingSteps.includes(id)
    const value = scenario.stepOutputs[id] ?? {}
    return {
      id,
      target: 'fake',
      success: !fails,
      status: fails ? 'failed' : 'success',
      outputs: [],
      snapshotYaml: null,
      snapshot: fails
        ? null
        : {
            notebooks: [
              {
                id: 'n1',
                name: 'n',
                blocks: [
                  {
                    id: 'b1',
                    type: 'code',
                    content: '',
                    executionCount: 1,
                    outputs: [{ output_type: 'execute_result', data: { 'application/json': value }, metadata: {} }],
                  },
                ],
              },
            ],
            inputs: [],
          },
      error: fails ? 'the notebook raised' : undefined,
      startedAt,
      finishedAt: new Date(startedMs + 1).toISOString(),
      durationMs: 1,
      // biome-ignore lint/suspicious/noExplicitAny: test double
    } as any
  }
  return { executor, ran }
}

describe('pipeline conformance', () => {
  it('has fixtures to check, each with an expectation', () => {
    expect(fixtures.length).toBeGreaterThan(0)
    for (const fixture of fixtures) {
      const base = fixture.replace('.deepnote', '')
      expect(
        has(`${base}.expected.json`) || has(`${base}.expected-results.json`),
        `${fixture} has no expectation`
      ).toBe(true)
    }
  })

  describe('the plan matches the expected plan', () => {
    for (const fixture of fixtures) {
      const expectedName = fixture.replace('.deepnote', '.expected.json')
      it.skipIf(!has(expectedName))(fixture, () => {
        expect(comparable(planPipeline(readFixture(fixture)))).toEqual(readJson(expectedName))
      })
    }
  })

  describe('execution matches the expected results', () => {
    for (const fixture of fixtures) {
      const expectedName = fixture.replace('.deepnote', '.expected-results.json')
      it.skipIf(!has(expectedName))(fixture, async () => {
        const scenario = readJson(expectedName) as ExpectedResults
        const { executor, ran } = scenarioExecutor(scenario)

        const result = await runPipelineFileWithExecutor(readFixture(fixture), {}, executor)

        expect(comparable(ran)).toEqual(scenario.ran)
        expect([...result.skipped].sort()).toEqual([...scenario.skipped].sort())
        expect([...result.failed].sort()).toEqual([...scenario.failed].sort())
        expect(comparable(result.value)).toEqual(scenario.variables)
      })
    }
  })
})
