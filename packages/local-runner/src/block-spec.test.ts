import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type DeepnoteBlock, deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { mapBlockIds, toBlockSpec } from './block-spec'

/**
 * A block fixture.
 *
 * `metadata` is deliberately `unknown` rather than `Record<string, unknown>`: the point of some of
 * these cases is a shape the schema forbids but that can still reach `toBlockSpec` through the
 * object form of `DeepnoteInput`, and a narrower parameter would make them inexpressible.
 */
function block(type: string, metadata: unknown = {}, content = ''): DeepnoteBlock {
  return { id: 'b1', blockGroup: 'g1', sortingKey: 'a0', type, content, metadata } as unknown as DeepnoteBlock
}

const UUID = '0f1e2d3c-4b5a-6789-abcd-ef0123456789'

describe('toBlockSpec', () => {
  it('passes an ordinary block through unchanged', () => {
    const spec = toBlockSpec(block('code', { deepnote_app_block_visible: true }, 'x = 1'))

    expect(spec).toEqual({
      type: 'code',
      content: 'x = 1',
      metadata: { deepnote_app_block_visible: true },
    })
    expect(spec.integrationId).toBeUndefined()
  })

  it('strips volatile execution bookkeeping, so a create carries no run history', () => {
    const spec = toBlockSpec(
      block('code', {
        deepnote_app_block_visible: true,
        execution_start: 1754654000000,
        execution_millis: 2500,
        execution_context_id: 'ctx-1',
        source_hash: 'abc123',
      })
    )

    expect(spec.metadata).toEqual({ deepnote_app_block_visible: true })
  })

  it('strips the execution bookkeeping every executed block of a real exported file carries', async () => {
    // The exact shape a push compares and creates from: without the strip, each of these blocks
    // would plan a delete+create (new id, dropped comments) after any run.
    const path = join(__dirname, '../../..', 'examples/housing_price_prediction.deepnote')
    const file = deserializeDeepnoteFile(await readFile(path, 'utf-8'))
    const executed = file.project.notebooks
      .flatMap(nb => nb.blocks)
      .filter(b => (b.metadata as Record<string, unknown> | undefined)?.execution_start !== undefined)
    expect(executed.length).toBeGreaterThan(0)

    for (const executedBlock of executed) {
      const metadata = toBlockSpec(executedBlock).metadata
      expect(metadata).not.toHaveProperty('execution_start')
      expect(metadata).not.toHaveProperty('execution_millis')
      expect(metadata).not.toHaveProperty('execution_context_id')
    }
  })

  it('lifts a UUID sql_integration_id out of metadata into integrationId', () => {
    // Deepnote rejects `sql_integration_id` inside metadata with a 400 and expects the connection
    // as a top-level field, which it then writes back into that very key itself.
    const spec = toBlockSpec(block('sql', { sql_integration_id: UUID, other: 'kept' }, 'select 1'))

    expect(spec.integrationId).toBe(UUID)
    expect(spec.metadata).toEqual({ other: 'kept' })
  })

  it('drops a non-UUID integration and warns, since the API will not accept it', () => {
    const warnings: string[] = []

    const spec = toBlockSpec(block('sql', { sql_integration_id: 'deepnote-dataframe-sql' }), m => warnings.push(m))

    expect(spec.integrationId).toBeUndefined()
    expect(spec.metadata).toEqual({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('without a connection')
  })

  it('does not warn when there is no integration to lose', () => {
    const warnings: string[] = []

    toBlockSpec(block('code'), m => warnings.push(m))

    expect(warnings).toEqual([])
  })

  it('tolerates a missing onWarning callback', () => {
    expect(() => toBlockSpec(block('sql', { sql_integration_id: 'not-a-uuid' }))).not.toThrow()
  })

  it('ignores a non-string sql_integration_id rather than lifting it', () => {
    const spec = toBlockSpec(block('sql', { sql_integration_id: 42 }))

    // Left in metadata untouched: it is not something this function can turn into an integrationId.
    expect(spec.metadata).toEqual({ sql_integration_id: 42 })
    expect(spec.integrationId).toBeUndefined()
  })

  it('drops array metadata and warns, since Deepnote would reject it mid-push', () => {
    // Unreachable from a deserialized file (the schema types metadata as an object), but
    // `loadDeepnoteFile` deep-clones an object input without validating it and `planNotebookSync`
    // takes a `DeepnoteFile` directly, so this boundary is reachable through the public API.
    const warnings: string[] = []

    const spec = toBlockSpec(block('code', ['not', 'an', 'object']), m => warnings.push(m))

    expect(spec.metadata).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('is an array')
  })

  it.each([
    ['a string', 'value'],
    ['a number', 42],
    ['a boolean', true],
  ])('drops %s metadata and warns, rather than throwing on the key checks', (shape, metadata) => {
    // Same public-API boundary as the array case: a primitive here would make the `in`-based
    // volatile-key checks throw a TypeError before anything was sent.
    const warnings: string[] = []

    const spec = toBlockSpec(block('code', metadata), m => warnings.push(m))

    expect(spec.metadata).toBeUndefined()
    expect(spec.integrationId).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(`is ${shape}`)
  })

  it('leaves a null metadata alone', () => {
    const spec = toBlockSpec(block('code', null))

    expect(spec.metadata).toBeNull()
  })

  it('accepts an uppercase UUID', () => {
    const spec = toBlockSpec(block('sql', { sql_integration_id: UUID.toUpperCase() }))

    expect(spec.integrationId).toBe(UUID.toUpperCase())
  })
})

describe('mapBlockIds', () => {
  it('returns undefined for an empty or absent selection', () => {
    expect(mapBlockIds(undefined, new Map())).toBeUndefined()
    expect(mapBlockIds([], new Map())).toBeUndefined()
  })

  it('translates each id through the created map', () => {
    const created = new Map([
      ['local-1', 'cloud-1'],
      ['local-2', 'cloud-2'],
    ])

    expect(mapBlockIds(['local-2', 'local-1'], created)).toEqual(['cloud-2', 'cloud-1'])
  })

  it('throws on an id that did not map, rather than silently running something else', () => {
    expect(() => mapBlockIds(['missing'], new Map([['local-1', 'cloud-1']]))).toThrow(/"missing"/)
  })

  it('names the calling operation in the failure', () => {
    expect(() => mapBlockIds(['missing'], new Map(), 'syncNotebookContent')).toThrow(/^syncNotebookContent:/)
  })
})
