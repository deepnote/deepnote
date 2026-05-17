import fs from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile, isExecutableBlockType } from '@deepnote/blocks'
import { stripOutputsFromBlock } from './split'

/**
 * Thrown when the resolver cannot compose the requested init notebook for a
 * file that declares `project.initNotebookId`. CLI callers should treat this
 * as a user-input error (exit code 2): the file references an init notebook
 * that does not exist locally and cannot be located in any sibling
 * `.deepnote` file.
 *
 * `kind: 'missing'` is thrown when no candidate sibling matches.
 * `kind: 'multiple'` is thrown when more than one candidate matches.
 */
export class MissingInitNotebookError extends Error {
  readonly kind: 'missing' | 'multiple'
  /** The init notebook id that could not be resolved. */
  readonly initNotebookId: string
  /** The path of the file that referenced the missing init notebook. */
  readonly filePath: string
  /** The directory that was searched for sibling init files. */
  readonly searchedDirectory: string
  /** Paths of candidate siblings that matched (only populated when `kind === 'multiple'`). */
  readonly candidatePaths: readonly string[]

  constructor(args: {
    message: string
    kind: 'missing' | 'multiple'
    initNotebookId: string
    filePath: string
    searchedDirectory: string
    candidatePaths?: readonly string[]
  }) {
    super(args.message)
    this.name = 'MissingInitNotebookError'
    this.kind = args.kind
    this.initNotebookId = args.initNotebookId
    this.filePath = args.filePath
    this.searchedDirectory = args.searchedDirectory
    this.candidatePaths = args.candidatePaths ?? []
  }
}

/**
 * The result of attempting to resolve and compose a sibling init notebook into the
 * loaded {@link DeepnoteFile}.
 */
export interface ResolveAndComposeInitResult {
  /**
   * The (possibly composed) DeepnoteFile to use for execution.
   *
   * - When the input file already contained the init notebook (self-contained),
   *   this is the input file unchanged.
   * - When a sibling init file matched, this is a new file whose
   *   `project.notebooks` array has the init notebook prepended in front of the
   *   original file's notebooks. Borrowed init blocks are stripped of stale
   *   `outputs`/`executionCount`/`executionStartedAt`/`executionFinishedAt` so
   *   the in-memory composed file behaves like a freshly-loaded source file.
   * - When `initNotebookId` is unset, this is the input file unchanged.
   */
  composed: DeepnoteFile
  /**
   * The set of executable block ids that came from the init notebook.
   *
   * Empty when no init notebook was composed (either self-contained or absent
   * because the file declares no `initNotebookId`).
   *
   * Callers use a non-empty set as the "prelude active" marker: when a user
   * applies a `--notebook` or `--block` filter, init must still run first, so
   * downstream layers must expand their notebook scope to include the init
   * notebook and prepend these block ids to any resolved upstream block list.
   *
   * Typed as `ReadonlySet` so consumers cannot accidentally mutate the
   * resolver result.
   */
  initBlockIds: ReadonlySet<string>
  /**
   * Id of the composed init notebook (when one was composed). Callers should
   * prefer this over `initNotebookName` when threading prelude scope into the
   * execution engine, because notebook names are not unique in the schema.
   */
  initNotebookId?: string
  /**
   * Name of the composed init notebook (kept for diagnostics / logs / dry-run
   * plan output). Use {@link initNotebookId} for engine filtering.
   */
  initNotebookName?: string
  /**
   * Non-fatal advisory messages produced while resolving (e.g. metadata
   * divergence between main and sibling, ignored corrupt sibling YAML).
   * Callers should surface these to users (CLI logs / MCP response payload).
   */
  warnings: string[]
}

/**
 * A description of a sibling `.deepnote` candidate that was inspected but not
 * accepted as the init source.
 */
interface RejectedCandidate {
  path: string
  reason: string
}

/**
 * Resolves the init notebook for a parsed `DeepnoteFile`. When the file already
 * contains its init notebook, returns the file unchanged. When the file's
 * `project.initNotebookId` points to a notebook that lives in a sibling
 * `.deepnote` file, composes a new in-memory `DeepnoteFile` whose notebooks are
 * `[init, ...mainNotebooks]` and reports the init's executable block ids as a
 * prelude marker.
 *
 * Discovery rules:
 * - Only files in the same directory as `filePath` with extension `.deepnote`
 *   are considered.
 * - A candidate matches when (a) `project.id` equals the executed file's
 *   `project.id`, (b) the candidate has exactly one notebook, and (c) that
 *   single notebook's id equals the executed file's `initNotebookId`. Rule (b)
 *   excludes the original unsplit source file (which still has init plus the
 *   other notebooks).
 * - Candidates whose YAML fails to parse are recorded as rejected and skipped,
 *   not fatal.
 *
 * Outcomes:
 * - **Self-contained**: returns the file as-is, `initBlockIds` empty.
 * - **Composed**: exactly one matching sibling. Top-level project metadata
 *   (`settings`, `integrations`, `environment`, `name`, `id`, `initNotebookId`)
 *   is taken from the main file; only the init notebook's blocks are borrowed.
 *   When the sibling and main file disagree on `integrations` or `settings`,
 *   `warnings` carries an advisory message.
 * - **Fail closed**: `initNotebookId` is set, file lacks that notebook, and no
 *   sibling provides it. Throws a clear error naming the missing init id, the
 *   directory searched, and rejected candidates.
 * - **Multiple matches**: throws with candidate paths listed.
 *
 * @param file - The parsed DeepnoteFile to resolve init for.
 * @param filePath - The absolute on-disk path of the file (used to find siblings).
 */
export async function resolveAndComposeInit(
  file: DeepnoteFile,
  filePath: string
): Promise<ResolveAndComposeInitResult> {
  const initNotebookId = file.project.initNotebookId
  const warnings: string[] = []

  // Files without an init reference are returned as-is.
  if (initNotebookId === undefined) {
    return { composed: file, initBlockIds: new Set(), warnings }
  }

  // If the file already contains its init notebook, no sibling lookup is needed.
  const localInit = file.project.notebooks.find(nb => nb.id === initNotebookId)
  if (localInit !== undefined) {
    return { composed: file, initBlockIds: new Set(), warnings }
  }

  const directory = dirname(filePath)
  const ownBasename = basename(filePath)

  let entries: string[]
  try {
    entries = await fs.readdir(directory)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Cannot resolve init notebook for ${filePath}: failed to read directory ${directory}.\n` +
        `initNotebookId: ${initNotebookId}\n` +
        `Error: ${message}`
    )
  }

  const matches: Array<{ path: string; file: DeepnoteFile }> = []
  const rejected: RejectedCandidate[] = []

  for (const entry of entries) {
    if (entry === ownBasename) continue
    if (!entry.toLowerCase().endsWith('.deepnote')) continue

    const candidatePath = resolve(directory, entry)

    let candidate: DeepnoteFile
    try {
      const rawBytes = await fs.readFile(candidatePath)
      const content = decodeUtf8NoBom(rawBytes)
      candidate = deserializeDeepnoteFile(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      rejected.push({ path: candidatePath, reason: `failed to parse: ${message}` })
      continue
    }

    if (candidate.project.id !== file.project.id) {
      rejected.push({
        path: candidatePath,
        reason: `project.id mismatch (expected ${file.project.id}, got ${candidate.project.id})`,
      })
      continue
    }

    const candidateNotebooks = candidate.project.notebooks
    if (candidateNotebooks.length !== 1) {
      rejected.push({
        path: candidatePath,
        reason: `expected exactly 1 notebook, found ${candidateNotebooks.length}`,
      })
      continue
    }

    const onlyNotebook = candidateNotebooks[0]
    if (onlyNotebook.id !== initNotebookId) {
      rejected.push({
        path: candidatePath,
        reason: `single notebook id ${onlyNotebook.id} does not match initNotebookId ${initNotebookId}`,
      })
      continue
    }

    matches.push({ path: candidatePath, file: candidate })
  }

  if (matches.length === 0) {
    const rejectedDescription =
      rejected.length > 0
        ? `\nRejected candidates:\n${rejected.map(r => `  - ${r.path}: ${r.reason}`).join('\n')}`
        : '\nNo other .deepnote files were present.'
    const localIds = file.project.notebooks.map(nb => nb.id)
    const localDescription =
      localIds.length > 0 ? `\nLocal notebook ids: [${localIds.join(', ')}]` : '\nLocal notebook ids: (none)'
    throw new MissingInitNotebookError({
      message:
        `Cannot resolve init notebook for ${filePath}.\n` +
        `Missing init notebook id: ${initNotebookId}\n` +
        `Searched directory: ${directory}` +
        localDescription +
        rejectedDescription,
      kind: 'missing',
      initNotebookId,
      filePath,
      searchedDirectory: directory,
    })
  }

  if (matches.length > 1) {
    const matchList = matches.map(m => `  - ${m.path}`).join('\n')
    throw new MissingInitNotebookError({
      message:
        `Cannot resolve init notebook for ${filePath}: multiple matching sibling init files found.\n` +
        `initNotebookId: ${initNotebookId}\n` +
        `Candidates:\n${matchList}`,
      kind: 'multiple',
      initNotebookId,
      filePath,
      searchedDirectory: directory,
      candidatePaths: matches.map(m => m.path),
    })
  }

  const initFile = matches[0].file
  const siblingInitNotebook = initFile.project.notebooks[0]

  // Strip stale execution state from borrowed init blocks: the sibling on
  // disk may carry outputs/executionCount/executionStarted-/FinishedAt from a
  // previous run. We don't want those leaking into the composed in-memory
  // file (so dry-run plans, --list-inputs, and validation see clean source).
  // Engine execution will overwrite outputs anyway, but the user-facing
  // intermediate states must show source-only data.
  const initNotebook = {
    ...siblingInitNotebook,
    blocks: siblingInitNotebook.blocks.map(stripOutputsFromBlock),
  }

  // Compose: take all top-level metadata from the main file; borrow only the
  // init notebook (with its blocks) from the sibling file.
  const composed: DeepnoteFile = {
    ...file,
    project: {
      ...file.project,
      notebooks: [initNotebook, ...file.project.notebooks],
    },
  }

  // Record advisory warnings for metadata divergence. We proceed using the main
  // file's metadata regardless.
  const integrationsDifferent = !areIntegrationsEqual(file.project.integrations, initFile.project.integrations)
  if (integrationsDifferent) {
    warnings.push(
      `Init sibling ${matches[0].path} has different integrations than the main file ${filePath}; using the main file's integrations.`
    )
  }

  const settingsDifferent = !areSettingsEqual(file.project.settings, initFile.project.settings)
  if (settingsDifferent) {
    warnings.push(
      `Init sibling ${matches[0].path} has different settings than the main file ${filePath}; using the main file's settings.`
    )
  }

  const initBlockIds = new Set<string>()
  for (const block of initNotebook.blocks) {
    if (isExecutableBlockType(block.type)) {
      initBlockIds.add(block.id)
    }
  }

  return {
    composed,
    initBlockIds,
    initNotebookId: initNotebook.id,
    initNotebookName: initNotebook.name,
    warnings,
  }
}

/**
 * Compare two integrations arrays for shallow structural equality (id/name/type).
 * Order-insensitive.
 */
function areIntegrationsEqual(
  a: ReadonlyArray<{ id: string; name?: string; type?: string }> | undefined,
  b: ReadonlyArray<{ id: string; name?: string; type?: string }> | undefined
): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return (a?.length ?? 0) === (b?.length ?? 0)
  if (a.length !== b.length) return false

  const sortById = <T extends { id: string }>(arr: ReadonlyArray<T>): ReadonlyArray<T> =>
    [...arr].sort((x, y) => x.id.localeCompare(y.id))

  const aSorted = sortById(a)
  const bSorted = sortById(b)
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i].id !== bSorted[i].id) return false
    if ((aSorted[i].name ?? '') !== (bSorted[i].name ?? '')) return false
    if ((aSorted[i].type ?? '') !== (bSorted[i].type ?? '')) return false
  }
  return true
}

/**
 * Compare two settings objects for structural equality via JSON serialization.
 * Treats `undefined` and `{}` as equivalent.
 */
function areSettingsEqual(a: unknown, b: unknown): boolean {
  const norm = (value: unknown): string => {
    if (value === undefined || value === null) return 'null'
    return JSON.stringify(value, sortedKeysReplacer)
  }
  return norm(a) === norm(b)
}

function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const sortedKeys = Object.keys(value).sort()
  const result: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    result[k] = (value as Record<string, unknown>)[k]
  }
  return result
}
