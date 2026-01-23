import type { OutputFormat } from '../output'

/**
 * Creates a validator function for output format options.
 * @param allowedFormats - Array of allowed output format values
 * @returns Validator function for Commander option parsing
 */
export function createFormatValidator(allowedFormats: readonly OutputFormat[]): (value: string) => OutputFormat {
  return (value: string): OutputFormat => {
    if (!allowedFormats.includes(value as OutputFormat)) {
      throw new Error(`Invalid output format: ${value}. Valid formats: ${allowedFormats.join(', ')}`)
    }
    return value as OutputFormat
  }
}
