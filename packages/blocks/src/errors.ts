/**
 * Base error class for all Deepnote errors.
 */
export class DeepnoteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = this.constructor.name
  }
}

/**
 * Generic parse failure, optionally associated with a file path.
 */
export class ParseError extends DeepnoteError {
  filePath?: string

  constructor(message: string, options?: ErrorOptions & { filePath?: string }) {
    super(message, options)
    this.filePath = options?.filePath
  }
}

/**
 * YAML syntax or duplicate key errors.
 */
export class YamlParseError extends ParseError {}

/**
 * BOM or invalid UTF-8 encoding errors.
 */
export class EncodingError extends ParseError {}

/**
 * Zod schema validation failures.
 */
export class SchemaValidationError extends ParseError {}

/**
 * Prohibited YAML features: anchors, aliases, merge keys, tags.
 */
export class ProhibitedYamlFeatureError extends ParseError {
  feature: string

  constructor(message: string, options: ErrorOptions & { feature: string; filePath?: string }) {
    super(message, options)
    this.feature = options.feature
  }
}

/**
 * Thrown when a block type is not supported.
 */
export class UnsupportedBlockTypeError extends DeepnoteError {}

/**
 * Thrown when a value is invalid (e.g., slider value, date interval).
 */
export class InvalidValueError extends DeepnoteError {
  value: unknown

  constructor(message: string, options: ErrorOptions & { value: unknown }) {
    super(message, options)
    this.value = options.value
  }
}
