import type { DataType } from 'apache-arrow'

export const DATAFRAME_NOT_FOUND_MESSAGE = 'Dataframe not found'

export type DataframePageErrorStatus = 400 | 404 | 422

/** An error a dataframe page request answers with `status`; see `dataframePageErrorResponse`. */
export abstract class DataframePageError extends Error {
  abstract readonly status: DataframePageErrorStatus
}

export class DataframeNotFoundError extends DataframePageError {
  readonly status = 404

  constructor() {
    super(DATAFRAME_NOT_FOUND_MESSAGE)
  }
}

export class DataframePageRequestError extends DataframePageError {
  readonly status = 400

  constructor(message: string) {
    super(message)
  }
}

/**
 * The stored frame or its manifest is not a valid frame. Answered as a missing frame, so the response never carries
 * `message`. Consumers add their own reasons through the constructor or a subclass.
 */
export class InvalidArrowFileError extends DataframePageError {
  readonly status = 404

  constructor(
    readonly reason: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
  }

  static batchCountMismatch({ listed, held }: { listed: number; held: number }): InvalidArrowFileError {
    return new InvalidArrowFileError(
      'batch_count_mismatch',
      `The manifest's batch_rows lists ${listed} batches but the frame holds ${held}`
    )
  }

  static decodedBatchCountMismatch({
    decoded,
    expected,
  }: {
    decoded: number
    expected: number
  }): InvalidArrowFileError {
    return new InvalidArrowFileError(
      'decoded_batch_count_mismatch',
      `Frame decoded to ${decoded} record batches instead of ${expected}`
    )
  }

  static batchRowCountMismatch({ rows, expected }: { rows: number; expected: number }): InvalidArrowFileError {
    return new InvalidArrowFileError(
      'batch_row_count_mismatch',
      `A record batch has ${rows} rows where batch_rows says ${expected}`
    )
  }

  static batchMissingColumn(columnIndex: number): InvalidArrowFileError {
    return new InvalidArrowFileError('batch_missing_column', `A record batch has no column ${columnIndex}`)
  }

  static undecodable(detail: string): InvalidArrowFileError {
    return new InvalidArrowFileError('undecodable', `Frame could not be decoded: ${detail}`)
  }

  static unreadableValue(detail: string, cause: unknown): InvalidArrowFileError {
    return new InvalidArrowFileError('unreadable_value', detail, { cause })
  }

  static unreadableRow(rowIndex: number, detail: string, cause: unknown): InvalidArrowFileError {
    return new InvalidArrowFileError('unreadable_row', `Row ${rowIndex} could not be read: ${detail}`, { cause })
  }
}

/**
 * The frame is valid, but the server cannot serve it or the requested page. Consumers add their own reasons through the
 * constructor or a subclass.
 */
export class UnservablePageError extends DataframePageError {
  readonly status = 422

  constructor(
    readonly reason: string,
    message: string
  ) {
    super(message)
  }

  static lz4Compressed(): UnservablePageError {
    return new UnservablePageError(
      'lz4_compressed',
      'The stored dataframe is compressed with lz4, which the server cannot decode.'
    )
  }

  static dateOutOfRange(): UnservablePageError {
    return new UnservablePageError(
      'date_out_of_range',
      'The page holds a date or timestamp outside the years 0 to 9999, which the server cannot format.'
    )
  }
}

export class UnsupportedArrowTypeError extends UnservablePageError {
  static unsupportedColumnType(type: DataType): UnsupportedArrowTypeError {
    return new UnsupportedArrowTypeError(
      'unsupported_column_type',
      `The dataframe has an unsupported column type ${String(type)}.`
    )
  }

  static duplicateStructField(type: DataType): UnsupportedArrowTypeError {
    return new UnsupportedArrowTypeError(
      'duplicate_struct_field',
      `The dataframe has a struct with two fields of the same name, ${String(type)}.`
    )
  }
}

/** The HTTP status and JSON body that answer `error`. An `InvalidArrowFileError` never exposes its message. */
export function dataframePageErrorResponse(error: DataframePageError): {
  status: DataframePageErrorStatus
  body: { message: string }
} {
  const message = error instanceof InvalidArrowFileError ? DATAFRAME_NOT_FOUND_MESSAGE : error.message
  return { status: error.status, body: { message } }
}
