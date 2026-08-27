/**
 * The snapshot-reader browser bundle: parse a `.deepnote` snapshot in a web page.
 *
 * Deliberately narrower than `browser.ts`, which also carries the client-only orchestrator. A page
 * that only renders an already-run snapshot should not ship a cloud client it never calls.
 */
export type { InputBlockInfo } from './input-info'
export type { SnapshotBlock, SnapshotInput, SnapshotNotebook, SnapshotView } from './snapshot-view'
export { parseSnapshot, toSnapshotView } from './snapshot-view'
