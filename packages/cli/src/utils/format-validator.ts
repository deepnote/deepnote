import type { OutputFormat } from '../output'

/**
 * Creates a validator function for output format options.
 * @param allowedFormats - Array of allowed output format values
 * @returns Validator function for Commander option parsing
 */
export function createFormatValidator(allowedFormats: readonly OutputFormat[]): (value: string) => OutputFormat
export function createFormatValidator<T extends string>(allowedFormats: readonly T[]): (value: string) => T
export function createFormatValidator<T extends string>(allowedFormats: readonly T[]): (value: string) => T {
  return (value: string): T => {
    if (!allowedFormats.includes(value as T)) {
      throw new Error(`Invalid output format: ${value}. Valid formats: ${allowedFormats.join(', ')}`)
    }
    return value as T
  }
}
