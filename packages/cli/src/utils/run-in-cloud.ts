import fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  type DeepnoteFile,
  type DeepnoteSnapshot,
  deepnoteFileSchema,
  deepnoteSnapshotSchema,
  deserializeDeepnoteFile,
  type InputBlockValueOverrides,
  parseYaml,
  serializeDeepnoteSnapshot,
} from '@deepnote/blocks'
import {
  describeRunError,
  fetchSnapshotContent,
  getRun,
  isSuccessStatus,
  type NormalizedRun,
  pollRunUntilComplete,
  type TriggerRunBody,
  triggerNotebookRun,
} from '@deepnote/cloud'
import { getSnapshotDir, getSnapshotPath, resolveSnapshotNotebookId, splitDeepnoteFile } from '@deepnote/convert'
import { DEFAULT_API_URL, DEFAULT_ENV_FILE } from '@deepnote/database-integrations'
import dotenv from 'dotenv'
import ora from 'ora'
import type { RunOptions } from '../commands/run'
import { DEEPNOTE_TOKEN_ENV } from '../constants'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, getOutputConfig, log, outputJson, outputToon } from '../output'
import { MissingTokenError } from './auth'
import { resolvePathToDeepnoteFile } from './file-resolver'
import { parseInputs } from './parse-inputs'

/**
 * Options consumed by the cloud run path — the `run` command's options, since `--cloud` is a flag
 * on `run`. This is a type-only import, so it is erased at compile time and adds no runtime
 * dependency on `run.ts` (which imports this module).
 */
export type RunCloudOptions = RunOptions

/** Machine-readable result of a cloud run (shape shared by `-o json` and `-o toon`). */
export interface CloudRunResult {
  success: boolean
  runId: string
  status: string
  snapshotPath?: string
  timestampedSnapshotPath?: string
  error?: string
}

/**
 * User error specific to the cloud run path (bad flag combination, ambiguous notebook, etc.).
 * `createRunAction` maps this to {@link ExitCode.InvalidUsage} (2).
 */
export class CloudRunUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudRunUsageError'
  }
}

/** Local-only flags that make no sense against a cloud run; each rejected with a usage error. */
const INCOMPATIBLE_FLAGS: ReadonlyArray<readonly [keyof RunCloudOptions, string]> = [
  ['python', '--python'],
  ['cwd', '--cwd'],
  ['top', '--top'],
  ['profile', '--profile'],
  ['open', '--open'],
  ['prompt', '--prompt'],
  ['dryRun', '--dry-run'],
  ['listInputs', '--list-inputs'],
  ['context', '--context'],
]

function assertNoIncompatibleFlags(options: RunCloudOptions): void {
  const used = INCOMPATIBLE_FLAGS.filter(([key]) => options[key]).map(([, flag]) => flag)
  if (used.length > 0) {
    throw new CloudRunUsageError(
      `${used.join(', ')} ${used.length === 1 ? 'is' : 'are'} not supported with --cloud (local-only).`
    )
  }
}

/** Cloud-only flags that are meaningless on a local run; each rejected unless `--cloud` is set. */
const CLOUD_ONLY_FLAGS: ReadonlyArray<readonly [keyof RunCloudOptions, string]> = [
  ['notebookId', '--notebook-id'],
  ['out', '--out'],
  ['timeout', '--timeout'],
  ['push', '--push'],
]

/**
 * Rejects cloud-only flags when `--cloud` is absent so they fail loudly instead of being silently
 * ignored on a local run. Called from `createRunAction` before the local execution path.
 */
export function assertCloudOnlyFlagsRequireCloud(options: RunCloudOptions): void {
  if (options.cloud) {
    return
  }
  const used = CLOUD_ONLY_FLAGS.filter(([key]) => options[key] !== undefined).map(([, flag]) => flag)
  if (used.length > 0) {
    throw new CloudRunUsageError(`${used.join(', ')} ${used.length === 1 ? 'requires' : 'require'} --cloud.`)
  }
}

function normalizeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resolves which remote notebook to run:
 * `--notebook-id` wins; else `--notebook <name>` must match exactly one notebook in the file;
 * else the file's single/main notebook; else an error asking the user to disambiguate.
 */
function resolveTargetNotebookId(options: RunCloudOptions, file: DeepnoteFile | undefined): string {
  if (options.notebookId) {
    return options.notebookId
  }
  if (!file) {
    throw new CloudRunUsageError('No notebook to run. Pass --notebook-id <uuid> or a .deepnote file.')
  }

  const notebooks = file.project.notebooks
  if (options.notebook) {
    const matches = notebooks.filter(notebook => notebook.name === options.notebook)
    if (matches.length === 0) {
      throw new CloudRunUsageError(`No notebook named "${options.notebook}" found in the file.`)
    }
    if (matches.length > 1) {
      throw new CloudRunUsageError(
        `Multiple notebooks named "${options.notebook}" found; pass --notebook-id <uuid> instead.`
      )
    }
    return matches[0].id
  }

  const resolved = resolveSnapshotNotebookId(file)
  if (resolved) {
    return resolved
  }
  throw new CloudRunUsageError(
    'This file has multiple notebooks. Specify which to run with --notebook "<name>" or --notebook-id <uuid>.'
  )
}

/**
 * Types `--input` values against the input blocks of the notebook that will run, using the same
 * parser as a local run — so `--input` means one thing, cloud or not.
 *
 * That typing needs the notebook's blocks, and the only copy we have is the local file. When the
 * target notebook isn't in it (`--notebook-id` for a remote notebook, with no local file), we
 * cannot tell a checkbox from a text input, and guessing is what produced the wrong value types
 * this parser exists to prevent — so we ask for the file instead of sending an unchecked payload.
 */
function parseCloudInputs(
  options: RunCloudOptions,
  file: DeepnoteFile | undefined,
  notebookId: string
): InputBlockValueOverrides {
  if (!options.input || options.input.length === 0) {
    return {}
  }

  const targetNotebook = file?.project.notebooks.find(notebook => notebook.id === notebookId)
  if (!file || !targetNotebook) {
    throw new CloudRunUsageError(
      "--input needs the notebook's .deepnote file to type each value against its input block. Pass the file (e.g. `deepnote run my-project.deepnote --cloud`) instead of only --notebook-id."
    )
  }

  return parseInputs(file, options.input, targetNotebook.name)
}

/**
 * Parses downloaded snapshot content into a {@link DeepnoteSnapshot}.
 * Accepts either a snapshot document or a full `.deepnote` file (split into a snapshot).
 * Returns `null` when the content is not recognizable (caller writes raw bytes instead).
 */
function parseSnapshotContent(content: string): DeepnoteSnapshot | null {
  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch {
    return null
  }

  const asSnapshot = deepnoteSnapshotSchema.safeParse(parsed)
  if (asSnapshot.success) {
    return asSnapshot.data
  }

  const asFile = deepnoteFileSchema.safeParse(parsed)
  if (asFile.success) {
    return splitDeepnoteFile(asFile.data).snapshot
  }

  return null
}

/** ISO timestamp → filename-safe segment, matching `saveExecutionSnapshot`'s convention. */
function toSnapshotTimestamp(finishedAt: string | undefined): string {
  const parsed = finishedAt ? new Date(finishedAt) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

interface WriteSnapshotArgs {
  content: string
  runId: string
  finishedAt?: string
  sourcePath?: string
  localFile?: DeepnoteFile
  out?: string
}

interface WrittenSnapshot {
  snapshotPath: string
  timestampedSnapshotPath?: string
}

/**
 * Writes the downloaded snapshot to disk.
 * - `--out`: writes a single file to that exact path.
 * - default: mirrors the local convention — a timestamped file plus a `latest` copy in a
 *   `snapshots/` directory (next to the source file, or in the cwd when running by id only).
 */
async function writeCloudSnapshot(args: WriteSnapshotArgs): Promise<WrittenSnapshot> {
  const snapshot = parseSnapshotContent(args.content)
  const bytes = snapshot ? serializeDeepnoteSnapshot(snapshot) : args.content

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out)
    await fs.mkdir(dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, bytes, 'utf-8')
    return { snapshotPath: outPath }
  }

  // A file to derive the project slug / id / notebook id from: the local file if we have one,
  // otherwise the downloaded snapshot itself (structurally a superset of DeepnoteFile).
  const namingFile: DeepnoteFile | undefined = args.localFile ?? (snapshot as DeepnoteFile | undefined)
  if (!namingFile) {
    // Raw, unrecognized content with no local file: write a generically named file under ./snapshots.
    // Sanitize the API-provided runId first so a path-like id can't escape the snapshots directory.
    const dir = resolve(process.cwd(), 'snapshots')
    await fs.mkdir(dir, { recursive: true })
    const safeRunId = args.runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)
    const snapshotPath = join(dir, `deepnote-run-${safeRunId}.snapshot.deepnote`)
    await fs.writeFile(snapshotPath, bytes, 'utf-8')
    return { snapshotPath }
  }

  const sourcePath = args.sourcePath ?? join(process.cwd(), 'notebook.deepnote')
  const timestamp = toSnapshotTimestamp(args.finishedAt)
  const timestampedSnapshotPath = getSnapshotPath(sourcePath, namingFile, { timestamp })
  const snapshotPath = getSnapshotPath(sourcePath, namingFile)

  await fs.mkdir(getSnapshotDir(sourcePath), { recursive: true })
  // Write the timestamped file first, then copy to `latest`, to reduce corruption risk.
  await fs.writeFile(timestampedSnapshotPath, bytes, 'utf-8')
  await fs.copyFile(timestampedSnapshotPath, snapshotPath)
  return { snapshotPath, timestampedSnapshotPath }
}

/**
 * Runs an existing notebook in Deepnote Cloud, polls to completion, and downloads the snapshot.
 *
 * Owns all output for the cloud path: success and post-run failure (error/stopped) are rendered
 * here (human, `-o json`, or `-o toon`). Pre-run problems (bad flags, missing token, ambiguous
 * notebook, network errors before we have a runId) are thrown for `createRunAction` to render.
 */
export async function runInDeepnoteCloud(path: string | undefined, options: RunCloudOptions): Promise<void> {
  if (options.push) {
    throw new CloudRunUsageError(
      'Pushing a local notebook to Deepnote is not yet implemented.\n' +
        'Run a notebook that already exists in Deepnote with --notebook-id <uuid> ' +
        '(or a .deepnote file whose notebook already exists in your workspace).'
    )
  }

  assertNoIncompatibleFlags(options)

  // Resolve a local .deepnote file when we need one to derive the notebook id (no --notebook-id),
  // or when a path was explicitly given (used for snapshot naming). `resolvePathToDeepnoteFile`
  // rejects non-.deepnote files and directories without a .deepnote for us.
  let sourcePath: string | undefined
  let localFile: DeepnoteFile | undefined
  const needFile = path !== undefined || !options.notebookId
  if (needFile) {
    const resolved = await resolvePathToDeepnoteFile(path)
    sourcePath = resolved.absolutePath
    localFile = deserializeDeepnoteFile(await fs.readFile(sourcePath, 'utf-8'))
  }

  // Load .env (next to the file, or the cwd) before reading the token — mirrors local `run`.
  const envDir = sourcePath ? dirname(sourcePath) : process.cwd()
  dotenv.config({ path: join(envDir, DEFAULT_ENV_FILE), quiet: true })

  const token = normalizeToken(options.token) ?? normalizeToken(process.env[DEEPNOTE_TOKEN_ENV])
  if (!token) {
    throw new MissingTokenError()
  }

  const baseUrl = options.url ?? DEFAULT_API_URL
  const notebookId = resolveTargetNotebookId(options, localFile)
  const inputs = parseCloudInputs(options, localFile, notebookId)
  const blockIds = options.block ? [options.block] : undefined

  const body: TriggerRunBody = {
    notebookId,
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    ...(blockIds ? { blockIds } : {}),
  }

  const isMachineOutput = options.output !== undefined
  const useSpinner = !isMachineOutput && !getOutputConfig().quiet && process.stderr.isTTY
  const spinner = useSpinner ? ora('Starting Deepnote run…').start() : null

  let finalRun: NormalizedRun
  try {
    const started = await triggerNotebookRun(baseUrl, token, body)
    if (spinner) {
      spinner.text = `Run ${started.runId}: ${started.status}…`
    }
    debug(`Triggered run ${started.runId} for notebook ${notebookId}`)

    finalRun = await pollRunUntilComplete(baseUrl, token, started.runId, {
      timeoutMs: (options.timeout ?? 600) * 1000,
      snapshotDelivery: 'inline',
      onStatus: status => {
        if (spinner) {
          spinner.text = `Run ${started.runId}: ${status}…`
        }
      },
    })

    // Defensive: some deployments only include the snapshot once terminal — re-fetch if absent.
    // A failure here must not escape: the run itself already reached a terminal state, so throwing
    // would discard its runId and status. Treat it as "no snapshot content" and let the snapshot
    // error path below report it with those fields intact.
    if (!finalRun.snapshot) {
      try {
        finalRun = await getRun(baseUrl, token, finalRun.runId, { snapshotDelivery: 'inline' })
      } catch (err) {
        debug(`Re-fetching run ${finalRun.runId} for its snapshot failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  } catch (err) {
    spinner?.fail('Deepnote run failed')
    throw err
  }

  const status = finalRun.status
  const success = isSuccessStatus(status)
  const runErrorMessage = describeRunError(finalRun)

  // Download + persist the snapshot. Downloading it is this command's contract, so for a
  // successful run any retrieval/persistence failure — or missing content — fails the command
  // (machine clients must not see success without an artifact). For a run that already failed, a
  // missing snapshot is expected, so we don't compound the failure.
  let snapshotPath: string | undefined
  let timestampedSnapshotPath: string | undefined
  let snapshotError: string | undefined
  try {
    const content = await fetchSnapshotContent(finalRun, { baseUrl, token })
    if (content) {
      const written = await writeCloudSnapshot({
        content,
        runId: finalRun.runId,
        finishedAt: finalRun.finishedAt,
        sourcePath,
        localFile,
        out: options.out,
      })
      snapshotPath = written.snapshotPath
      timestampedSnapshotPath = written.timestampedSnapshotPath
    } else if (success) {
      snapshotError = `Run ${finalRun.runId} completed but returned no snapshot content.`
    } else {
      debug(`Run ${finalRun.runId} returned no snapshot content.`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (success) {
      snapshotError = `Failed to save snapshot: ${message}`
    } else {
      debug(`Failed to save snapshot for failed run ${finalRun.runId}: ${message}`)
    }
  }

  // The command succeeds only if the run succeeded AND its snapshot was saved.
  const commandSucceeded = success && snapshotError === undefined
  const errorMessage = runErrorMessage ?? snapshotError

  const result: CloudRunResult = {
    success: commandSucceeded,
    runId: finalRun.runId,
    status,
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(timestampedSnapshotPath ? { timestampedSnapshotPath } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
  }

  if (options.output === 'json') {
    outputJson(result)
  } else if (options.output === 'toon') {
    outputToon(result)
  } else {
    renderHumanResult(result, spinner)
  }

  if (!commandSucceeded) {
    process.exitCode = ExitCode.Error
  }
}

function renderHumanResult(result: CloudRunResult, spinner: ReturnType<typeof ora> | null): void {
  const c = getChalk()
  if (result.success) {
    const message = `Run ${result.runId} completed (${result.status})`
    if (spinner) {
      spinner.succeed(message)
    } else {
      log(c.green(`✓ ${message}`))
    }
    if (result.snapshotPath) {
      log(`Snapshot saved to ${c.bold(result.snapshotPath)}`)
    }
    return
  }

  // status can be 'success' here when the run succeeded but its snapshot could not be saved.
  const message =
    result.status === 'success'
      ? `Run ${result.runId} completed but the snapshot could not be saved`
      : `Run ${result.runId} ${result.status}`
  if (spinner) {
    spinner.fail(message)
  } else {
    log(c.red(`✗ ${message}`))
  }
  if (result.error) {
    log(c.red(result.error))
  }
  if (result.snapshotPath) {
    log(`Partial snapshot saved to ${c.bold(result.snapshotPath)}`)
  }
}
