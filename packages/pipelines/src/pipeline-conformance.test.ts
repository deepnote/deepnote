import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { NOTEBOOK, replaceEmbedded, SOURCE } from '../scripts/embed-pipeline-runner.mjs'
import type { PipelinePlan } from './pipeline-plan'
import { planPipeline } from './pipeline-plan'

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
function normalize(plan: PipelinePlan): unknown {
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

function planOf(fixture: string): unknown {
  return normalize(planPipeline(deserializeDeepnoteFile(readFileSync(join(FIXTURES, fixture), 'utf8'))))
}

/** Both sides go through JSON so key order and undefined-vs-absent cannot differ. */
function comparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('pipeline conformance', () => {
  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  // Comparing the two implementations to each other cannot catch a mistake they both make, so each
  // fixture also has a committed expected plan that was checked by hand.
  describe('TypeScript matches the expected plan', () => {
    for (const fixture of fixtures) {
      it(fixture, () => {
        const expected = JSON.parse(
          readFileSync(join(FIXTURES, fixture.replace('.deepnote', '.expected.json')), 'utf8')
        )
        expect(comparable(planOf(fixture))).toEqual(expected)
      })
    }
  })

  describe.skipIf(!python)('Python matches the expected plan', () => {
    for (const fixture of fixtures) {
      it(fixture, () => {
        const expected = JSON.parse(
          readFileSync(join(FIXTURES, fixture.replace('.deepnote', '.expected.json')), 'utf8')
        )
        const stdout = execFileSync(python as string, [RUNNER, '--plan', join(FIXTURES, fixture)], {
          encoding: 'utf8',
        })
        expect(JSON.parse(stdout)).toEqual(expected)
      })
    }
  })

  describe.skipIf(!python)('both implementations reject the same bad manifests', () => {
    const BAD = [
      { name: 'a reference no step exports', yaml: badManifest({ inputs: { x: '{{nothing}}' } }) },
      { name: 'a malformed condition', yaml: badManifest({ run_if: 'quality <' }) },
      { name: 'a step naming no notebook', yaml: badManifest({ noNotebook: true }) },
    ]

    for (const { name, yaml } of BAD) {
      it(name, () => {
        const path = join(tmpdir(), `conformance-${name.replace(/\W+/g, '-')}.deepnote`)
        writeFileSync(path, yaml)
        try {
          expect(() => planPipeline(deserializeDeepnoteFile(yaml))).toThrow()
          const result = spawnSync(python as string, [RUNNER, '--plan', path], { encoding: 'utf8' })
          expect(result.status).not.toBe(0)
        } finally {
          rmSync(path, { force: true })
        }
      })
    }
  })

  describe.skipIf(!python)('the notebook embeds the current interpreter', () => {
    it('runner.deepnote is not stale', () => {
      // The scheduled notebook must be self-contained, so the interpreter really is duplicated.
      // This is what stops the copy drifting from the source it was generated from.
      const notebook = readFileSync(NOTEBOOK, 'utf8')
      expect(replaceEmbedded(notebook, readFileSync(SOURCE, 'utf8'))).toBe(notebook)
    })
  })
})

/** A one-step manifest, broken in exactly one way. */
function badManifest(options: { inputs?: Record<string, unknown>; run_if?: string; noNotebook?: boolean }): string {
  const metadata: Record<string, unknown> = {
    function_notebook_id: options.noNotebook ? null : 'nb-a',
    function_notebook_inputs: options.inputs ?? {},
  }
  if (options.run_if) {
    metadata.run_if = options.run_if
  }
  return [
    'metadata:',
    "  createdAt: '2026-01-01T00:00:00.000Z'",
    'project:',
    '  id: bad',
    '  name: Bad',
    '  notebooks:',
    '    - id: nb',
    '      name: Pipeline',
    '      blocks:',
    '        - blockGroup: g',
    '          id: only',
    '          sortingKey: a0',
    '          type: notebook-function',
    `          metadata: ${JSON.stringify(metadata)}`,
    "version: '1.0.0'",
    '',
  ].join('\n')
}
