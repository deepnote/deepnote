import { type RecordBatch, type Schema, Vector } from 'apache-arrow'
import { DataframePageRequestError, InvalidArrowFileError } from './errors'
import type { ArrowPageColumn, DataframeColumn, DataframeRow } from './json-values'
import type { Manifest } from './manifest'
import type { DataframePageRequest } from './page-request'

/** One page of a stored frame, as the dataframe page endpoint answers it. */
export interface DataframePage {
  /** Names the frame file, so a client can tell that a re-run replaced the frame between two pages. */
  referenceId: string
  rowCount: number
  columnCount: number
  pageIndex: number
  pageSize: number
  pageCount: number
  columns: DataframeColumn[]
  rows: DataframeRow[]
}

/** The rows `[beginInBatch, endInBatch)` a page takes from one record batch. */
export interface PageBatch {
  /** The batch's position in `Manifest.batchRows`, which is its record batch index in the frame file. */
  index: number
  /** The batch's full row count, `Manifest.batchRows[index]`. */
  rows: number
  beginInBatch: number
  endInBatch: number
}

export interface DataframePagePlan {
  pageCount: number
  /** The number of rows in the page. */
  rows: number
  /** The record batches the page takes rows from, in file order. */
  batches: PageBatch[]
}

/**
 * Plans the page `request` asks for. Expects a request that `dataframePageRequestSchema` or `dataframePageQuerySchema`
 * accepted. An empty frame has one empty page. Throws `DataframePageRequestError` when `pageIndex` is past the last
 * page.
 */
export function planDataframePage(
  manifest: Pick<Manifest, 'rows' | 'batchRows'>,
  request: DataframePageRequest
): DataframePagePlan {
  const { pageIndex, pageSize } = request
  const pageCount = Math.max(1, Math.ceil(manifest.rows / pageSize))
  if (pageIndex >= pageCount) {
    throw new DataframePageRequestError(
      `pageIndex ${pageIndex} is out of range: the dataframe has ${pageCount} page(s) of ${pageSize} rows.`
    )
  }

  const firstRow = pageIndex * pageSize
  const endRow = Math.min(firstRow + pageSize, manifest.rows)
  const batches: PageBatch[] = []
  let batchStart = 0
  manifest.batchRows.forEach((rows, index) => {
    const batchEnd = batchStart + rows
    if (rows > 0 && batchStart < endRow && batchEnd > firstRow) {
      batches.push({
        index,
        rows,
        beginInBatch: Math.max(firstRow - batchStart, 0),
        endInBatch: Math.min(endRow, batchEnd) - batchStart,
      })
    }
    batchStart = batchEnd
  })
  return { pageCount, rows: endRow - firstRow, batches }
}

/**
 * The page's columns: for each field of `schema`, the rows `pageBatches` take from `batches`, joined into one vector.
 *
 * Pass the reader's schema, not `batch.schema`: apache-arrow rebuilds `batch.schema` by field name, which gives the
 * first of two same-named columns the other's type. Pass exactly the record batches `pageBatches` lists, in its order.
 *
 * Throws `InvalidArrowFileError` when `batches` does not match `pageBatches` in count or row counts, or a batch lacks a
 * column of `schema`.
 */
export function slicePageColumns(
  schema: Schema,
  batches: readonly RecordBatch[],
  pageBatches: readonly PageBatch[]
): ArrowPageColumn[] {
  if (batches.length !== pageBatches.length) {
    throw InvalidArrowFileError.decodedBatchCountMismatch({
      decoded: batches.length,
      expected: pageBatches.length,
    })
  }
  if (pageBatches.length === 0) {
    return []
  }
  pageBatches.forEach(({ rows }, index) => {
    const { numRows } = batches[index]
    if (numRows !== rows) {
      throw InvalidArrowFileError.batchRowCountMismatch({ rows: numRows, expected: rows })
    }
  })
  // Slices columns, not batches: every RecordBatch apache-arrow builds runs Schema.assign, quadratic in the columns.
  return schema.fields.map((field, columnIndex) => ({
    field,
    vector: new Vector(
      pageBatches.map(({ beginInBatch, endInBatch }, index) => {
        const data = batches[index].data.children[columnIndex]
        if (!data) {
          throw InvalidArrowFileError.batchMissingColumn(columnIndex)
        }
        return data.slice(beginInBatch, endInBatch - beginInBatch)
      })
    ),
  }))
}
