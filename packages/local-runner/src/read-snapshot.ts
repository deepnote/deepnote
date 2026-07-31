import { existsSync, readFileSync } from 'node:fs'
import type { DeepnoteFile } from '@deepnote/blocks'
import type { SnapshotView } from './snapshot-view'
import { parseSnapshot, toSnapshotView } from './snapshot-view'

/**
 * Read a `.deepnote` snapshot from a path, raw YAML, or an already-parsed file.
 *
 * Node-only because of the path branch; the parsing itself is in `snapshot-view.ts`, which is
 * browser-safe. No Python and no kernel are involved either way — a snapshot is just a file with
 * the outputs stored inline.
 */
export function readSnapshot(input: DeepnoteFile | string): SnapshotView {
  if (typeof input !== 'string') {
    return toSnapshotView(input)
  }

  // Same rule as `loadDeepnoteFile`: a single-line string that exists on disk is a path.
  if (!input.includes('\n') && existsSync(input)) {
    return parseSnapshot(readFileSync(input, 'utf8'))
  }

  return parseSnapshot(input)
}
