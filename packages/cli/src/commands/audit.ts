import { stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, isErrnoENOENT } from '../utils/file-resolver'
import { type AuditIssue, auditWorkspace, scrubText, type WorkspaceAudit } from '../utils/governance/audit'
import {
  buildReviewFile,
  compareTriageToReview,
  loadReviewFile,
  type MeasuredPrecision,
  MIN_REVIEWED_FOR_PRECISION,
  measurePrecision,
  ReviewFileError,
  usablePrecision,
} from '../utils/governance/review'
import { scoreOutOf100 } from '../utils/governance/scoring'
import {
  ABSENT_VARIANT,
  type DivergenceGroup,
  type DivergenceKind,
  type DivergenceScope,
} from '../utils/governance/sql-divergence'
import { COLD_DAYS, formatAge } from '../utils/governance/staleness'
import {
  createOpenAiCompatibleProvider,
  resolveTriageConfig,
  runTriage,
  TRIAGE_CACHE_PATH,
  TriageCache,
  TriageConfigError,
  type TriageProvider,
  type TriageResult,
} from '../utils/governance/triage'
import { loadWorkspace } from '../utils/governance/workspace'

export interface AuditOptions {
  output?: 'json'
  project?: string
  issues?: boolean
  internalDomain?: string[]
  /** Print every divergence group with every variant and location, rather than a count. */
  divergence?: boolean
  /** Do not run the consensus checks at all. */
  skipDivergence?: boolean
  /** Consensus confidence below which a divergence group is reported but raises no finding. */
  minConfidence?: number
  /** Restrict the consensus checks to these anchor families. */
  divergenceKind?: DivergenceKind[]
  /** How strictly two queries must share a warehouse before they are compared. */
  divergenceScope?: DivergenceScope
  /** Ask a model whether each divergence group is a real defect. Off by default. */
  triage?: boolean
  /** Endpoint and model, when not taken from the environment. */
  triageBaseUrl?: string
  triageModel?: string
  /** Most-confident-first cap on how many groups are sent. */
  triageLimit?: number
  /** Ignore any cached verdicts and ask again. */
  triageCache?: boolean
  /** Injected by tests; production resolves a provider from the configuration. */
  triageProvider?: TriageProvider
  /** Write every divergence group to this file with a blank verdict, for a human to fill in. */
  exportReview?: string
  /** Read verdicts back and use the measured precision in place of the per-kind priors. */
  importReview?: string
}

/** Issues printed in the terminal summary before it collapses the rest into a count. */
const MAX_LISTED_ISSUES = 20

/** Rows printed per section before the rest are collapsed into a "+ n more" line. */
const MAX_LISTED_ROWS = 15

/**
 * Creates the audit action — the workspace-scoped governance pass.
 *
 * `deepnote lint --governance` covers a single project. This covers the tree `deepnote sync`
 * writes: what integrations exist and who uses them, where data leaves to, and which credentials
 * are shared across projects. It is an inventory, so it exits 0 whenever it could read the
 * workspace — nothing here is a gate, and a scheduled audit that failed its own pipeline would
 * just be turned off.
 */
export function createAuditAction(
  _program: Command
): (path: string | undefined, options: AuditOptions) => Promise<void> {
  return async (path, options) => {
    try {
      const root = resolve(process.cwd(), path ?? '.')
      debug(`Auditing workspace: ${root}`)

      try {
        await stat(root)
      } catch (error) {
        if (isErrnoENOENT(error)) {
          throw new FileResolutionError(`File or directory not found: ${path ?? '.'}`)
        }
        throw error
      }

      const workspace = await loadWorkspace(root)
      if (
        options.project &&
        !workspace.projects.some(
          p => p.id === options.project || p.name.toLowerCase() === options.project?.toLowerCase()
        )
      ) {
        // Scrubbed like everything else the command prints. This path never reaches
        // `auditWorkspace`, so it does not inherit the report's redaction boundary — and it names
        // the workspace root and the closest project names, either of which can hold a credential.
        throw new FileResolutionError(
          scrubText(
            workspace.projects.length === 0
              ? `Project "${options.project}" not found: no .deepnote files under ${root}`
              : `Project "${options.project}" not found in ${root}. ${describeNearest(
                  options.project,
                  workspace.projects.map(p => p.name)
                )}`
          )
        )
      }

      const auditOptions = {
        project: options.project,
        internalDomains: options.internalDomain,
        divergence: !options.skipDivergence,
        divergenceKinds: options.divergenceKind,
        minConfidence: options.minConfidence,
        divergenceScope: options.divergenceScope,
      }

      // Triage needs the groups, and the groups come from the audit — so the deterministic pass
      // runs first and is re-scored with the verdicts. One extra pass over an in-memory report is
      // cheaper than threading a provider through the engine, and it keeps `auditWorkspace` pure.
      // A reviewed sample, when one exists, replaces the per-kind priors with a measurement.
      const review = options.importReview
        ? await loadReviewFile(resolve(process.cwd(), options.importReview))
        : undefined
      const measured = review ? measurePrecision(review) : undefined
      if (measured) {
        Object.assign(auditOptions, { measuredPrecision: usablePrecision(measured) })
      }

      const deterministic = auditWorkspace(workspace, auditOptions)
      // Not gated on the group count: `triageDivergence` resolves the configuration first, so a
      // `--triage` run that is pointed at nothing fails rather than passing quietly.
      const triageResults = options.triage ? await triageDivergence(deterministic, options) : undefined
      const audit = triageResults
        ? auditWorkspace(workspace, { ...auditOptions, triage: triageResults })
        : deterministic

      if (options.exportReview) {
        await writeReviewFile(resolve(process.cwd(), options.exportReview), deterministic, options.output !== 'json')
      }
      if (measured && options.output !== 'json') {
        outputPrecision(measured, triageResults)
      }

      if (options.output === 'json') {
        outputJson(audit)
      } else {
        outputAudit(audit, options)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // A missing triage endpoint is a usage error, not a failure of the audit: the user asked for
      // something that has to be configured, and the message says how.
      const exitCode =
        error instanceof FileResolutionError || error instanceof TriageConfigError || error instanceof ReviewFileError
          ? ExitCode.InvalidUsage
          : ExitCode.Error

      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(exitCode)
    }
  }
}

/** How many near-miss project names a "not found" message offers. */
const MAX_SUGGESTED_PROJECTS = 5

/**
 * Score how close `candidate` is to what the user typed. Higher is closer; 0 is unrelated.
 *
 * Deliberately crude — a prefix/substring test rather than an edit distance. The job is to catch
 * the realistic misses (a truncated name, the wrong case, a forgotten suffix), not to rank the
 * whole workspace, and a name sharing no run of characters with the query is no better a guess
 * than any other.
 */
function nameAffinity(query: string, candidate: string): number {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  if (c === q) {
    return 4
  }
  if (c.startsWith(q) || q.startsWith(c)) {
    return 3
  }
  if (c.includes(q) || q.includes(c)) {
    return 2
  }
  // A shared leading run, so a half-typed name still finds the project it is a prefix of.
  let shared = 0
  while (shared < q.length && shared < c.length && q[shared] === c[shared]) {
    shared++
  }
  return shared >= 3 ? 1 : 0
}

/**
 * The tail of a "project not found" message: the closest few names, and how many there are.
 *
 * Listing every project was the original behaviour. On a workspace of any size that is tens of
 * kilobytes of names into stderr — unreadable as help, and a needless disclosure in a CI log,
 * where a project name can itself be the sensitive part.
 */
export function describeNearest(query: string, names: string[]): string {
  const nearest = names
    .map(name => ({ name, score: nameAffinity(query, name) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTED_PROJECTS)

  const total = `${plural(names.length, 'project')} in this workspace`
  return nearest.length === 0
    ? `${total}; pass --project with an exact name or id, or -o json to list them.`
    : `Closest ${nearest.length === 1 ? 'match' : 'matches'}: ${nearest.map(entry => `"${entry.name}"`).join(', ')} (${total}).`
}

/** Nouns whose plural is not formed by appending `s`. */
const IRREGULAR_PLURALS: Record<string, string> = { query: 'queries', person: 'people' }

/**
 * Run the model over the divergence groups and return its verdicts.
 *
 * Resolves and *prints* the endpoint before the first request: somebody running a compliance tool
 * is entitled to see where their SQL is about to go, and a line of output is the cheapest possible
 * way to tell them. Everything else about this is fail-soft — a bad endpoint, a timeout or a
 * nonsense response all end with the deterministic score standing and the audit exiting 0.
 */
/**
 * The anchors `--triage` judges when `--divergence-kind` was not given.
 *
 * Metric anchors are the bulk of the output and the ones where the question is about intent:
 * whether `sum(amount)` and `sum(amount_gross)` were meant to be the same number is not visible
 * in the tokens. Join anchors are few enough that a person reads them directly, and they are
 * structural — the deterministic layer decides them about as well as a model would. Spending a
 * model call on them buys little and costs the thing triage is supposed to save.
 *
 * An explicit `--divergence-kind` overrides this: what the audit looked for is what gets judged.
 */
const DEFAULT_TRIAGE_KINDS: readonly DivergenceKind[] = ['metric']

/** The groups `--triage` will judge, given what the user asked the audit to look for. */
function groupsToTriage(audit: WorkspaceAudit, options: AuditOptions): DivergenceGroup[] {
  if (options.divergenceKind && options.divergenceKind.length > 0) {
    return audit.divergence
  }
  return audit.divergence.filter(group => DEFAULT_TRIAGE_KINDS.includes(group.kind))
}

/**
 * Run the model over the divergence groups and return its verdicts.
 *
 * Resolves and *prints* the endpoint before the first request — and before deciding whether there
 * is anything to send. Resolution used to be lazy, so on a workspace that yielded no groups
 * `--triage` with nothing configured exited 0 and never mentioned triage at all: a CI job
 * misconfigured for weeks would read as a clean pass. Configuration is a property of the
 * invocation, not of what the corpus happened to contain.
 *
 * Everything after that is fail-soft: a bad endpoint, a timeout or a nonsense response all end
 * with the deterministic score standing and the audit exiting 0.
 */
async function triageDivergence(audit: WorkspaceAudit, options: AuditOptions): Promise<Map<string, TriageResult>> {
  const c = getChalk()
  const groups = groupsToTriage(audit, options)

  // Tests inject a provider directly; production resolves one from flags and environment.
  if (options.triageProvider) {
    const run = await runTriage(groups, {
      provider: options.triageProvider,
      limit: options.triageLimit,
    })
    return run.results
  }

  // Before the group count is consulted, so a missing endpoint is an error either way.
  const config = resolveTriageConfig({ baseUrl: options.triageBaseUrl, model: options.triageModel })

  // Under `-o json` stdout is one document a caller parses, so these go to stderr rather than in
  // front of it. They are not dropped: saying where the SQL is being sent, before it is sent, is a
  // guarantee this command makes, and the automated path is the one where nobody is watching.
  const status = options.output === 'json' ? (message: string) => console.error(message) : output

  if (groups.length === 0) {
    status(c.dim(`Triage: configured for ${config.baseUrl} (${config.model}), but there is nothing to judge.`))
    status('')
    return new Map()
  }

  status(c.dim(`Triage: sending ${plural(groups.length, 'group')} to ${config.baseUrl} (${config.model})`))
  status(c.dim('Variant forms only — no blocks, no outputs — redacted the same way the report is.'))

  const cache =
    options.triageCache === false ? undefined : new TriageCache(join(audit.root, TRIAGE_CACHE_PATH), config.model)
  const run = await runTriage(groups, {
    provider: createOpenAiCompatibleProvider(config),
    cache,
    limit: options.triageLimit,
  })

  const { candidates, cached, requested, failed } = run.stats
  status(
    c.dim(
      `Triage: ${candidates} considered, ${cached} from cache, ${requested} judged${failed > 0 ? `, ${failed} unavailable` : ''}`
    )
  )
  status('')
  return run.results
}

/**
 * Write the review file: every group, every variant, every location, and a blank verdict.
 *
 * This is the thing that turns "precision is unvalidated" from a caveat into a task. The order is
 * the order a reviewer should work in — best-attested first — so a partially filled file still
 * measures the part that matters most.
 */
async function writeReviewFile(path: string, audit: WorkspaceAudit, announce: boolean): Promise<void> {
  const file = buildReviewFile(audit.divergence)
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`)

  // Under `-o json` stdout is one document a caller parses. Four lines of instructions in front of
  // it is not a cosmetic problem: the command still exits 0, so a pipeline reads a successful run
  // and unparseable output.
  if (!announce) {
    return
  }

  const c = getChalk()
  output(c.bold('Review export'))
  output(`  ${plural(file.entries.length, 'group')} written to ${relative(process.cwd(), path) || path}`)
  output(c.dim(`  Set "verdict" on each to one of: real, legitimate-difference, false-positive.`))
  output(c.dim(`  Then: deepnote audit <dir> --import-review ${relative(process.cwd(), path) || path}`))
  output('')
}

/** Report what the reviewed sample measured, and how a model run compared against it. */
function outputPrecision(measured: MeasuredPrecision, triage?: Map<string, TriageResult>): void {
  const c = getChalk()
  output(c.bold('Measured precision'))
  if (measured.reviewed === 0) {
    output(c.dim('  The review file has no verdicts yet, so the per-kind defaults still apply.'))
    output('')
    return
  }

  for (const kind of ['join', 'filter', 'metric'] as const) {
    const row = measured.byKind[kind]
    if (row.reviewed === 0) {
      continue
    }
    const enough = row.reviewed >= MIN_REVIEWED_FOR_PRECISION
    const share = `${row.real}/${row.reviewed}`
    // Below the floor the measurement is noisier than the guess it would replace, so it is
    // reported and not used — and the line says which.
    output(
      `  ${kind.padEnd(6)} ${c.bold(((row.precision ?? 0) * 100).toFixed(0).padStart(3))}% ${c.dim(`(${share} judged real)`)} ${
        enough ? c.dim('— used in place of the default') : c.yellow(`— needs ${MIN_REVIEWED_FOR_PRECISION} to be used`)
      }`
    )
  }

  if (triage && triage.size > 0) {
    output('')
    output(c.bold('Triage agreement with the reviewer'))
    for (const row of compareTriageToReview(measured, triage)) {
      if (row.compared === 0) {
        continue
      }
      output(
        `  ${row.kind.padEnd(6)} ${c.bold(((row.rate ?? 0) * 100).toFixed(0).padStart(3))}% ${c.dim(`(${row.agreed}/${row.compared})`)}`
      )
    }
    output(c.dim('  Without this number the model is one unmeasured judgment replacing another.'))
  }
  output('')
}

function plural(count: number, noun: string): string {
  return count === 1 ? `${count} ${noun}` : `${count} ${IRREGULAR_PLURALS[noun] ?? `${noun}s`}`
}

/** `plural` appends an `s`, which "person" does not take. */
function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}

/** Shorten a label to `width`, so one long first line cannot wrap the whole report. */
function truncate(text: string, width: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= width ? collapsed : `${collapsed.slice(0, width - 1)}…`
}

/** `+ n more` for a list that was cut short, or nothing when it was not. */
function remainder(total: number, shown: number): string | undefined {
  return total > shown ? `  … ${total - shown} more` : undefined
}

function outputAudit(audit: WorkspaceAudit, options: AuditOptions): void {
  const c = getChalk()
  const root = relative(process.cwd(), audit.root) || '.'

  if (audit.summary.projects === 0) {
    output(c.yellow(`No .deepnote files found under ${root}.`))
    output(c.dim('Run "deepnote sync <dir>" first, then audit that directory.'))
    return
  }

  const { projects, notebooks, blocks, sqlBlocks, codeBlocks } = audit.summary
  output(c.bold(`Workspace ${c.dim(root)}`))
  output(
    `  ${plural(projects, 'project')}, ${plural(notebooks, 'notebook')}, ${plural(blocks, 'block')} ${c.dim(`(${sqlBlocks} SQL, ${codeBlocks} code)`)}`
  )
  output('')

  outputIntegrations(audit)
  outputTables(audit)
  outputDivergence(audit, options)
  outputEgress(audit)
  outputSubjects(audit)
  outputSharedCredentials(audit)
  outputStaleness(audit)
  outputIssues(audit, options)
  outputSuppressed(audit)
  outputNotes(audit)
}

/** Ingress: the declared connectors, and the ones nobody uses. */
function outputIntegrations(audit: WorkspaceAudit): void {
  const c = getChalk()
  output(c.bold('Ingress — integrations'))
  if (audit.integrations.length === 0) {
    output(c.dim('  No integrations declared or referenced.'))
    output('')
    return
  }

  const shown = audit.integrations.slice(0, MAX_LISTED_ROWS)
  for (const integration of shown) {
    const label = integration.name ?? integration.id
    const type = integration.type ? c.dim(` (${integration.type})`) : ''
    if (integration.orphan) {
      output(
        `  ${c.yellow('⚠')} ${label}${type} — declared in ${plural(integration.consumers.length, 'project')}, used by none`
      )
      continue
    }
    const users = integration.consumers.filter(consumer => consumer.blockCount > 0)
    const undeclared = users.filter(consumer => !consumer.declared).length
    const undeclaredNote = undeclared > 0 ? c.yellow(` · undeclared in ${undeclared}`) : ''
    output(
      `  ${label}${type} — ${plural(users.length, 'project')}, ${plural(integration.blockCount, 'SQL block')}${undeclaredNote}`
    )
  }
  const more = remainder(audit.integrations.length, shown.length)
  if (more) {
    output(c.dim(more))
  }
  output('')
}

/** Width of the widest egress direction marker (`→ writes`), so the host column lines up. */
const EGRESS_MARKER_WIDTH = 8

/** Tables, ranked by how much *live* work depends on them. */
function outputTables(audit: WorkspaceAudit): void {
  if (audit.tables.length === 0) {
    return
  }
  const c = getChalk()
  output(c.bold('Tables — ranked by live reach'))

  const shown = audit.tables.slice(0, MAX_LISTED_ROWS)
  // A short name is only unique within one integration, so it is qualified in the output whenever
  // the same name appears behind more than one — otherwise two different tables print identically.
  const ambiguous = new Set(
    audit.tables.map(table => table.name).filter((name, index, names) => names.indexOf(name) !== index)
  )
  for (const table of shown) {
    // Both numbers, always. The raw count is the one people quote; the live count is the one that
    // is true, and printing them together is what stops a blast radius being read as 8× its size.
    const reach =
      table.liveProjectCount === table.projectCount
        ? `${plural(table.projectCount, 'project')}`
        : `${table.liveProjectCount} live of ${plural(table.projectCount, 'project')}`
    const label = ambiguous.has(table.name) ? `${table.name} ${c.dim(`(${table.integrationId})`)}` : table.name
    output(`  ${label} ${c.dim(`— ${reach}, ${plural(table.blockCount, 'SQL block')}`)}`)
  }
  const more = remainder(audit.tables.length, shown.length)
  if (more) {
    output(c.dim(more))
  }
  output('')
}

/** Rows of variant detail printed per divergence group under --divergence. */
const MAX_LISTED_VARIANTS = 6

/** Divergence groups printed under --divergence before the rest are collapsed. */
const MAX_LISTED_GROUPS = 12

/**
 * Consensus: the anchors the workspace defines two ways.
 *
 * Collapsed to a count by default, because this is the one check whose precision has not been
 * measured and a wall of unvalidated findings would crowd out the ones that are certain.
 * `--divergence` opens it up into every variant and every location — which is exactly the review
 * someone has to do before the ranking means anything.
 */
function outputDivergence(audit: WorkspaceAudit, options: AuditOptions): void {
  const c = getChalk()
  if (options.skipDivergence) {
    return
  }

  output(c.bold('Consensus — divergence'))
  if (audit.divergence.length === 0) {
    output(c.dim('  No anchor is defined two ways, or the corpus is too small to tell.'))
    output('')
    return
  }

  if (!options.divergence) {
    const byKind = new Map<string, number>()
    for (const group of audit.divergence) {
      byKind.set(group.kind, (byKind.get(group.kind) ?? 0) + 1)
    }
    const breakdown = [...byKind].map(([kind, count]) => `${count} ${kind}`).join(', ')
    const diverging = audit.divergence.reduce(
      (total, group) => total + (group.observations - group.consensus.members.length),
      0
    )
    output(
      `  ${plural(audit.divergence.length, 'anchor')} defined more than one way ${c.dim(`(${breakdown})`)} — ${plural(diverging, 'query')} ${diverging === 1 ? 'diverges' : 'diverge'}`
    )
    output(c.dim('  Run with --divergence to see every variant and where it is used.'))
    output('')
    return
  }

  for (const group of audit.divergence.slice(0, MAX_LISTED_GROUPS)) {
    // Confidence first: it is the number that decides whether the rest of the line is worth
    // reading, and it is the one the whole check is calibrated on.
    const confidence = group.confidence.toFixed(2)
    output(
      `  ${c.bold(confidence)} ${c.dim(group.kind.padEnd(6))} ${group.anchorLabel} ${c.dim(`— ${group.consensus.members.length} of ${group.observations} queries, ${plural(group.projectCount, 'project')}`)}`
    )

    for (const variant of group.variants.slice(0, MAX_LISTED_VARIANTS)) {
      const isConsensus = variant.variant === group.consensus.variant
      const marker = isConsensus ? c.green('consensus') : c.yellow('diverges ')
      const label = variant.variant === ABSENT_VARIANT ? c.dim(variant.label) : variant.label
      output(`        ${marker}  ${label} ${c.dim(`× ${variant.members.length}`)}`)
      if (isConsensus) {
        continue
      }
      // Only the dissenters get located: the consensus is the background, not the work. The block
      // label is included because two dissenting blocks in one notebook are otherwise two
      // identical lines.
      for (const member of variant.members.slice(0, MAX_LISTED_VARIANTS)) {
        const where = `${member.location.projectName} · ${member.location.notebookName}`
        output(c.dim(`                    ${where} — ${truncate(member.location.blockLabel, 60)}`))
      }
      const moreMembers = remainder(variant.members.length, Math.min(variant.members.length, MAX_LISTED_VARIANTS))
      if (moreMembers) {
        output(c.dim(`                  ${moreMembers.trim()}`))
      }
    }
    const moreVariants = remainder(group.variants.length, Math.min(group.variants.length, MAX_LISTED_VARIANTS))
    if (moreVariants) {
      output(c.dim(`      ${moreVariants.trim()}`))
    }
  }

  const more = remainder(audit.divergence.length, Math.min(audit.divergence.length, MAX_LISTED_GROUPS))
  if (more) {
    output(c.dim(more))
  }
  output('')
  output(c.dim('Confidence is the Wilson lower bound on the consensus share: it discounts a majority by'))
  output(c.dim('how little of it was seen, so 2-of-3 scores 0.21 and 78-of-80 scores 0.91.'))
  output('')
}

/** Egress: third-party hosts the code reaches, writes first. */
function outputEgress(audit: WorkspaceAudit): void {
  const c = getChalk()
  output(c.bold('Egress — external hosts'))
  if (audit.egress.length === 0) {
    output(c.dim('  No external hosts referenced in code blocks.'))
    output('')
    return
  }

  const ordered = [...audit.egress].sort((a, b) => {
    const rank = (direction: string): number => (direction === 'write' ? 0 : direction === 'unknown' ? 1 : 2)
    return rank(a.direction) - rank(b.direction) || b.blockCount - a.blockCount
  })
  const shown = ordered.slice(0, MAX_LISTED_ROWS)
  for (const host of shown) {
    // Padded to a common width so the host column lines up: the three markers are 8, 7 and 6
    // characters, and coloring them first would make `padEnd` count the escape codes.
    const label = host.direction === 'write' ? '→ writes' : host.direction === 'read' ? '← reads' : '· refs'
    const marker = (host.direction === 'write' ? c.yellow : c.dim)(label.padEnd(EGRESS_MARKER_WIDTH))
    output(
      `  ${marker}  ${host.host} ${c.dim(`— ${plural(host.projects.length, 'project')}, ${plural(host.blockCount, 'block')}`)}`
    )
  }
  const more = remainder(ordered.length, shown.length)
  if (more) {
    output(c.dim(more))
  }
  output('')
}

/** How many people the workspace holds data about, and how far each one is spread. */
function outputSubjects(audit: WorkspaceAudit): void {
  if (audit.subjects.total === 0) {
    return
  }
  const c = getChalk()
  const { total, external, scattered, locations, internalDomains } = audit.subjects

  output(c.bold('Data subjects'))
  const classification =
    internalDomains.length > 0
      ? `${external} external ${c.dim(`(internal: ${internalDomains.join(', ')})`)}`
      : c.dim('unclassified — pass --internal-domain to separate colleagues from customers')
  output(`  ${people(total)} in ${plural(locations, 'location')}, ${classification}`)
  if (scattered > 0) {
    output(
      `  ${c.yellow('⚠')} ${people(scattered)} ${scattered === 1 ? 'appears' : 'appear'} in more than one notebook`
    )
  }
  output(c.dim('  Identities are fingerprinted per run and discarded. For a persistent, searchable'))
  output(c.dim('  index, run "deepnote subjects index".'))
  output('')
}

/** Credentials hardcoded in more than one project — the ones rotation breaks all at once. */
function outputSharedCredentials(audit: WorkspaceAudit): void {
  if (audit.credentials.length === 0) {
    return
  }
  const c = getChalk()
  output(c.bold('Credentials shared across projects'))
  for (const credential of audit.credentials) {
    output(
      `  ${c.red('✖')} ${credential.fingerprint} ${c.dim(`(${credential.kinds.join(', ')})`)} — ${plural(credential.projects.length, 'project')}: ${credential.projects.map(p => p.projectName).join(', ')}`
    )
  }
  output('')
}

/** How much of the workspace is still maintained — the multiplier every finding is scored by. */
function outputStaleness(audit: WorkspaceAudit): void {
  const c = getChalk()
  const { live, aging, cold, unknown, medianAgeDays } = audit.staleness
  if (live + aging + cold + unknown === 0) {
    return
  }

  output(c.bold('Maintenance'))
  const parts = [`${live} live`, `${aging} aging`]
  if (cold > 0) {
    parts.push(c.yellow(`${cold} cold (${Math.round(COLD_DAYS / 365)}y+)`))
  }
  if (unknown > 0) {
    parts.push(c.dim(`${unknown} undated`))
  }
  const median = medianAgeDays === undefined ? '' : c.dim(` · median age ${formatAge(medianAgeDays)}`)
  output(`  ${parts.join(', ')} notebooks${median}`)
  output('')
}

/**
 * How a finding reads before the path is considered: the project and notebook a reader sees.
 *
 * JSON-encoded rather than joined on a separator, because a notebook name is arbitrary text and any
 * separator chosen for it is a separator somebody can type.
 */
function locationKey(issue: AuditIssue): string {
  return JSON.stringify([issue.projectId, issue.notebookName])
}

/** The locations that more than one listed finding would print identically. */
function duplicateLocations(issues: AuditIssue[]): Set<string> {
  const seen = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const issue of issues) {
    if (!issue.notebookName) {
      continue
    }
    const key = locationKey(issue)
    const previous = seen.get(key)
    if (previous === undefined) {
      seen.set(key, issue.path)
    } else if (previous !== issue.path) {
      duplicates.add(key)
    }
  }
  return duplicates
}

function outputIssues(audit: WorkspaceAudit, options: AuditOptions): void {
  const c = getChalk()
  if (audit.issues.length === 0) {
    output(c.green('✓ No findings'))
    output('')
    return
  }

  // `audit.issues` arrives ranked. With --issues the ranking is shown directly; without it, findings
  // are grouped by check and the groups keep the order of their highest-scoring member, so the top
  // of the list is the same work either way.
  if (options.issues) {
    output(c.bold('Findings — ranked'))
    const listed = audit.issues.slice(0, MAX_LISTED_ISSUES)
    // One project can hold several `.deepnote` files, so two notebooks in it can share a name. The
    // path is the only unambiguous locator, but printing it on every row buries the readable part
    // under a column of directories — so it is added only where the readable part repeats.
    const ambiguous = duplicateLocations(listed)
    for (const issue of listed) {
      const isError = issue.severity === 'error'
      const score = String(scoreOutOf100(issue.score)).padStart(3)
      output(
        `  ${c.bold(score)} ${isError ? c.red('✖') : c.yellow('⚠')} ${isError ? c.red(issue.code) : c.yellow(issue.code)}`
      )
      const where = issue.notebookName
        ? ambiguous.has(locationKey(issue))
          ? `${issue.notebookName} (${issue.path})`
          : issue.notebookName
        : issue.path
      output(`      ${c.dim(`${issue.projectName} · ${where}`)} ${issue.message}`)
    }
    const listedMore = remainder(audit.issues.length, Math.min(audit.issues.length, MAX_LISTED_ISSUES))
    if (listedMore) {
      output(c.dim(`  ${listedMore.trim()}`))
    }
    output('')
    output(c.dim('Score = signal × exposure × neglect × blast radius, out of 100. Ranked, never gated;'))
    output(c.dim('-o json carries all four factors so you can disagree with one of them.'))
    output('')
  } else {
    const byCode = new Map<string, AuditIssue[]>()
    for (const issue of audit.issues) {
      // Appended, not rebuilt: copying the group per finding makes grouping quadratic in the
      // number of findings sharing a code, which on a large workspace is most of them.
      const group = byCode.get(issue.code)
      if (group) {
        group.push(issue)
      } else {
        byCode.set(issue.code, [issue])
      }
    }

    output(c.bold('Findings'))
    for (const [code, codeIssues] of byCode) {
      const isError = codeIssues[0].severity === 'error'
      const icon = isError ? c.red('✖') : c.yellow('⚠')
      const projectCount = new Set(codeIssues.map(issue => issue.projectId)).size
      const topScore = String(scoreOutOf100(codeIssues[0].score)).padStart(3)
      output(
        `  ${c.bold(topScore)} ${icon} ${isError ? c.red(code) : c.yellow(code)}: ${codeIssues.length} in ${plural(projectCount, 'project')}`
      )
    }
    output('')
  }

  const parts: string[] = []
  if (audit.issueCount.errors > 0) {
    parts.push(c.red(plural(audit.issueCount.errors, 'error')))
  }
  if (audit.issueCount.warnings > 0) {
    parts.push(c.yellow(plural(audit.issueCount.warnings, 'warning')))
  }
  output(`${c.bold('Summary:')} ${parts.join(', ')}`)
  if (!options.issues) {
    output(c.dim('Highest score per check shown. Run with --issues for the ranked list, or -o json.'))
  }
  output('')
}

/**
 * Findings a model judged not to be defects.
 *
 * Printed, not hidden. The whole value of letting a model drop findings is that somebody can see
 * which ones it dropped and why — a suppression you cannot read is indistinguishable from a check
 * that quietly stopped working.
 */
function outputSuppressed(audit: WorkspaceAudit): void {
  if (audit.suppressed.length === 0) {
    return
  }
  const c = getChalk()

  output(c.bold('Suppressed by triage'))
  for (const issue of audit.suppressed.slice(0, MAX_LISTED_ROWS)) {
    const reason = typeof issue.details?.verdictReason === 'string' ? issue.details.verdictReason : 'no reason given'
    output(`  ${c.dim('·')} ${c.dim(issue.code)} ${issue.projectName} · ${issue.notebookName || issue.path}`)
    output(c.dim(`      ${reason}`))
  }
  const more = remainder(audit.suppressed.length, Math.min(audit.suppressed.length, MAX_LISTED_ROWS))
  if (more) {
    output(c.dim(more))
  }
  output(c.dim('These are out of the ranking but still in -o json, under "suppressed".'))
  output('')
}

/** What the run could not establish. Printed every time: an audit that hides its blind spots
 *  reads as a clean bill of health. */
function outputNotes(audit: WorkspaceAudit): void {
  const c = getChalk()
  if (audit.errors.length > 0) {
    output(
      c.yellow(
        `${plural(audit.errors.length, 'file')} could not be parsed and ${audit.errors.length === 1 ? 'was' : 'were'} skipped:`
      )
    )
    for (const error of audit.errors.slice(0, MAX_LISTED_ROWS)) {
      output(c.dim(`  ${error.path}: ${error.message}`))
    }
    output('')
  }
  for (const note of audit.notes) {
    output(c.dim(note))
  }
}
