/**
 * Browser entry point: everything needed to render a `.deepnote` snapshot in a web page.
 *
 * Deliberately separate from `index.ts`, which reaches for `node:fs` and the Python
 * `ExecutionEngine`. Nothing reachable from here touches either, so this bundles for the browser.
 */

export type { SnapshotBlock, SnapshotNotebook, SnapshotView } from './snapshot-view'
export { parseSnapshot, toSnapshotView } from './snapshot-view'
export type { MountOptions } from './snapshot-viewer'
export { mountSnapshotViewer, renderSnapshot } from './snapshot-viewer'
