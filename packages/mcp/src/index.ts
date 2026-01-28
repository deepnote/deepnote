/**
 * @deepnote/mcp
 *
 * MCP server for AI-assisted Deepnote notebook creation and manipulation.
 *
 * Provides tools for:
 * - Magic operations: scaffold, enhance, fix, explain, suggest
 * - Reading: inspect, cat, lint, stats, analyze, dag, diff
 * - Writing: create, add_block, edit_block, remove_block, bulk_edit
 * - Conversion: convert_to, convert_from, detect_format
 * - Execution: run, run_block
 *
 * @packageDocumentation
 */

export type { DeepnoteMcpServer } from './server'
export { createServer, startServer } from './server'
