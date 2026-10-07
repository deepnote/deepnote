import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, isErrnoENOENT } from '../utils/file-resolver'
import { type AuditIssue, auditWorkspace, scrubText, type WorkspaceAudit } from '../utils/governance/audit'
import { scoreOutOf100 } from '../utils/governance/scoring'
import { COLD_DAYS, formatAge } from '../utils/governance/staleness'
import { loadWorkspace } from '../utils/governance/workspace'

export interface AuditOptions {
  output?: 'json'
  project?: string
  issues?: boolean
  internalDomain?: string[]
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

      const audit = auditWorkspace(workspace, {
        project: options.project,
        internalDomains: options.internalDomain,
      })

      if (options.output === 'json') {
        outputJson(audit)
      } else {
        outputAudit(audit, options)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** `plural` appends an `s`, which "person" does not take. */
function people(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
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
  outputEgress(audit)
  outputSubjects(audit)
  outputSharedCredentials(audit)
  outputStaleness(audit)
  outputIssues(audit, options)
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
  for (const table of shown) {
    // Both numbers, always. The raw count is the one people quote; the live count is the one that
    // is true, and printing them together is what stops a blast radius being read as 8× its size.
    const reach =
      table.liveProjectCount === table.projectCount
        ? `${plural(table.projectCount, 'project')}`
        : `${table.liveProjectCount} live of ${plural(table.projectCount, 'project')}`
    output(`  ${table.name} ${c.dim(`— ${reach}, ${plural(table.blockCount, 'SQL block')}`)}`)
  }
  const more = remainder(audit.tables.length, shown.length)
  if (more) {
    output(c.dim(more))
  }
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
    for (const issue of audit.issues.slice(0, MAX_LISTED_ISSUES)) {
      const isError = issue.severity === 'error'
      const score = String(scoreOutOf100(issue.score)).padStart(3)
      output(
        `  ${c.bold(score)} ${isError ? c.red('✖') : c.yellow('⚠')} ${isError ? c.red(issue.code) : c.yellow(issue.code)}`
      )
      output(`      ${c.dim(`${issue.projectName} · ${issue.notebookName || issue.path}`)} ${issue.message}`)
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
