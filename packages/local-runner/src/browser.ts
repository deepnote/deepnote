/**
 * Browser entry point: parse a `.deepnote` snapshot in a web page.
 *
 * Separate from `index.ts`, which reaches for `node:fs` and the Python `ExecutionEngine`. Nothing
 * reachable from here touches either, so this bundles for the browser — a page can read a snapshot
 * with no server, no Python and no kernel.
 *
 * Rendering is deliberately not included: a DOM renderer is a page concern, and the shapes it
 * produces (how a table looks, whether HTML output is sandboxed) belong to the page, not the
 * library. See `examples/local-runner/snapshot-viewer` for a complete one.
 */
export type { InputBlockInfo } from './input-info'
export type { SnapshotBlock, SnapshotInput, SnapshotNotebook, SnapshotView } from './snapshot-view'
export { parseSnapshot, toSnapshotView } from './snapshot-view'
