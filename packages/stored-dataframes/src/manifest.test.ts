import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

const FIXTURE_REFERENCE_ID = '3f2b8c1e-6d4a-4e9b-9a7c-0d5e1f2a3b4c'
const FIXTURE_ROWS = 200_000
const validFile = `${FIXTURE_REFERENCE_ID}.arrow`
const validManifest = {
  version: 1,
  file: validFile,
  written_at: '2026-09-25T09:14:03Z',
  rows: FIXTURE_ROWS,
  batch_rows: [65536, 65536, 65536, 3392],
}

describe('parseManifest', () => {
  it('reads file, rows and batch_rows, and ignores the other keys', () => {
    const text = JSON.stringify({ ...validManifest, toolkit_version: '2.9.1' })

    expect(parseManifest(text)).toStrictEqual({
      file: '3f2b8c1e-6d4a-4e9b-9a7c-0d5e1f2a3b4c.arrow',
      referenceId: '3f2b8c1e-6d4a-4e9b-9a7c-0d5e1f2a3b4c',
      rows: 200000,
      batchRows: [65536, 65536, 65536, 3392],
    })
  })

  it.each<[string, string]>([
    ['a manifest cut off mid-JSON', '{"file":'],
    ['a manifest that is an array', '[]'],
    ['a manifest naming a name that is not a UUID', JSON.stringify({ ...validManifest, file: 'frame.arrow' })],
    [
      'a manifest naming a UUID with another extension',
      JSON.stringify({ ...validManifest, file: `${FIXTURE_REFERENCE_ID}.csv` }),
    ],
    ['a manifest naming a UUID in the parent directory', JSON.stringify({ ...validManifest, file: `../${validFile}` })],
    ['a manifest naming a UUID with a trailing newline', JSON.stringify({ ...validManifest, file: `${validFile}\n` })],
    [
      'a manifest naming a mixed-case UUID',
      JSON.stringify({
        ...validManifest,
        file: `${FIXTURE_REFERENCE_ID.slice(0, 18)}${FIXTURE_REFERENCE_ID.slice(18).toUpperCase()}.arrow`,
      }),
    ],
    ['a manifest with rows as a string', JSON.stringify({ ...validManifest, rows: String(FIXTURE_ROWS) })],
    [
      'a manifest whose batch_rows add up to rows beyond the safe integer range',
      JSON.stringify({ ...validManifest, rows: 2 ** 60, batch_rows: Array.from({ length: 256 }, () => 2 ** 52) }),
    ],
    ['a manifest without batch_rows', JSON.stringify({ version: 1, file: validFile, rows: FIXTURE_ROWS })],
    ['a manifest with null batch_rows', JSON.stringify({ ...validManifest, batch_rows: null })],
    [
      'a manifest with a negative batch_rows entry',
      JSON.stringify({ ...validManifest, batch_rows: [-1, 65537, 131072, 3392] }),
    ],
    [
      'a manifest with fractional batch_rows entries',
      JSON.stringify({ ...validManifest, batch_rows: [65535.5, 65536.5, 65536, 3392] }),
    ],
    [
      'a manifest with a batch_rows entry as a string',
      JSON.stringify({ ...validManifest, batch_rows: ['65536', 65536, 65536, 3392] }),
    ],
    [
      'a manifest whose batch_rows add up to fewer rows than it has',
      JSON.stringify({ ...validManifest, batch_rows: [65536, 65536, 65536, 3391] }),
    ],
    [
      'a manifest whose batch_rows add up to more rows than it has',
      JSON.stringify({ ...validManifest, batch_rows: [65536, 65536, 65536, 3393] }),
    ],
  ])('refuses %s', (_description, text) => {
    expect(parseManifest(text)).toBeNull()
  })
})
