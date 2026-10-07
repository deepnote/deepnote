/**
 * Project-scoped governance checks.
 *
 * These answer "what is wrong inside this project" from the project file alone: queries that are
 * silently wrong, and credentials written into blocks. They run under `deepnote lint --governance`,
 * so they are per-file, deterministic, and need neither the network nor a Python interpreter.
 *
 * The scope split is deliberate and load-bearing. The questions governance also wants answered —
 * is this metric defined two different ways, how many *live* projects read this table, whose
 * personal data is scattered across which notebooks — are consensus questions, and consensus over
 * one project is not evidence. Rather than return a confidently empty answer, this module reports
 * what its scope can actually support and says so in the summary.
 */

import type { DeepnoteBlock } from '@deepnote/blocks'
import type { BlockInfo, IssueSeverity, LintIssue } from '../analysis'
import { findSecrets, type SecretFinding } from './secrets'
import { checkSqlQuery } from './sql-checks'

export { fingerprintSecret } from './secrets'

/** Every code this module can emit, in report order. */
export const GOVERNANCE_CHECK_CODES = [
  'sql-null-comparison',
  'sql-tautology',
  'sql-string-boolean',
  'credential-hardcoded',
] as const

export type GovernanceCheckCode = (typeof GOVERNANCE_CHECK_CODES)[number]

/** Checks that are defined but need the whole synced workspace, so a single project cannot run them. */
export const WORKSPACE_SCOPED_CHECKS = [
  'sql-divergence',
  'pii-subject-scatter',
  'egress-external',
  'asset-stale',
] as const

export const WORKSPACE_SCOPE_NOTE =
  'Project scope: divergence, subject scatter, egress and staleness compare projects against each other and need the whole synced workspace.'

export interface GovernanceSummary {
  /** Always `project` here — the workspace-scoped surface reports its own scope. */
  scope: 'project'
  /** Codes that ran. */
  checks: GovernanceCheckCode[]
  /** How many blocks each family of checks actually looked at. */
  scanned: { sqlBlocks: number; contentBlocks: number }
  /** Distinct credential fingerprints found, so a reused key is counted once. */
  credentialFingerprints: string[]
  /** Why a single project cannot answer the workspace-scoped questions. */
  note: string
}

export interface GovernanceResult {
  issues: LintIssue[]
  summary: GovernanceSummary
}

/** Severity per code. The SQL correctness checks decide from the query alone, so they are errors. */
const SEVERITY_BY_CODE: Record<GovernanceCheckCode, IssueSeverity> = {
  'sql-null-comparison': 'error',
  'sql-tautology': 'error',
  // Dialect-dependent rather than universally wrong: the query may well do what its author meant
  // against the warehouse it was written for.
  'sql-string-boolean': 'warning',
  'credential-hardcoded': 'error',
}

/** Blocks whose content is prose. Scanned for credential patterns, but not with the heuristic rule. */
const PROSE_BLOCK_TYPES = new Set([
  'markdown',
  'text-cell-h1',
  'text-cell-h2',
  'text-cell-h3',
  'text-cell-p',
  'text-cell-bullet',
  'text-cell-todo',
  'text-cell-callout',
])

/** Blocks that hold executable source, where a string literal that looks like a key usually is one. */
const SOURCE_BLOCK_TYPES = new Set(['code', 'sql', 'notebook-function'])

function blockContent(block: DeepnoteBlock): string {
  return typeof (block as { content?: unknown }).content === 'string' ? (block as { content: string }).content : ''
}

function integrationIdOf(block: DeepnoteBlock): string | undefined {
  const id = (block.metadata as Record<string, unknown> | undefined)?.sql_integration_id
  return typeof id === 'string' ? id : undefined
}

/**
 * Run the project-scoped governance checks over `blocks`.
 *
 * `blockMap` supplies the notebook and label each issue is reported against; blocks missing from it
 * are skipped, matching how the other lint checks treat a block they cannot locate.
 */
export function runProjectGovernanceChecks(
  blocks: DeepnoteBlock[],
  blockMap: Map<string, BlockInfo>
): GovernanceResult {
  const issues: LintIssue[] = []
  const secretsByFingerprint = new Map<
    string,
    { blockIds: Set<string>; findings: Array<{ block: DeepnoteBlock; info: BlockInfo; finding: SecretFinding }> }
  >()
  let sqlBlocks = 0
  let contentBlocks = 0

  for (const block of blocks) {
    const info = blockMap.get(block.id)
    const content = blockContent(block)
    if (!info || content.trim() === '') {
      continue
    }

    if (block.type === 'sql') {
      sqlBlocks++
      const integrationId = integrationIdOf(block)
      for (const finding of checkSqlQuery(content)) {
        issues.push({
          severity: SEVERITY_BY_CODE[finding.code],
          code: finding.code,
          message: finding.message,
          blockId: block.id,
          blockLabel: info.label,
          notebookName: info.notebookName,
          details: {
            line: finding.line,
            column: finding.column,
            snippet: finding.snippet,
            ...(integrationId ? { integrationId } : {}),
            ...finding.details,
          },
        })
      }
    }

    const isSource = SOURCE_BLOCK_TYPES.has(block.type)
    if (!isSource && !PROSE_BLOCK_TYPES.has(block.type)) {
      continue
    }
    contentBlocks++

    for (const finding of findSecrets(content, { includeHeuristic: isSource })) {
      const entry = secretsByFingerprint.get(finding.fingerprint) ?? { blockIds: new Set<string>(), findings: [] }
      entry.blockIds.add(block.id)
      entry.findings.push({ block, info, finding })
      secretsByFingerprint.set(finding.fingerprint, entry)
    }
  }

  // Credentials are reported after every block has been seen, so each finding can state how widely
  // the same secret is reused — the number that decides whether rotating it is a one-line fix.
  for (const [fingerprint, entry] of secretsByFingerprint) {
    for (const { block, info, finding } of entry.findings) {
      const where = finding.variable ? ` assigned to "${finding.variable}"` : ''
      const reuse =
        entry.blockIds.size > 1 ? ` The same credential appears in ${entry.blockIds.size} blocks in this project.` : ''
      issues.push({
        severity: finding.confidence === 'pattern' ? SEVERITY_BY_CODE['credential-hardcoded'] : 'warning',
        code: 'credential-hardcoded',
        message: `${finding.kind}${where} is hardcoded in this block (fingerprint ${fingerprint}). Move it to an environment variable or an integration.${reuse}`,
        blockId: block.id,
        blockLabel: info.label,
        notebookName: info.notebookName,
        details: {
          kind: finding.kind,
          confidence: finding.confidence,
          fingerprint,
          line: finding.line,
          blockCount: entry.blockIds.size,
          ...(finding.variable ? { variable: finding.variable } : {}),
        },
      })
    }
  }

  return {
    issues,
    summary: {
      scope: 'project',
      checks: [...GOVERNANCE_CHECK_CODES],
      scanned: { sqlBlocks, contentBlocks },
      credentialFingerprints: [...secretsByFingerprint.keys()].sort(),
      note: WORKSPACE_SCOPE_NOTE,
    },
  }
}
