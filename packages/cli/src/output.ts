import { encode as toonEncode } from '@toon-format/toon'
import { Chalk, type ChalkInstance } from 'chalk'

/**
 * Global output configuration for the CLI.
 * Controls color output, verbosity, and quiet mode.
 */
export interface OutputConfig {
  /** Whether to use colored output */
  color: boolean
  /** Whether to show debug/verbose output */
  debug: boolean
  /** Whether to suppress non-essential output */
  quiet: boolean
}

/** Default output configuration */
const defaultConfig: OutputConfig = {
  color: true,
  debug: false,
  quiet: false,
}

/** Current output configuration (mutable singleton) */
let currentConfig: OutputConfig = { ...defaultConfig }

/** CLI-specific chalk instance (avoids modifying global chalk) */
let cliChalk: ChalkInstance = new Chalk()

/**
 * Get the current output configuration.
 * Returns a copy to prevent external mutations from affecting internal state.
 */
export function getOutputConfig(): Readonly<OutputConfig> {
  return { ...currentConfig }
}

/**
 * Update the output configuration.
 */
export function setOutputConfig(config: Partial<OutputConfig>): void {
  currentConfig = { ...currentConfig, ...config }

  // Create new chalk instance with appropriate color level
  // This avoids modifying the global chalk instance
  cliChalk = new Chalk({ level: currentConfig.color ? undefined : 0 })
}

/**
 * Reset output configuration to defaults.
 * Useful for testing.
 */
export function resetOutputConfig(): void {
  currentConfig = { ...defaultConfig }
  cliChalk = new Chalk()
}

/**
 * Check if colors should be disabled based on environment.
 * Respects NO_COLOR and FORCE_COLOR standards.
 *
 * @see https://no-color.org/
 * @see https://force-color.org/
 */
export function shouldDisableColor(): boolean {
  // FORCE_COLOR takes precedence
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR === '0'
  }

  // NO_COLOR standard: presence (any value) disables color
  if (process.env.NO_COLOR !== undefined) {
    return true
  }

  // Check if output is a TTY
  if (!process.stdout.isTTY) {
    return true
  }

  return false
}

/**
 * Get a chalk instance configured for current output settings.
 * Uses a CLI-specific instance to avoid modifying global chalk state.
 */
export function getChalk(): ChalkInstance {
  return cliChalk
}

/**
 * Output a message to stdout (always shown, ignores quiet mode).
 * Use this for essential command output that shouldn't be suppressed.
 */
export function output(message: string): void {
  console.log(message)
}

/**
 * Log a message (respects quiet mode).
 * Use this for status/progress messages that can be suppressed.
 */
export function log(message: string): void {
  if (!currentConfig.quiet) {
    console.log(message)
  }
}

/**
 * Log a debug message (only shown in debug mode).
 */
export function debug(message: string): void {
  if (currentConfig.debug && !currentConfig.quiet) {
    console.error(cliChalk.dim(`[debug] ${message}`))
  }
}

/**
 * Log an error message (always shown, even in quiet mode).
 */
export function error(message: string): void {
  console.error(cliChalk.red(message))
}

/**
 * Output data as JSON (for machine-readable output).
 */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

/**
 * Analyze whether TOON format provides meaningful savings over JSON.
 * TOON excels with uniform arrays of objects (30-60% savings typical).
 * Compares against minified JSON for a fair comparison.
 *
 * @param data - The data to analyze
 * @param encodedToon - Optional pre-encoded TOON string to avoid re-encoding
 * @returns Object with toon/json sizes and whether TOON is recommended
 */
export function analyzeToonEfficiency(
  data: unknown,
  encodedToon?: string
): {
  toonSize: number
  jsonSize: number
  savingsPercent: number
  toonRecommended: boolean
} {
  const toonOutput = encodedToon ?? toonEncode(data)
  // Compare against minified JSON for fair comparison
  const jsonOutput = JSON.stringify(data)

  const toonSize = toonOutput.length
  const jsonSize = jsonOutput.length

  // Calculate savings (positive = TOON is smaller)
  // Guard against division by zero when jsonSize is 0
  const savingsPercent = jsonSize === 0 ? 0 : ((jsonSize - toonSize) / jsonSize) * 100

  // TOON is recommended if it provides at least 10% savings over minified JSON
  // Below this threshold, JSON might be preferred for compatibility
  const toonRecommended = savingsPercent >= 10

  return { toonSize, jsonSize, savingsPercent, toonRecommended }
}

/**
 * Output data as TOON (Token-Oriented Object Notation).
 * TOON is a compact, LLM-optimized format that reduces token usage by 30-60%
 * compared to JSON while remaining human-readable.
 *
 * Shows an efficiency hint when TOON provides minimal benefit over JSON,
 * suggesting JSON might be preferred for compatibility.
 *
 * @see https://toonformat.dev/
 */
export function outputToon(data: unknown, options?: { showEfficiencyHint?: boolean }): void {
  const toonOutput = toonEncode(data)
  console.log(toonOutput)

  // Show efficiency hint if enabled and not in quiet mode
  if (options?.showEfficiencyHint && !currentConfig.quiet) {
    // Pass pre-encoded toonOutput to avoid re-encoding
    const { savingsPercent, toonRecommended } = analyzeToonEfficiency(data, toonOutput)

    if (!toonRecommended) {
      const hint =
        savingsPercent <= 0
          ? `Hint: JSON would be ${Math.abs(savingsPercent).toFixed(0)}% smaller for this data. ` +
            'Consider --json for better compatibility.'
          : `Hint: TOON only saves ${savingsPercent.toFixed(0)}% over JSON for this data. ` +
            'TOON works best with uniform arrays of objects (30-60% typical savings).'

      console.error(cliChalk.dim(hint))
    }
  }
}
