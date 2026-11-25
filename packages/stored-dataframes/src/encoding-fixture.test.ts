// cspell:ignore Qncw
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { CompressionType, compressionRegistry, type RecordBatch, RecordBatchReader } from 'apache-arrow'
import { beforeAll, describe, expect, it } from 'vitest'
import { describeColumns, encodeRows, type JsonValue } from './json-values'
import { parseManifest } from './manifest'
import { type DataframePage, planDataframePage, slicePageColumns } from './page'
import { MANIFEST_FILE_NAME } from './storage-layout'

const fixturesDirectory = path.join(__dirname, '../../../test-fixtures/stored-dataframes')

async function readFixturePage(directory: string, pageIndex: number, pageSize: number): Promise<DataframePage> {
  const manifest = parseManifest(await readFile(path.join(directory, MANIFEST_FILE_NAME), 'utf8'))
  if (!manifest) {
    throw new Error(`${directory} holds no valid manifest`)
  }
  const plan = planDataframePage(manifest, { pageIndex, pageSize })
  const reader = RecordBatchReader.from(await readFile(path.join(directory, manifest.file))).open()
  const batches: RecordBatch[] = []
  for (const { index } of plan.batches) {
    const batch = await reader.readRecordBatch(index)
    if (!batch) {
      throw new Error(`${manifest.file} holds no record batch ${index}`)
    }
    batches.push(batch)
  }
  const pageColumns = slicePageColumns(reader.schema, batches, plan.batches)
  const columns = describeColumns(reader.schema)
  const rows = await encodeRows(pageColumns, plan.rows)

  return {
    referenceId: manifest.referenceId,
    rowCount: manifest.rows,
    columnCount: reader.schema.fields.length,
    pageIndex,
    pageSize,
    pageCount: plan.pageCount,
    columns,
    rows,
  }
}

beforeAll(() => {
  compressionRegistry.set(CompressionType.ZSTD, { decode: bytes => zlib.zstdDecompressSync(bytes) })
})

describe('the encoding fixture', () => {
  function readEncodingPage(pageIndex: number, pageSize: number): Promise<DataframePage> {
    return readFixturePage(path.join(fixturesDirectory, 'encoding'), pageIndex, pageSize)
  }

  function cellsByRow(page: DataframePage, column: string): Record<number, JsonValue | undefined> {
    const index = page.columns.findIndex(({ name }) => name === column)
    return Object.fromEntries(page.rows.map((row, offset) => [page.pageIndex * page.pageSize + offset, row[index]]))
  }

  it('names each column with its type and time zone', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(page).toStrictEqual(expect.objectContaining({ rowCount: 30, columnCount: 17, pageCount: 1 }))
    expect(page.columns).toStrictEqual([
      { name: 'count', type: 'int64', timezone: null },
      { name: 'ratio', type: 'float', timezone: null },
      { name: 'flag', type: 'boolean', timezone: null },
      { name: 'text', type: 'string', timezone: null },
      { name: 'level', type: 'string', timezone: null },
      { name: 'event_at', type: 'timestamp', timezone: null },
      { name: 'created_utc', type: 'timestamp', timezone: 'UTC' },
      { name: 'local_time', type: 'timestamp', timezone: 'Europe/Prague' },
      { name: 'day', type: 'date', timezone: null },
      { name: 'clock', type: 'time', timezone: null },
      { name: 'duration', type: 'duration', timezone: null },
      { name: 'price', type: 'decimal', timezone: null },
      { name: 'rate', type: 'decimal', timezone: null },
      { name: 'payload', type: 'binary', timezone: null },
      { name: 'tags', type: 'list', timezone: null },
      { name: 'meta', type: 'struct', timezone: null },
      { name: 'uid', type: 'string', timezone: null },
    ])
  })

  it('serves int64 values as text, across a batch boundary, and a missing one as null', async () => {
    const first = await readEncodingPage(0, 7)
    const last = await readEncodingPage(3, 7)

    expect(cellsByRow(first, 'count')).toStrictEqual({
      0: '-50',
      1: '-43',
      2: null,
      3: '-29',
      4: '-22',
      5: '9007199254740992',
      6: '-9007199254740992',
    })
    expect(cellsByRow(last, 'count')).toStrictEqual({
      21: '97',
      22: '104',
      23: '111',
      24: '118',
      25: '9007199254740993',
      26: '-9223372036854775808',
      27: '139',
    })
  })

  it('serves floats as numbers, and a missing one and an infinity as null', async () => {
    const first = await readEncodingPage(0, 7)
    const second = await readEncodingPage(1, 12)

    // pyarrow stored the frame's NaN at row 3 as a missing value, so the file holds no NaN to serve.
    expect(cellsByRow(first, 'ratio')).toStrictEqual({ 0: 0, 1: 0.25, 2: 0.5, 3: null, 4: 0.1, 5: 1.25, 6: 1.5 })
    expect(cellsByRow(second, 'ratio')).toStrictEqual({
      12: 3,
      13: null,
      14: null,
      15: 3.75,
      16: null,
      17: 4.25,
      18: 4.5,
      19: 4.75,
      20: 5,
      21: 5.25,
      22: 1e20,
      23: 1.5e-7,
    })
  })

  it('serves booleans, texts and categories as they are, a long text whole, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'flag')).toStrictEqual(expect.objectContaining({ 0: true, 1: null, 3: false }))
    expect(cellsByRow(page, 'text')).toStrictEqual(
      expect.objectContaining({ 0: null, 1: 'row 1', 9: '', 11: 'lorem ipsum '.repeat(100), 12: 'žluťoučký kůň 🐎' })
    )
    expect(cellsByRow(page, 'level')).toStrictEqual(
      expect.objectContaining({ 0: 'low', 1: 'medium', 2: 'high', 4: null })
    )
  })

  it('serves timestamps in ISO 8601 cut to the millisecond, with a Z only for a time zone, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'event_at')).toStrictEqual(
      expect.objectContaining({
        0: '2025-01-01T00:00:04.000',
        1: null,
        8: '2025-03-04T05:06:07.123',
        10: '2025-03-04T05:06:07.123',
        19: '1969-12-31T23:59:59.500',
        27: '2025-01-01T00:00:00.000',
      })
    )
    expect(cellsByRow(page, 'created_utc')).toStrictEqual(
      expect.objectContaining({ 0: '2025-06-01T12:00:00.000Z', 6: null, 14: '2025-06-01T12:14:00.000Z' })
    )
  })

  it('serves a zoned timestamp in UTC, on both sides of a switch to summer time', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'local_time')).toStrictEqual(
      expect.objectContaining({
        0: '2025-03-29T11:00:00.000Z',
        1: '2025-03-29T23:00:00.000Z',
        2: '2025-03-30T11:00:00.250Z',
        3: '2025-03-30T23:00:00.000Z',
        24: null,
      })
    )
  })

  it('serves dates as text, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'day')).toStrictEqual(
      expect.objectContaining({ 0: '2025-01-01', 3: '1960-02-29', 5: null })
    )
  })

  it('serves times as text cut to the millisecond, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'clock')).toStrictEqual(
      expect.objectContaining({ 0: '00:00:00.000', 4: '00:00:00.789', 7: null, 29: '23:59:59.999' })
    )
  })

  it('serves durations as seconds, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'duration')).toStrictEqual(
      expect.objectContaining({ 0: 0, 2: null, 11: -1, 12: 183_600.5, 23: 1e-9, 25: 34_560_001 })
    )
  })

  it('serves decimals as plain text with the scale of their column', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'price')).toStrictEqual(
      expect.objectContaining({
        0: '0.00',
        9: '-12.35',
        10: '30.70',
        13: '12345678901234567890.12',
        15: null,
        20: '-0.50',
      })
    )
    expect(cellsByRow(page, 'rate')).toStrictEqual(
      expect.objectContaining({ 0: '0.00000000', 1: '0.00000003', 2: '0.00000048', 3: '0.00000243', 21: null })
    )
  })

  it('serves bytes as base64', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'payload')).toStrictEqual(
      expect.objectContaining({
        0: 'cDA=',
        1: '',
        3: 'AH//CQoNXA==',
        10: 'aXQncw==',
        14: 'c2F5ICJoaSIgaXQncw==',
        19: null,
        22: 'xb4=',
      })
    )
  })

  it('serves lists as arrays, with the int64 items as text', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'tags')).toStrictEqual(
      expect.objectContaining({ 0: [], 1: ['1', '2'], 5: null, 13: ['4', null] })
    )
  })

  it('serves structs as objects, with the int64 fields as text', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'meta')).toStrictEqual(
      expect.objectContaining({
        0: { a: '0', b: 'm0' },
        2: null,
        8: { a: null, b: 'y' },
        17: { a: '3', b: null },
      })
    )
  })

  it('serves uuids as text, and a missing one as null', async () => {
    const page = await readEncodingPage(0, 1000)

    expect(cellsByRow(page, 'uid')).toStrictEqual(
      expect.objectContaining({
        0: '01234567-89ab-cdef-0123-456789abcdef',
        3: null,
        29: '22222222-2222-2202-2222-222222222202',
      })
    )
  })
})

it('reads page 0 of a frame deepnote-toolkit 2.9.1 stored', async () => {
  expect(await readFixturePage(path.join(fixturesDirectory, 'toolkit_frame'), 0, 10)).toStrictEqual({
    referenceId: '4f988928-3050-43ab-ab95-15554633d002',
    rowCount: 3,
    columnCount: 4,
    pageIndex: 0,
    pageSize: 10,
    pageCount: 1,
    columns: [
      { name: 'id', type: 'int64', timezone: null },
      { name: 'score', type: 'float', timezone: null },
      { name: 'seen_at', type: 'timestamp', timezone: 'Europe/Prague' },
      { name: 'label', type: 'string', timezone: null },
    ],
    rows: [
      ['9007199254740993', 1.5, '2024-01-02T03:04:05.678Z', 'alpha'],
      ['-7', null, '1969-12-31T23:59:59.999Z', null],
      ['0', -0.25, null, 'café'],
    ],
  })
})
