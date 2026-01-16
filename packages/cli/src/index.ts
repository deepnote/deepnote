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
 * # Run a project locally (coming soon)
 * deepnote run project.deepnote
 *
 * # Run on Deepnote Cloud (coming soon)
 * deepnote run project.deepnote --cloud
 * ```
 *
 * @packageDocumentation
 */

export { createProgram, run } from './cli'
export { version } from './version'
