/**
 * @deepnote/mcp
 *
 * MCP server for AI-assisted Deepnote notebook creation and manipulation.
 *
 * Exposed tool surface:
 * - Reading: read, cat, validate, diff
 * - Writing: create, add_block, edit_block, remove_block, reorder_blocks
 * - Conversion: convert_to, convert_from
 * - Execution: run
 * - Snapshots: snapshot_list, snapshot_load, snapshot_split, snapshot_merge
 *
 * @packageDocumentation
 */

export type { DeepnoteMcpServer } from './server'
export { createServer, startServer } from './server'
