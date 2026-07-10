import { existsSync, readFileSync } from 'node:fs'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'

/** A runner input: a filesystem path, raw `.deepnote` YAML, or a parsed DeepnoteFile. */
export type DeepnoteInput = DeepnoteFile | string

export interface LoadedDeepnoteFile {
  /** A fresh, mutable DeepnoteFile — safe to apply input overrides to without affecting the caller. */
  file: DeepnoteFile
  /** Present only when the input was a filesystem path; required to persist a snapshot next to the source. */
  sourcePath?: string
}

/**
 * Normalize a runner input into a mutable {@link DeepnoteFile}.
 *
 * A string with no newline that exists on disk is treated as a path; any other string is
 * treated as `.deepnote` YAML; an object is deep-cloned so the caller's file is never mutated.
 * Only `.deepnote` content is supported (`.ipynb`/`.py`/`.qmd` conversion is future work).
 */
export function loadDeepnoteFile(input: DeepnoteInput): LoadedDeepnoteFile {
  if (typeof input === 'string') {
    if (!input.includes('\n') && existsSync(input)) {
      return { file: deserializeDeepnoteFile(readFileSync(input, 'utf8')), sourcePath: input }
    }
    return { file: deserializeDeepnoteFile(input) }
  }
  return { file: structuredClone(input) }
}
