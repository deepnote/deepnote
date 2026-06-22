import fs from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { LoadedRunnableFile } from '../load-runnable-file'
import { stripOutputsFromBlock } from './split'

type DeepnoteNotebook = DeepnoteFile['project']['notebooks'][number]

/** Result of validating a sibling `.deepnote` file as an init notebook source. */
export type SiblingInitCandidateValidation = { valid: true } | { valid: false; reason: string }

/**
 * Validates whether a parsed sibling `.deepnote` file is a valid init notebook source.
 *
 * A valid candidate shares `project.id`, contains exactly one notebook, and that notebook's
 * id matches `initNotebookId`.
 */
export function isValidSiblingInitCandidate(
  candidate: DeepnoteFile,
  expectedProjectId: string,
  initNotebookId: string
): SiblingInitCandidateValidation {
  if (candidate.project.id !== expectedProjectId) {
    return {
      valid: false,
      reason: `project.id mismatch (expected ${expectedProjectId}, got ${candidate.project.id})`,
    }
  }

  const candidateNotebooks = candidate.project.notebooks
  if (candidateNotebooks.length !== 1) {
    return {
      valid: false,
      reason: `expected exactly 1 notebook, found ${candidateNotebooks.length}`,
    }
  }

  const onlyNotebook = candidateNotebooks[0]
  if (onlyNotebook.id !== initNotebookId) {
    return {
      valid: false,
      reason: `single notebook id ${onlyNotebook.id} does not match initNotebookId ${initNotebookId}`,
    }
  }

  return { valid: true }
}

/**
 * Composes a main `.deepnote` file with a borrowed init notebook as `[init, ...mainNotebooks]`.
 *
 * Strips stale execution state from init blocks before composition.
 */
export function composeDeepnoteWithInitNotebook(main: DeepnoteFile, initNotebook: DeepnoteNotebook): DeepnoteFile {
  const cleanedInit: DeepnoteNotebook = {
    ...initNotebook,
    blocks: initNotebook.blocks.map(stripOutputsFromBlock),
  }

  return {
    ...main,
    project: {
      ...main.project,
      notebooks: [cleanedInit, ...main.project.notebooks],
    },
  }
}

/** Thrown when a file's `project.initNotebookId` cannot be resolved locally or in a sibling `.deepnote` (CLI exit code 2). */
export class InitNotebookResolutionError extends Error {
  readonly kind: 'missing' | 'multiple'

  constructor(args: { message: string; kind: 'missing' | 'multiple' }) {
    super(args.message)
    this.name = 'InitNotebookResolutionError'
    this.kind = args.kind
  }
}

/** Result of resolving and composing a sibling init notebook into the loaded {@link DeepnoteFile}. */
export interface ResolveAndComposeInitResult extends LoadedRunnableFile {
  warnings: string[]
}

/**
 * Guarded wrapper over {@link resolveAndComposeInit} for an already-loaded runnable file.
 *
 * Only the source format gates this helper: native `'deepnote'` files are handed to
 * {@link resolveAndComposeInit}, which then looks for the init notebook — returning the file
 * unchanged when there is no `project.initNotebookId` to resolve (or it resolves locally), and
 * composing a sibling `.deepnote` init notebook when there is. Every other format passes through
 * unchanged. Centralizes the "when do we attempt sibling-init resolution for a loaded runnable
 * file" decision shared by the CLI and MCP run paths.
 *
 * The load step stays at the call site (CLI and MCP load differently); this helper takes the
 * already-loaded file. It RETURNS warnings rather than logging, so each caller keeps its own
 * warning handling.
 *
 * @throws InitNotebookResolutionError when a declared init id cannot be resolved locally or in
 *         exactly one sibling (propagated from {@link resolveAndComposeInit}).
 */
export async function resolveAndComposeInitIfNeeded(loaded: LoadedRunnableFile): Promise<ResolveAndComposeInitResult> {
  if (loaded.format !== 'deepnote') {
    return { ...loaded, warnings: [] }
  }
  return resolveAndComposeInit(loaded)
}

/** A sibling `.deepnote` candidate that was inspected but rejected as the init source. */
interface RejectedCandidate {
  path: string
  reason: string
}

/** Resolves the init notebook for a `DeepnoteFile`, composing `[init, ...notebooks]` from a sibling `.deepnote` when not self-contained, else failing closed. */
export async function resolveAndComposeInit(loaded: LoadedRunnableFile): Promise<ResolveAndComposeInitResult> {
  const filePath = loaded.originalPath
  const initNotebookId = loaded.file.project.initNotebookId
  const warnings: string[] = []

  if (initNotebookId === undefined) {
    return { ...loaded, warnings }
  }

  const localInit = loaded.file.project.notebooks.find(nb => nb.id === initNotebookId)
  if (localInit !== undefined) {
    return { ...loaded, warnings }
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

    const validation = isValidSiblingInitCandidate(candidate, loaded.file.project.id, initNotebookId)
    if (!validation.valid) {
      rejected.push({ path: candidatePath, reason: validation.reason })
      continue
    }

    matches.push({ path: candidatePath, file: candidate })
  }

  if (matches.length === 0) {
    const rejectedDescription =
      rejected.length > 0
        ? `\nRejected candidates:\n${rejected.map(r => `  - ${r.path}: ${r.reason}`).join('\n')}`
        : '\nNo other .deepnote files were present.'
    const localIds = loaded.file.project.notebooks.map(nb => nb.id)
    const localDescription =
      localIds.length > 0 ? `\nLocal notebook ids: [${localIds.join(', ')}]` : '\nLocal notebook ids: (none)'
    throw new InitNotebookResolutionError({
      message:
        `Cannot resolve init notebook for ${filePath}.\n` +
        `Missing init notebook id: ${initNotebookId}\n` +
        `Searched directory: ${directory}` +
        localDescription +
        rejectedDescription,
      kind: 'missing',
    })
  }

  if (matches.length > 1) {
    const matchList = matches.map(m => `  - ${m.path}`).join('\n')
    throw new InitNotebookResolutionError({
      message:
        `Cannot resolve init notebook for ${filePath}: multiple matching sibling init files found.\n` +
        `initNotebookId: ${initNotebookId}\n` +
        `Candidates:\n${matchList}`,
      kind: 'multiple',
    })
  }

  const initFile = matches[0].file
  const composed = composeDeepnoteWithInitNotebook(loaded.file, initFile.project.notebooks[0])

  // Advisory only; we proceed with the main file's metadata regardless of divergence.
  const integrationsDifferent = !areIntegrationsEqual(loaded.file.project.integrations, initFile.project.integrations)
  if (integrationsDifferent) {
    warnings.push(
      `Init sibling ${matches[0].path} has different integrations than the main file ${filePath}; using the main file's integrations.`
    )
  }

  const settingsDifferent = !areSettingsEqual(loaded.file.project.settings, initFile.project.settings)
  if (settingsDifferent) {
    warnings.push(
      `Init sibling ${matches[0].path} has different settings than the main file ${filePath}; using the main file's settings.`
    )
  }

  return {
    ...loaded,
    file: composed,
    warnings,
  }
}

/** Order-insensitive shallow structural equality of two integrations arrays (id/name/type). */
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

/** Structural equality of two settings objects via key-sorted JSON; treats `undefined`/`null` as equivalent. */
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
