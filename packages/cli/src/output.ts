import chalk, { type ChalkInstance } from 'chalk'

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

/**
 * Get the current output configuration.
 */
export function getOutputConfig(): Readonly<OutputConfig> {
  return currentConfig
}

/**
 * Update the output configuration.
 */
export function setOutputConfig(config: Partial<OutputConfig>): void {
  currentConfig = { ...currentConfig, ...config }

  // Update chalk's color level based on config
  if (!currentConfig.color) {
    chalk.level = 0
  }
}

/**
 * Reset output configuration to defaults.
 * Useful for testing.
 */
export function resetOutputConfig(): void {
  currentConfig = { ...defaultConfig }
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
 */
export function getChalk(): ChalkInstance {
  return chalk
}

/**
 * Log a message (respects quiet mode).
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
    console.error(chalk.dim(`[debug] ${message}`))
  }
}

/**
 * Log an error message (always shown, even in quiet mode).
 */
export function error(message: string): void {
  console.error(chalk.red(message))
}

/**
 * Output data as JSON (for machine-readable output).
 */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
