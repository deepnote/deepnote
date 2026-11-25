import {
  type Data,
  DateDay,
  Field,
  Int32,
  makeData,
  RecordBatch,
  Schema,
  Struct,
  Utf8,
  vectorFromArray,
} from 'apache-arrow'
import { describe, expect, it } from 'vitest'
import { DataframePageRequestError, InvalidArrowFileError } from './errors'
import { encodeRows } from './json-values'
import type { Manifest } from './manifest'
import { type DataframePagePlan, type PageBatch, planDataframePage, slicePageColumns } from './page'
import type { DataframePageRequest } from './page-request'

type PlannedManifest = Pick<Manifest, 'rows' | 'batchRows'>

function recordBatch(schema: Schema, children: Data[]): RecordBatch {
  return new RecordBatch(schema, makeData({ type: new Struct(schema.fields), length: children[0].length, children }))
}

function ints(...values: number[]): Data {
  return vectorFromArray(values, new Int32()).data[0]
}

function texts(...values: string[]): Data {
  return vectorFromArray(values, new Utf8()).data[0]
}

describe('planDataframePage', () => {
  const frame: PlannedManifest = { rows: 25, batchRows: [10, 10, 5] }

  it.each<[string, PlannedManifest, DataframePageRequest, DataframePagePlan]>([
    [
      'page 0 of 10 rows takes only batch 0, which ends where batch 1 starts',
      frame,
      { pageIndex: 0, pageSize: 10 },
      { pageCount: 3, rows: 10, batches: [{ index: 0, rows: 10, beginInBatch: 0, endInBatch: 10 }] },
    ],
    [
      'page 1 of 10 rows takes only batch 1',
      frame,
      { pageIndex: 1, pageSize: 10 },
      { pageCount: 3, rows: 10, batches: [{ index: 1, rows: 10, beginInBatch: 0, endInBatch: 10 }] },
    ],
    [
      'page 2 of 10 rows takes the 5 rows of batch 2',
      frame,
      { pageIndex: 2, pageSize: 10 },
      { pageCount: 3, rows: 5, batches: [{ index: 2, rows: 5, beginInBatch: 0, endInBatch: 5 }] },
    ],
    [
      'page 0 of 15 rows spans batch 0 and the start of batch 1',
      frame,
      { pageIndex: 0, pageSize: 15 },
      {
        pageCount: 2,
        rows: 15,
        batches: [
          { index: 0, rows: 10, beginInBatch: 0, endInBatch: 10 },
          { index: 1, rows: 10, beginInBatch: 0, endInBatch: 5 },
        ],
      },
    ],
    [
      'page 1 of 15 rows spans the end of batch 1 and batch 2, giving their full row counts',
      frame,
      { pageIndex: 1, pageSize: 15 },
      {
        pageCount: 2,
        rows: 10,
        batches: [
          { index: 1, rows: 10, beginInBatch: 5, endInBatch: 10 },
          { index: 2, rows: 5, beginInBatch: 0, endInBatch: 5 },
        ],
      },
    ],
    [
      'page 24 of 1 row takes the last row of batch 2',
      frame,
      { pageIndex: 24, pageSize: 1 },
      { pageCount: 25, rows: 1, batches: [{ index: 2, rows: 5, beginInBatch: 4, endInBatch: 5 }] },
    ],
    [
      'a page leaves out the batches of no rows',
      { rows: 10, batchRows: [0, 5, 0, 5] },
      { pageIndex: 0, pageSize: 10 },
      {
        pageCount: 1,
        rows: 10,
        batches: [
          { index: 1, rows: 5, beginInBatch: 0, endInBatch: 5 },
          { index: 3, rows: 5, beginInBatch: 0, endInBatch: 5 },
        ],
      },
    ],
    [
      'an empty frame has one empty page',
      { rows: 0, batchRows: [] },
      { pageIndex: 0, pageSize: 10 },
      { pageCount: 1, rows: 0, batches: [] },
    ],
  ])('%s', (_, manifest, request, plan) => {
    expect(planDataframePage(manifest, request)).toStrictEqual(plan)
  })

  it.each<[string, PlannedManifest, number, string]>([
    ['the page after the last', frame, 3, 'pageIndex 3 is out of range: the dataframe has 3 page(s) of 10 rows.'],
    [
      'the page after the one page of an empty frame',
      { rows: 0, batchRows: [] },
      1,
      'pageIndex 1 is out of range: the dataframe has 1 page(s) of 10 rows.',
    ],
  ])('refuses %s as a bad request', (_, manifest, pageIndex, message) => {
    const plan = () => planDataframePage(manifest, { pageIndex, pageSize: 10 })

    expect(plan).toThrow(DataframePageRequestError)
    expect(plan).toThrow(expect.objectContaining({ message }))
  })
})

describe('slicePageColumns', () => {
  const schema = new Schema([new Field('n', new Int32()), new Field('s', new Utf8())])
  const first = recordBatch(schema, [ints(1, 2, 3), texts('a', 'b', 'c')])
  const second = recordBatch(schema, [ints(4, 5), texts('d', 'e')])
  const wholeFirst: PageBatch = { index: 0, rows: 3, beginInBatch: 0, endInBatch: 3 }

  it('joins the rows each batch gives the page, column by column', () => {
    const columns = slicePageColumns(
      schema,
      [first, second],
      [
        { index: 0, rows: 3, beginInBatch: 1, endInBatch: 3 },
        { index: 1, rows: 2, beginInBatch: 0, endInBatch: 1 },
      ]
    )

    expect(columns.map(({ field, vector }) => [field.name, [...vector]])).toStrictEqual([
      ['n', [2, 3, 4]],
      ['s', ['b', 'c', 'd']],
    ])
  })

  it('returns no columns for a page of no batches', () => {
    expect(slicePageColumns(schema, [], [])).toStrictEqual([])
  })

  it.each<[string, () => unknown, string, string]>([
    [
      'fewer batches than the page lists',
      () => slicePageColumns(schema, [first], [wholeFirst, { index: 1, rows: 2, beginInBatch: 0, endInBatch: 2 }]),
      'decoded_batch_count_mismatch',
      'Frame decoded to 1 record batches instead of 2',
    ],
    [
      'a batch of another row count than the page gives it',
      () => slicePageColumns(schema, [first], [{ index: 0, rows: 4, beginInBatch: 0, endInBatch: 3 }]),
      'batch_row_count_mismatch',
      'A record batch has 3 rows where batch_rows says 4',
    ],
    [
      'a batch without a column of the schema',
      () => slicePageColumns(new Schema([...schema.fields, new Field('extra', new Int32())]), [first], [wholeFirst]),
      'batch_missing_column',
      'A record batch has no column 2',
    ],
  ])('refuses %s as an invalid frame', (_, slice, reason, message) => {
    expect(slice).toThrow(InvalidArrowFileError)
    expect(slice).toThrow(expect.objectContaining({ reason, message }))
  })

  it('keeps the type of each of two same-named columns from the schema it is given', () => {
    const sameNamed = new Schema([new Field('x', new Int32()), new Field('x', new Utf8())])
    const batch = recordBatch(sameNamed, [ints(1, 2), texts('a', 'b')])

    const columns = slicePageColumns(sameNamed, [batch], [{ index: 0, rows: 2, beginInBatch: 0, endInBatch: 2 }])

    expect(columns.map(({ field, vector }) => [field.name, String(field.type), [...vector]])).toStrictEqual([
      ['x', 'Int32', [1, 2]],
      ['x', 'Utf8', ['a', 'b']],
    ])
  })

  it('encodes a page whose slice leaves out a date after the year 9999, and refuses the page that holds it', async () => {
    const dates = new Schema([new Field('day', new DateDay())])
    // Day 2,932,897 after 1970-01-01 is 10000-01-01.
    const batch = recordBatch(dates, [makeData({ type: new DateDay(), data: Int32Array.of(0, 2_932_897, 1, 2) })])
    const encodePage = (pageIndex: number) => {
      const plan = planDataframePage({ rows: 4, batchRows: [4] }, { pageIndex, pageSize: 2 })
      return encodeRows(slicePageColumns(dates, [batch], plan.batches), plan.rows)
    }

    expect(await encodePage(1)).toStrictEqual([['1970-01-02'], ['1970-01-03']])
    await expect(encodePage(0)).rejects.toThrow(expect.objectContaining({ reason: 'date_out_of_range' }))
  })
})
