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

/** Neutralizes path traversal from untrusted ids interpolated into snapshot filenames. */
function sanitizeFilenameComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Characters kept verbatim inside an encoded notebook id; every other character is percent-escaped. */
const FILENAME_SAFE_NOTEBOOK_ID_CHAR = /[A-Za-z0-9_-]/
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Reversibly encodes a notebook id into a path-safe filename: `[A-Za-z0-9_-]` stay verbatim, other chars
 * become uppercase `%XX` UTF-8 escapes. Lossless one-to-one mapping; inverse: {@link decodeNotebookIdFromFilename}.
 */
export function encodeNotebookIdForFilename(notebookId: string): string {
  let encoded = ''
  for (const char of notebookId) {
    if (FILENAME_SAFE_NOTEBOOK_ID_CHAR.test(char)) {
      encoded += char
      continue
    }
    for (const byte of utf8Encoder.encode(char)) {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return encoded
}

/** Recovers the original notebook id from a component produced by {@link encodeNotebookIdForFilename}. */
export function decodeNotebookIdFromFilename(encoded: string): string {
  const bytes: number[] = []
  let i = 0
  while (i < encoded.length) {
    const hex = encoded.slice(i + 1, i + 3)
    if (encoded[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      i += 3
    } else {
      bytes.push(encoded.charCodeAt(i))
      i += 1
    }
  }
  return utf8Decoder.decode(new Uint8Array(bytes))
}

/**
 * Generates a snapshot filename from project info.
 *
 * @param params.slug - The project name slug
 * @param params.projectId - The project UUID
 * @param params.notebookId - Optional notebook id; reversibly encoded to scope the filename to a single notebook
 * @param params.timestamp - Timestamp string or 'latest'
 * @returns Filename in format '{slug}_{projectId}[_{notebookId}]_{timestamp}.snapshot.deepnote'
 */
export function generateSnapshotFilename(params: GenerateSnapshotFilenameParams): string {
  const { slug, projectId, notebookId, timestamp = 'latest' } = params
  const safeSlug = sanitizeFilenameComponent(slug)
  const safeProjectId = sanitizeFilenameComponent(projectId)
  // Valid timestamps ('latest' or '2025-01-08T10-30-00') only contain [A-Za-z0-9_-] and pass through
  // unchanged; sanitizing purely neutralizes traversal from untrusted/garbage input.
  const safeTimestamp = sanitizeFilenameComponent(timestamp)
  if (notebookId) {
    return `${safeSlug}_${safeProjectId}_${encodeNotebookIdForFilename(notebookId)}_${safeTimestamp}.snapshot.deepnote`
  }
  return `${safeSlug}_${safeProjectId}_${safeTimestamp}.snapshot.deepnote`
}

/**
 * Removes output-related fields from a block, returning a clean source block.
 */
/** Strips execution outputs from every block in an array. */
export function stripOutputsFromBlocks(blocks: ReadonlyArray<DeepnoteBlock>): DeepnoteBlock[] {
  return blocks.map(stripOutputsFromBlock)
}

export function stripOutputsFromBlock(block: DeepnoteBlock): DeepnoteBlock {
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

/** Splits a multi-notebook DeepnoteFile into one file per notebook, emitting the init notebook (if any) as a standalone entry first. */
export function splitByNotebooks(file: DeepnoteFile, sourceFileStem: string): NotebookSplitEntry[] {
  const notebooks = file.project.notebooks
  if (notebooks.length === 0) {
    return []
  }

  const initNotebookId = file.project.initNotebookId
  const initNotebook = initNotebookId === undefined ? undefined : notebooks.find(nb => nb.id === initNotebookId)

  // A file containing only the init notebook is already in single-notebook form.
  if (initNotebook !== undefined && notebooks.length === 1) {
    return []
  }

  const used = new Set<string>()
  const result: NotebookSplitEntry[] = []

  if (initNotebook !== undefined) {
    const initFilename = allocateUniqueNotebookSplitFilename(sourceFileStem, initNotebook.name, used)
    result.push({
      notebook: { id: initNotebook.id, name: initNotebook.name },
      file: {
        ...file,
        project: {
          ...file.project,
          notebooks: [initNotebook],
        },
      },
      outputFilename: initFilename,
    })
  }

  const mainNotebooks = initNotebook === undefined ? notebooks : notebooks.filter(nb => nb.id !== initNotebook.id)
  if (mainNotebooks.length === 0) {
    // A standalone init entry alone is not useful.
    return []
  }

  // Drop an initNotebookId matching no notebook here; left dangling it would make `deepnote run` fail sibling-init resolution.
  const hasDanglingInit = initNotebookId !== undefined && initNotebook === undefined

  for (const notebook of mainNotebooks) {
    const outputFilename = allocateUniqueNotebookSplitFilename(sourceFileStem, notebook.name, used)
    const project = { ...file.project, notebooks: [notebook] }
    if (hasDanglingInit) {
      delete project.initNotebookId
    }
    result.push({
      notebook: { id: notebook.id, name: notebook.name },
      file: { ...file, project },
      outputFilename,
    })
  }

  return result
}
