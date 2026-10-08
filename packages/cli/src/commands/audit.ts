import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, isErrnoENOENT } from '../utils/file-resolver'
import { type AuditIssue, auditWorkspace, type WorkspaceAudit } from '../utils/governance/audit'
import { loadWorkspace } from '../utils/governance/workspace'

export interface AuditOptions {
  output?: 'json'
  project?: string
  issues?: boolean
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
        const available = workspace.projects.map(p => `"${p.name}"`).join(', ')
        throw new FileResolutionError(
          available
            ? `Project "${options.project}" not found in ${root}. Available projects: ${available}`
            : `Project "${options.project}" not found: no .deepnote files under ${root}`
        )
      }

      const audit = auditWorkspace(workspace, { project: options.project })

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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
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
  outputEgress(audit)
  outputSharedCredentials(audit)
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
    // characters, and colouring them first would make `padEnd` count the escape codes.
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

function outputIssues(audit: WorkspaceAudit, options: AuditOptions): void {
  const c = getChalk()
  if (audit.issues.length === 0) {
    output(c.green('✓ No findings'))
    output('')
    return
  }

  const byCode = new Map<string, AuditIssue[]>()
  for (const issue of audit.issues) {
    byCode.set(issue.code, [...(byCode.get(issue.code) ?? []), issue])
  }
  const ordered = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  output(c.bold('Findings'))
  for (const [code, codeIssues] of ordered) {
    const isError = codeIssues[0].severity === 'error'
    const icon = isError ? c.red('✖') : c.yellow('⚠')
    const projectCount = new Set(codeIssues.map(issue => issue.projectId)).size
    output(
      `  ${icon} ${isError ? c.red(code) : c.yellow(code)}: ${codeIssues.length} in ${plural(projectCount, 'project')}`
    )
    if (options.issues) {
      for (const issue of codeIssues.slice(0, MAX_LISTED_ISSUES)) {
        output(`      ${c.dim(`${issue.projectName} · ${issue.notebookName || issue.path}`)} ${issue.message}`)
      }
      const more = remainder(codeIssues.length, Math.min(codeIssues.length, MAX_LISTED_ISSUES))
      if (more) {
        output(c.dim(`    ${more.trim()}`))
      }
    }
  }
  output('')

  const parts: string[] = []
  if (audit.issueCount.errors > 0) {
    parts.push(c.red(plural(audit.issueCount.errors, 'error')))
  }
  if (audit.issueCount.warnings > 0) {
    parts.push(c.yellow(plural(audit.issueCount.warnings, 'warning')))
  }
  output(`${c.bold('Summary:')} ${parts.join(', ')}`)
  if (!options.issues) {
    output(c.dim('Run with --issues to list each finding, or -o json for the full report.'))
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
