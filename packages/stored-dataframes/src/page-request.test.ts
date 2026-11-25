import { describe, expect, it } from 'vitest'
import { dataframePageQuerySchema, dataframePageRequestSchema } from './page-request'

function refusedPaths(request: { pageIndex: number; pageSize: number }) {
  return dataframePageRequestSchema.safeParse(request).error?.issues.map(issue => issue.path)
}

describe('dataframePageRequestSchema', () => {
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses pageIndex %s', pageIndex => {
    expect(refusedPaths({ pageIndex, pageSize: 10 })).toStrictEqual([['pageIndex']])
  })

  it.each([0, 1.5, 1001])('refuses pageSize %s', pageSize => {
    expect(refusedPaths({ pageIndex: 0, pageSize })).toStrictEqual([['pageSize']])
  })

  it('refuses a request with both parameters invalid, naming both', () => {
    expect(refusedPaths({ pageIndex: -1, pageSize: 0 })).toStrictEqual([['pageIndex'], ['pageSize']])
  })

  it.each([1, 1000])('accepts pageSize %s', pageSize => {
    expect(dataframePageRequestSchema.parse({ pageIndex: 0, pageSize })).toStrictEqual({ pageIndex: 0, pageSize })
  })
})

describe('dataframePageQuerySchema', () => {
  it('defaults an empty query to the first page of 10 rows', () => {
    expect(dataframePageQuerySchema.parse({})).toStrictEqual({ pageIndex: 0, pageSize: 10 })
  })

  it('reads parameters given as strings as numbers', () => {
    expect(dataframePageQuerySchema.parse({ pageIndex: '2', pageSize: '50' })).toStrictEqual({
      pageIndex: 2,
      pageSize: 50,
    })
  })

  it.each([
    ['1', 1],
    ['1000', 1000],
  ])('accepts pageIndex 0 with pageSize %s', (pageSize, parsed) => {
    expect(dataframePageQuerySchema.parse({ pageIndex: '0', pageSize })).toStrictEqual({
      pageIndex: 0,
      pageSize: parsed,
    })
  })

  it('refuses a key other than pageIndex and pageSize', () => {
    expect(dataframePageQuerySchema.safeParse({ pageIndex: '0', sortBy: 'name' }).error?.issues).toMatchObject([
      { code: 'unrecognized_keys', keys: ['sortBy'], path: [] },
    ])
  })

  it.each<[Record<string, string>, string, string]>([
    [{ pageIndex: '-1' }, 'too_small', 'pageIndex'],
    [{ pageIndex: '1.5' }, 'invalid_type', 'pageIndex'],
    [{ pageSize: '0' }, 'too_small', 'pageSize'],
    [{ pageSize: '1.5' }, 'invalid_type', 'pageSize'],
    [{ pageSize: '1001' }, 'too_big', 'pageSize'],
  ])('refuses the query %j', (query, code, parameter) => {
    expect(dataframePageQuerySchema.safeParse(query).error?.issues).toMatchObject([{ code, path: [parameter] }])
  })
})
