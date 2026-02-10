import type { OutputFormat } from '../output'

/**
 * Resolution map for 'llm' format in commands that support TOON.
 * The 'llm' format is an abstraction that resolves to the best format for LLM consumption.
 */
export const TOON_LLM_RESOLUTION: Record<string, OutputFormat> = {
  llm: 'toon',
}

/**
 * Resolution map for 'llm' format in commands that only support JSON.
 * The 'llm' format is an abstraction that resolves to the best format for LLM consumption.
 */
export const JSON_LLM_RESOLUTION: Record<string, 'json'> = {
  llm: 'json',
}

/**
 * Creates a validator function for output format options.
 * @param allowedFormats - Array of allowed output format values
 * @param aliases - Optional mapping of aliases to canonical format names
 * @returns Validator function for Commander option parsing
 */
export function createFormatValidator(
  allowedFormats: readonly OutputFormat[],
  aliases?: Record<string, OutputFormat>
): (value: string) => OutputFormat
export function createFormatValidator<T extends string>(
  allowedFormats: readonly T[],
  aliases?: Record<string, T>
): (value: string) => T
export function createFormatValidator<T extends string>(
  allowedFormats: readonly T[],
  aliases?: Record<string, T>
): (value: string) => T {
  return (value: string): T => {
    const resolved = aliases?.[value] ?? value

    if (!allowedFormats.includes(resolved as T)) {
      const aliasesForAllowed = aliases
        ? Object.entries(aliases)
            .filter(([_, canonical]) => allowedFormats.includes(canonical as T))
            .map(([alias]) => alias)
        : []
      const validValues = [...allowedFormats, ...aliasesForAllowed].join(', ')
      throw new Error(`Invalid output format: ${value}. Valid formats: ${validValues}`)
    }
    return resolved as T
  }
}
