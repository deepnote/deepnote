import { Field, Int32, Struct, Utf8 } from 'apache-arrow'
import { describe, expect, it } from 'vitest'
import {
  DataframeNotFoundError,
  DataframePageError,
  DataframePageRequestError,
  dataframePageErrorResponse,
  InvalidArrowFileError,
  UnservablePageError,
  UnsupportedArrowTypeError,
} from './errors'

class ForgedFooterError extends InvalidArrowFileError {
  static forgedFooter(): ForgedFooterError {
    return new ForgedFooterError('forged_footer', 'The footer points past the end of the file')
  }
}

class PageTooLargeError extends UnservablePageError {
  static pageTooLarge(): PageTooLargeError {
    return new PageTooLargeError('page_too_large', 'The page takes more than 8 MiB of JSON.')
  }
}

describe('dataframePageErrorResponse', () => {
  it.each([
    ['DataframeNotFoundError', new DataframeNotFoundError(), 404, 'Dataframe not found'],
    ['InvalidArrowFileError', InvalidArrowFileError.batchMissingColumn(2), 404, 'Dataframe not found'],
    ['an InvalidArrowFileError subclass', ForgedFooterError.forgedFooter(), 404, 'Dataframe not found'],
    [
      'DataframePageRequestError',
      new DataframePageRequestError('pageIndex 3 is out of range'),
      400,
      'pageIndex 3 is out of range',
    ],
    [
      'UnservablePageError',
      UnservablePageError.lz4Compressed(),
      422,
      'The stored dataframe is compressed with lz4, which the server cannot decode.',
    ],
    [
      'UnsupportedArrowTypeError',
      UnsupportedArrowTypeError.unsupportedColumnType(new Utf8()),
      422,
      'The dataframe has an unsupported column type Utf8.',
    ],
    [
      'an UnservablePageError subclass',
      PageTooLargeError.pageTooLarge(),
      422,
      'The page takes more than 8 MiB of JSON.',
    ],
  ])('answers %s', (_, error, status, message) => {
    expect(dataframePageErrorResponse(error)).toStrictEqual({ status, body: { message } })
  })

  it('keeps the reason of an error a consumer defines', () => {
    const forgedFooter = ForgedFooterError.forgedFooter()
    const pageTooLarge = PageTooLargeError.pageTooLarge()

    expect(forgedFooter.reason).toBe('forged_footer')
    expect(forgedFooter).toBeInstanceOf(DataframePageError)
    expect(pageTooLarge.reason).toBe('page_too_large')
    expect(pageTooLarge).toBeInstanceOf(DataframePageError)
  })
})

describe('error factories', () => {
  it.each<[string, InvalidArrowFileError | UnservablePageError, string, string]>([
    [
      'InvalidArrowFileError.batchCountMismatch',
      InvalidArrowFileError.batchCountMismatch({ listed: 3, held: 2 }),
      'batch_count_mismatch',
      "The manifest's batch_rows lists 3 batches but the frame holds 2",
    ],
    [
      'InvalidArrowFileError.undecodable',
      InvalidArrowFileError.undecodable('the footer is truncated'),
      'undecodable',
      'Frame could not be decoded: the footer is truncated',
    ],
    [
      'UnservablePageError.lz4Compressed',
      UnservablePageError.lz4Compressed(),
      'lz4_compressed',
      'The stored dataframe is compressed with lz4, which the server cannot decode.',
    ],
  ])('%s gives its reason and message', (_, error, reason, message) => {
    expect(error).toMatchObject({ reason, message })
  })
})

describe('UnsupportedArrowTypeError', () => {
  it('names the struct type whose fields share a name', () => {
    const type = new Struct([new Field('x', new Int32()), new Field('x', new Utf8())])

    expect(UnsupportedArrowTypeError.duplicateStructField(type)).toMatchObject({
      reason: 'duplicate_struct_field',
      message: 'The dataframe has a struct with two fields of the same name, Struct<{x:Int32, x:Utf8}>.',
    })
  })
})
