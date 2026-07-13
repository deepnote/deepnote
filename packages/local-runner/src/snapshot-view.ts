import type { DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { deepnoteFileSchema, deepnoteSnapshotSchema, isInputBlock, parseYaml } from '@deepnote/blocks'
import type { IOutput } from '@jupyterlab/nbformat'

/**
 * Reading a snapshot is pure parsing — no Python, no kernel, no filesystem. This module has no
 * Node dependencies so it also runs in a browser, which is what lets a static page render a
 * `.deepnote` snapshot on its own (see `snapshot-viewer.ts`).
 */

/** One block of a snapshot, with whatever outputs the run produced. */
export interface SnapshotBlock {
  id: string
  type: string
  /** The block's source: code, SQL, or markdown text. */
  content: string
  /** Jupyter outputs stored inline in the snapshot. Empty for blocks that produced none. */
  outputs: IOutput[]
  executionCount: number | null
  /**
   * For input blocks, the variable and the value this run used. A snapshot records the values the
   * run actually executed with, so a reader can see what produced these outputs.
   */
  input?: { name: string; value: unknown }
}

export interface SnapshotNotebook {
  id: string
  name: string
  /** Blocks in document order. */
  blocks: SnapshotBlock[]
}

/** A snapshot flattened into just what a viewer needs. */
export interface SnapshotView {
  projectName: string
  notebooks: SnapshotNotebook[]
  /** When the run finished, if the snapshot recorded it. */
  finishedAt?: string
}

/**
 * Parse `.deepnote` snapshot YAML into a {@link SnapshotView}.
 *
 * Accepts a snapshot or a plain `.deepnote` file — a snapshot is a file plus required `execution`
 * and `environment`, so a file with inline outputs renders too.
 *
 * @throws {Error} if the content is not YAML, or not a Deepnote file at all.
 */
export function parseSnapshot(yaml: string): SnapshotView {
  let parsed: unknown
  try {
    parsed = parseYaml(yaml)
  } catch (err) {
    throw new Error(`Not a valid .deepnote snapshot: ${err instanceof Error ? err.message : String(err)}`)
  }

  const asSnapshot = deepnoteSnapshotSchema.safeParse(parsed)
  if (asSnapshot.success) {
    return toSnapshotView(asSnapshot.data)
  }

  const asFile = deepnoteFileSchema.safeParse(parsed)
  if (asFile.success) {
    return toSnapshotView(asFile.data)
  }

  throw new Error('Not a valid .deepnote snapshot: the file does not match the Deepnote schema.')
}

/** Flatten an already-parsed file or snapshot into a {@link SnapshotView}. */
export function toSnapshotView(file: DeepnoteFile | DeepnoteSnapshot): SnapshotView {
  const notebooks = file.project.notebooks.map(notebook => ({
    id: notebook.id,
    name: notebook.name,
    blocks: [...notebook.blocks].sort(bySortingKey).map(toSnapshotBlock),
  }))

  return {
    projectName: file.project.name,
    notebooks,
    finishedAt: (file as Partial<DeepnoteSnapshot>).execution?.finishedAt,
  }
}

function toSnapshotBlock(block: DeepnoteFile['project']['notebooks'][number]['blocks'][number]): SnapshotBlock {
  // Any executable block can carry outputs — code, sql, visualization, big-number, inputs — so read
  // them off whatever block has them rather than special-casing `code`.
  const withOutputs = block as { outputs?: IOutput[]; executionCount?: number | null; content?: string }
  const snapshotBlock: SnapshotBlock = {
    id: block.id,
    type: block.type,
    content: withOutputs.content ?? '',
    outputs: withOutputs.outputs ?? [],
    executionCount: withOutputs.executionCount ?? null,
  }

  if (isInputBlock(block)) {
    snapshotBlock.input = {
      name: block.metadata.deepnote_variable_name,
      value: block.metadata.deepnote_variable_value,
    }
  }

  return snapshotBlock
}

function bySortingKey(
  a: DeepnoteFile['project']['notebooks'][number]['blocks'][number],
  b: DeepnoteFile['project']['notebooks'][number]['blocks'][number]
): number {
  return String(a.sortingKey ?? '').localeCompare(String(b.sortingKey ?? ''))
}
