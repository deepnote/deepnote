import type { DeepnoteBlock, DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { isExecutableBlockType } from '@deepnote/blocks'
import { addContentHashes, computeSnapshotHash } from './hash'
import type { NotebookSplitEntry, SplitResult } from './types'

/**
 * Creates a slug from a project name.
 * Normalizes accented characters to ASCII equivalents (e.g., é → e),
 * converts to lowercase, replaces spaces and special chars with hyphens,
 * removes consecutive hyphens, and trims leading/trailing hyphens.
 *
 * @param name - The project name to slugify
 * @returns A URL-safe slug
 */
export function slugifyProjectName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Arguments for {@link generateSnapshotFilename}. */
export interface GenerateSnapshotFilenameParams {
  slug: string
  projectId: string
  notebookId?: string
  timestamp?: string
}

/**
 * Generates a snapshot filename from project info.
 *
 * @param params - Slug, project id, and optional notebook id and timestamp (defaults timestamp to `'latest'`)
 * @returns Filename in format '{slug}_{projectId}_{timestamp}.snapshot.deepnote'
 */
export function generateSnapshotFilename(params: GenerateSnapshotFilenameParams): string {
  const { slug, projectId, notebookId, timestamp = 'latest' } = params
  if (notebookId) {
    return `${slug}_${projectId}_${notebookId}_${timestamp}.snapshot.deepnote`
  }
  return `${slug}_${projectId}_${timestamp}.snapshot.deepnote`
}

/**
 * Removes output-related fields from a block, returning a clean source block.
 */
function stripOutputsFromBlock(block: DeepnoteBlock): DeepnoteBlock {
  if (!isExecutableBlockType(block.type)) {
    return block
  }

  // Create a copy without output fields (underscore prefix suppresses unused warnings)
  const {
    executionCount: _executionCount,
    executionStartedAt: _executionStartedAt,
    executionFinishedAt: _executionFinishedAt,
    outputs: _outputs,
    ...rest
  } = block as DeepnoteBlock & {
    executionCount?: number | null
    executionStartedAt?: string
    executionFinishedAt?: string
    outputs?: unknown[]
  }

  return rest as DeepnoteBlock
}

/**
 * Splits a DeepnoteFile into a source file (no outputs) and a snapshot file (outputs only).
 *
 * @param file - The complete DeepnoteFile with outputs
 * @returns Object containing source and snapshot files
 */
export function splitDeepnoteFile(file: DeepnoteFile): SplitResult {
  // First ensure all blocks have content hashes (returns new file, doesn't mutate)
  const fileWithHashes = addContentHashes(file)

  // Compute snapshot hash before stripping outputs
  const snapshotHash = computeSnapshotHash(fileWithHashes)

  // Create source file with outputs stripped (exclude snapshotHash from source)
  const { snapshotHash: _snapshotHash, ...sourceMetadata } = (fileWithHashes.metadata ?? {}) as NonNullable<
    typeof fileWithHashes.metadata
  > & {
    snapshotHash?: string
  }
  const source: DeepnoteFile = {
    ...fileWithHashes,
    metadata: sourceMetadata,
    project: {
      ...fileWithHashes.project,
      notebooks: fileWithHashes.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map(stripOutputsFromBlock),
      })),
    },
  }

  // Create snapshot file with all data plus snapshot metadata
  const snapshot: DeepnoteSnapshot = {
    ...fileWithHashes,
    environment: fileWithHashes.environment ?? {},
    execution: fileWithHashes.execution ?? {},
    metadata: {
      ...fileWithHashes.metadata,
      snapshotHash,
    },
  }

  return { source, snapshot }
}

/**
 * Checks if a DeepnoteFile has any outputs.
 *
 * @param file - The DeepnoteFile to check
 * @returns True if any block has outputs
 */
export function hasOutputs(file: DeepnoteFile): boolean {
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!isExecutableBlockType(block.type)) {
        continue
      }
      const execBlock = block as DeepnoteBlock & { outputs?: unknown[] }
      if (execBlock.outputs && execBlock.outputs.length > 0) {
        return true
      }
    }
  }
  return false
}

const SPLIT_DEEPNOTE_EXT = '.deepnote'

/**
 * Picks a unique split output basename: `{stem}-{slug}.deepnote`, then `{stem}-{slug}-2.deepnote`, etc.
 */
function allocateUniqueNotebookSplitFilename(sourceFileStem: string, notebookName: string, used: Set<string>): string {
  const slug = slugifyProjectName(notebookName)
  const pathStem = `${sourceFileStem}-${slug}`
  const filenameForSuffix = (suffixNum: number): string =>
    suffixNum <= 1 ? `${pathStem}${SPLIT_DEEPNOTE_EXT}` : `${pathStem}-${suffixNum}${SPLIT_DEEPNOTE_EXT}`

  let candidate = filenameForSuffix(1)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  const maxSuffix = 10_000
  for (let n = 2; n <= maxSuffix; n += 1) {
    candidate = filenameForSuffix(n)
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new Error(
    `Could not allocate a unique split filename for "${pathStem}${SPLIT_DEEPNOTE_EXT}" after ${maxSuffix} attempts.`
  )
}

/**
 * Splits a multi-notebook DeepnoteFile into separate files, one per user-facing notebook.
 * When {@link DeepnoteFile.project.initNotebookId} resolves to a notebook in the project,
 * that init notebook is excluded from the splittable set and prepended to every split so
 * `initNotebookId` remains valid. Each {@link NotebookSplitEntry.notebook} still identifies
 * the non-init notebook the entry is built around. Assigns a unique
 * {@link NotebookSplitEntry.outputFilename} per entry (numeric suffix before `.deepnote` when slug collisions occur).
 *
 * @param file - The DeepnoteFile to split
 * @param sourceFileStem - Basename of the source file without the `.deepnote` extension
 */
export function splitByNotebooks(file: DeepnoteFile, sourceFileStem: string): NotebookSplitEntry[] {
  const notebooks = file.project.notebooks
  if (notebooks.length === 0) {
    return []
  }

  const initNotebookId = file.project.initNotebookId
  const initNotebook = initNotebookId === undefined ? undefined : notebooks.find(nb => nb.id === initNotebookId)

  const splittable = initNotebook === undefined ? notebooks : notebooks.filter(nb => nb.id !== initNotebook.id)

  if (splittable.length === 0) {
    return []
  }

  const used = new Set<string>()
  return splittable.map(notebook => {
    const outputFilename = allocateUniqueNotebookSplitFilename(sourceFileStem, notebook.name, used)
    const splitNotebooks = initNotebook === undefined ? [notebook] : [initNotebook, notebook]
    return {
      notebook: { id: notebook.id, name: notebook.name },
      file: {
        ...file,
        project: {
          ...file.project,
          notebooks: splitNotebooks,
        },
      },
      outputFilename,
    }
  })
}

/**
 * Splits a multi-notebook snapshot into separate per-notebook snapshots.
 *
 * @param snapshot - The snapshot to split
 * @param notebookIds - The notebook IDs to extract
 * @returns Map from notebookId to the per-notebook snapshot
 */
export function splitSnapshotByNotebooks(
  snapshot: DeepnoteSnapshot,
  notebookIds: string[]
): Map<string, DeepnoteSnapshot> {
  const result = new Map<string, DeepnoteSnapshot>()
  for (const nbId of notebookIds) {
    const notebook = snapshot.project.notebooks.find(nb => nb.id === nbId)
    if (notebook) {
      result.set(nbId, {
        ...snapshot,
        project: {
          ...snapshot.project,
          notebooks: [notebook],
        },
      })
    }
  }
  return result
}
