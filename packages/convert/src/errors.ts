import { DeepnoteError, ParseError } from '@deepnote/blocks'

/**
 * Thrown when a file cannot be read from disk.
 */
export class FileReadError extends DeepnoteError {
  filePath: string

  constructor(message: string, options: ErrorOptions & { filePath: string }) {
    super(message, options)
    this.filePath = options.filePath
  }
}

/**
 * Thrown when a file cannot be written to disk.
 */
export class FileWriteError extends DeepnoteError {
  filePath: string

  constructor(message: string, options: ErrorOptions & { filePath: string }) {
    super(message, options)
    this.filePath = options.filePath
  }
}

/**
 * Thrown when JSON parsing fails.
 */
export class JsonParseError extends ParseError {}

/**
 * Thrown when a file format is not supported.
 */
export class UnsupportedFormatError extends DeepnoteError {
  filename?: string

  constructor(message: string, options?: ErrorOptions & { filename?: string }) {
    super(message, options)
    this.filename = options?.filename
  }
}
