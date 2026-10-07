import { readFile, stat, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, isErrnoENOENT } from '../utils/file-resolver'
import {
  buildSubjectIndex,
  inferInternalDomain,
  lookupSubject,
  SCATTER_NOTEBOOK_THRESHOLD,
  type SubjectIndex,
} from '../utils/governance/subject-index'
import { canonicalizeEmail, createSubjectFingerprinter, SubjectSaltError } from '../utils/governance/subjects'
import { loadWorkspace } from '../utils/governance/workspace'

/** Environment variable holding the index salt. Meant to be injected from a secret manager. */
export const SUBJECT_SALT_ENV = 'DEEPNOTE_SUBJECT_SALT'

/** Default location of the index, next to wherever the operator is working. */
export const DEFAULT_SUBJECT_INDEX_FILE = '.deepnote-subjects.json'

export interface SubjectsIndexOptions {
  output?: 'json'
  out?: string
  saltFile?: string
  internalDomain?: string[]
}

export interface SubjectsLookupOptions {
  output?: 'json'
  index?: string
  saltFile?: string
}

/** Locations listed before the rest are collapsed into a count. */
const MAX_LISTED_LOCATIONS = 50

/**
 * Thresholds for guessing which domain is the operator's own. Below them the guess would be a coin
 * flip dressed as a classification — and getting it backwards would file every customer as a
 * colleague — so the run leaves everyone unclassified and says so.
 */
const MIN_INFERRED_DOMAIN_SHARE = 0.5
const MIN_INFERRED_DOMAIN_SUBJECTS = 2

/** `person` does not take a plural `s`. */
function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}

/** Display form of a path: relative when that is actually shorter, absolute when it escapes cwd. */
function displayPath(absolutePath: string): string {
  const relativePath = relative(process.cwd(), absolutePath)
  return relativePath === '' || relativePath.startsWith('..') ? absolutePath : relativePath
}

/**
 * Resolve the salt the index is fingerprinted under.
 *
 * Note what is missing: there is no `--salt` flag. A salt passed on the command line lands in shell
 * history and in the process list of every other user on the machine, and a salt that leaks turns
 * the index back into a list of people — the identifier space is small enough to enumerate. It
 * comes from an environment variable or a file, both of which a secret manager can supply.
 */
async function resolveSalt(saltFile: string | undefined): Promise<string> {
  if (saltFile) {
    try {
      const salt = (await readFile(resolve(process.cwd(), saltFile), 'utf8')).trim()
      if (salt === '') {
        throw new SubjectSaltError(`The salt file ${saltFile} is empty.`)
      }
      return salt
    } catch (error) {
      if (isErrnoENOENT(error)) {
        throw new FileResolutionError(`Salt file not found: ${saltFile}`)
      }
      throw error
    }
  }

  const fromEnv = process.env[SUBJECT_SALT_ENV]?.trim()
  if (fromEnv) {
    return fromEnv
  }

  throw new SubjectSaltError(
    `No subject salt. Set ${SUBJECT_SALT_ENV} or pass --salt-file <path>.\n` +
      'The salt must be the same every time or the index cannot be searched, and it must be kept ' +
      'apart from the index itself: email addresses are an enumerable space, so whoever holds both ' +
      'the salt and the index holds a list of people. Store it in a secret manager and inject it.'
  )
}

/** Map an error to the exit code its kind deserves. */
function exitCodeFor(error: unknown): number {
  return error instanceof FileResolutionError || error instanceof SubjectSaltError
    ? ExitCode.InvalidUsage
    : ExitCode.Error
}

function fail(error: unknown, isJson: boolean): never {
  const message = error instanceof Error ? error.message : String(error)
  if (isJson) {
    outputJson({ success: false, error: message })
  } else {
    logError(message)
  }
  process.exit(exitCodeFor(error))
}

/**
 * Creates the `subjects index` action: build a searchable index of which people appear where.
 *
 * The index is the only part of the governance layer that persists personal data in any form, so it
 * persists none of it in the clear — each person is an HMAC under the operator's salt. What it
 * stores is the part that makes a subject access request answerable in minutes: domains, file
 * paths, notebook names, line numbers, counts.
 */
export function createSubjectsIndexAction(
  _program: Command
): (path: string | undefined, options: SubjectsIndexOptions) => Promise<void> {
  return async (path, options) => {
    const isJson = options.output === 'json'
    try {
      const root = resolve(process.cwd(), path ?? '.')
      try {
        await stat(root)
      } catch (error) {
        if (isErrnoENOENT(error)) {
          throw new FileResolutionError(`File or directory not found: ${path ?? '.'}`)
        }
        throw error
      }

      const fingerprinter = createSubjectFingerprinter(await resolveSalt(options.saltFile))
      debug(`Indexing subjects in ${root}`)
      const workspace = await loadWorkspace(root)

      let internalDomains = options.internalDomain
      let inferred: ReturnType<typeof inferInternalDomain>
      if (!internalDomains || internalDomains.length === 0) {
        // Classify with the dominant domain so a first run is useful, but say that it is a guess.
        // Whether a person is a colleague or a customer is a decision about the organisation, and
        // the tool is not entitled to make it silently.
        const preliminary = buildSubjectIndex(workspace.projects, { fingerprinter, root })
        const candidate = inferInternalDomain(preliminary.subjects)
        inferred =
          candidate &&
          candidate.share >= MIN_INFERRED_DOMAIN_SHARE &&
          candidate.subjectCount >= MIN_INFERRED_DOMAIN_SUBJECTS
            ? candidate
            : undefined
        internalDomains = inferred ? [inferred.domain] : []
      }

      const index = buildSubjectIndex(workspace.projects, { fingerprinter, internalDomains, root })
      const outPath = resolve(process.cwd(), options.out ?? DEFAULT_SUBJECT_INDEX_FILE)
      await writeFile(outPath, `${JSON.stringify(index, null, 2)}\n`)

      if (isJson) {
        outputJson({
          path: outPath,
          saltFingerprint: index.saltFingerprint,
          internalDomains: index.internalDomains,
          inferredInternalDomain: inferred ?? null,
          summary: index.summary,
          parseErrors: workspace.errors,
        })
        return
      }

      outputIndexResult(index, outPath, inferred, workspace.errors.length)
    } catch (error) {
      fail(error, isJson)
    }
  }
}

function outputIndexResult(
  index: SubjectIndex,
  outPath: string,
  inferred: ReturnType<typeof inferInternalDomain>,
  parseErrorCount: number
): void {
  const c = getChalk()
  const { subjects, externalSubjects, locations, projects, notebooks, scattered } = index.summary

  output(c.bold(`Subject index → ${c.dim(displayPath(outPath))}`))
  output(
    `  ${people(subjects)} in ${locations} location${locations === 1 ? '' : 's'}, across ${projects} project${projects === 1 ? '' : 's'} and ${notebooks} notebook${notebooks === 1 ? '' : 's'}`
  )
  if (subjects > 0) {
    output(
      index.internalDomains.length > 0
        ? `  ${externalSubjects} external, ${subjects - externalSubjects} internal`
        : c.dim('  Unclassified: no --internal-domain given, so colleagues and customers count alike')
    )
    if (scattered > 0) {
      output(
        `  ${c.yellow('⚠')} ${people(scattered)} ${scattered === 1 ? 'appears' : 'appear'} in ${SCATTER_NOTEBOOK_THRESHOLD} or more notebooks — an erasure request has to reach every one`
      )
    }
  }
  output('')

  if (inferred) {
    output(
      c.yellow(
        `Guessed "${inferred.domain}" as your own domain: it covers ${inferred.subjectCount} of ${index.summary.subjects} subjects (${Math.round(inferred.share * 100)}%).`
      )
    )
    output(c.dim('Pass --internal-domain to decide this yourself.'))
    output('')
  }
  if (parseErrorCount > 0) {
    output(
      c.yellow(
        `${parseErrorCount} file${parseErrorCount === 1 ? '' : 's'} could not be parsed and ${parseErrorCount === 1 ? 'was' : 'were'} skipped.`
      )
    )
    output('')
  }

  output(c.dim(`Salt fingerprint ${index.saltFingerprint}. Keep the salt itself out of this directory:`))
  output(c.dim('whoever holds the salt and the index together holds a list of people.'))
}

/**
 * Creates the `subjects lookup` action: answer "where is this person's data?".
 *
 * The identifier is canonicalised and fingerprinted locally and is never written to the output — the
 * terminal already knows what was typed, and a transcript of DSAR lookups should not accumulate into
 * the list the index exists to avoid.
 */
export function createSubjectsLookupAction(
  _program: Command
): (identifier: string, options: SubjectsLookupOptions) => Promise<void> {
  return async (identifier, options) => {
    const isJson = options.output === 'json'
    try {
      const canonicalized = canonicalizeEmail(identifier.trim())
      if (!canonicalized) {
        throw new FileResolutionError(
          `"${identifier}" is not an indexable subject. Pass a personal email address — role accounts (support@, no-reply@) and documentation placeholders are deliberately not indexed as people.`
        )
      }

      const indexPath = resolve(process.cwd(), options.index ?? DEFAULT_SUBJECT_INDEX_FILE)
      let index: SubjectIndex
      try {
        index = JSON.parse(await readFile(indexPath, 'utf8')) as SubjectIndex
      } catch (error) {
        if (isErrnoENOENT(error)) {
          throw new FileResolutionError(
            `Subject index not found: ${options.index ?? DEFAULT_SUBJECT_INDEX_FILE}. Build one with "deepnote subjects index <dir>".`
          )
        }
        throw error
      }

      const fingerprinter = createSubjectFingerprinter(await resolveSalt(options.saltFile))
      const result = lookupSubject(index, canonicalized.canonical, fingerprinter)

      if (!result.saltMatches) {
        // Every lookup under the wrong salt misses. Reporting "no data held" here would be a
        // confidently wrong answer to a legally binding question.
        throw new SubjectSaltError(
          `This index was built under a different salt (index ${index.saltFingerprint}, current ${fingerprinter.saltFingerprint}). Every lookup would come back empty. Use the salt the index was built with, or rebuild the index.`
        )
      }

      if (isJson) {
        outputJson({
          fingerprint: result.fingerprint,
          found: result.entry !== undefined,
          index: { root: index.root, createdAt: index.createdAt, saltFingerprint: index.saltFingerprint },
          subject: result.entry ?? null,
        })
        return
      }

      outputLookupResult(index, result)
    } catch (error) {
      fail(error, isJson)
    }
  }
}

function outputLookupResult(index: SubjectIndex, result: ReturnType<typeof lookupSubject>): void {
  const c = getChalk()
  output(c.bold(`Subject ${result.fingerprint}`))
  output(c.dim(`in the index built ${index.createdAt} from ${index.root || '.'}`))
  output('')

  if (!result.entry) {
    output(c.green('No locations recorded for this subject.'))
    output(c.dim('The index covers the synced .deepnote files it was built from. Data held outside those'))
    output(c.dim('files — in the warehouse itself, or in projects that were not synced — is not in scope.'))
    return
  }

  const { entry } = result
  const notebooks = entry.notebookCount
  const projects = entry.projectCount
  output(
    `Found in ${notebooks} notebook${notebooks === 1 ? '' : 's'} across ${projects} project${projects === 1 ? '' : 's'} ${c.dim(`(${entry.locations.length} location${entry.locations.length === 1 ? '' : 's'}, domain ${entry.domain}${entry.internal ? ', internal' : ''})`)}`
  )
  output('')

  for (const location of entry.locations.slice(0, MAX_LISTED_LOCATIONS)) {
    const where = location.source === 'output' ? c.yellow('output') : c.dim('content')
    output(`  ${location.projectName} ${c.dim('·')} ${location.notebookName}`)
    output(`    ${c.dim(`${location.path}:${location.line}`)} ${where}`)
  }
  if (entry.locations.length > MAX_LISTED_LOCATIONS) {
    output(c.dim(`  … ${entry.locations.length - MAX_LISTED_LOCATIONS} more`))
  }

  const outputLocations = entry.locations.filter(location => location.source === 'output').length
  if (outputLocations > 0) {
    output('')
    output(
      c.yellow(
        `${outputLocations} location${outputLocations === 1 ? ' is' : 's are'} in saved cell output — the data itself is in the file, not just a reference to it.`
      )
    )
  }
}
