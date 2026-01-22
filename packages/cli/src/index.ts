/**
 * @deepnote/cli
 *
 * Command-line interface for running Deepnote projects locally and on Deepnote Cloud.
 *
 * @example
 * ```bash
 * # Show help
 * deepnote --help
 *
 * # Show version
 * deepnote --version
 *
 * # Inspect a .deepnote file
 * deepnote inspect project.deepnote
 *
 * # Inspect with JSON output
 * deepnote inspect project.deepnote --json
 *
 * # Run a project locally
 * deepnote run project.deepnote
 *
 * # Generate shell completions
 * deepnote completion bash >> ~/.bashrc
 * ```
 *
 * @packageDocumentation
 */

export type { GlobalOptions } from './cli'
export { createProgram, run } from './cli'
export type { ExitCode as ExitCodeType } from './exit-codes'
export { ExitCode } from './exit-codes'
export type { OutputConfig } from './output'
export { getOutputConfig, resetOutputConfig, setOutputConfig, shouldDisableColor } from './output'
export { FileResolutionError, resolvePathToDeepnoteFile } from './utils/file-resolver'
export { version } from './version'
