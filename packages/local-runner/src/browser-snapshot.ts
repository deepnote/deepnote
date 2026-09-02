/**
 * The snapshot-reader browser bundle: parse a `.deepnote` snapshot in a web page.
 *
 * Deliberately narrower than `@deepnote/pipelines/browser`, which also carries the client-only
 * pipeline engine. A page that only renders an already-run snapshot should not ship a cloud client
 * it never calls.
 */
export type {
  InputBlockInfo,
  SnapshotBlock,
  SnapshotInput,
  SnapshotNotebook,
  SnapshotView,
} from '@deepnote/pipelines'
export { parseSnapshot, toSnapshotView } from '@deepnote/pipelines'
