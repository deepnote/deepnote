import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import type { OrchestrationPlan } from './orchestration-plan'
import { planOrchestration } from './orchestration-plan'

/**
 * The pipeline semantics exist twice: in TypeScript for the browser and scripts, and in Python for
 * a scheduled notebook. Two implementations of the same language is a standing risk that they
 * quietly disagree.
 *
 * These fixtures are the contract. Both planners must produce byte-identical plans for every one of
 * them, so a change to `run_if`, `for_each`, `{{ }}`, or dependency derivation in one language fails
 * here until it is made in the other.
 */

const FIXTURES = join(__dirname, '../../../test-fixtures/pipeline-conformance')
const RUNNER = join(__dirname, '../python/deepnote_pipeline.py')

/** Python is not needed to build or use this package, so skip rather than fail when it is absent. */
function pythonWithYaml(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import yaml'], { encoding: 'utf8' })
    if (probe.status === 0) {
      return candidate
    }
  }
  return null
}

const python = pythonWithYaml()

/** The shape both sides agree on: sorted, with absent optionals omitted. */
function normalize(plan: OrchestrationPlan): unknown {
  return {
    notebookId: plan.notebookId,
    notebookName: plan.notebookName,
    producedBy: plan.producedBy,
    steps: plan.steps.map(step => ({
      id: step.id,
      label: step.label,
      notebookId: step.notebookId,
      inputs: step.inputs,
      exports: step.exports,
      dependsOn: [...step.dependsOn].sort(),
      forEachAs: step.forEachAs,
      ...(step.condition === undefined ? {} : { condition: step.condition }),
      ...(step.forEach === undefined ? {} : { forEach: step.forEach }),
    })),
  }
}

const fixtures = readdirSync(FIXTURES).filter(name => name.endsWith('.deepnote'))

describe('pipeline conformance: TypeScript and Python plan identically', () => {
  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  describe.skipIf(!python)('against the Python runner', () => {
    for (const fixture of fixtures) {
      it(fixture, () => {
        const file = deserializeDeepnoteFile(readFileSync(join(FIXTURES, fixture), 'utf8'))
        const fromTypeScript = normalize(planOrchestration(file))

        const stdout = execFileSync(python as string, [RUNNER, '--plan', join(FIXTURES, fixture)], {
          encoding: 'utf8',
        })
        const fromPython = JSON.parse(stdout)

        // JSON round-trip on both sides so key order and undefined-vs-absent cannot differ.
        expect(JSON.parse(JSON.stringify(fromPython))).toEqual(JSON.parse(JSON.stringify(fromTypeScript)))
      })
    }
  })
})
