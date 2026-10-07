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
import { integrationTypesById, resolveDialect } from './dialect'
import { findSecrets, redactSecretsWithContext, type SecretFinding } from './secrets'
import { checkSqlQuery } from './sql-checks'

export { fingerprintSecret, redactSecrets, redactSecretsWithContext } from './secrets'

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

/**
 * Every string a SQL finding carries out of the block, with credentials masked.
 *
 * Three fields leaked here in turn before this existed — the block label, the snippet, and
 * `details.column` — each found separately because each was reasoned about separately. They have
 * one cause: every one of them is derived from block text, and block text is where credentials are.
 * So this does not name the fields it protects. It walks the finished details object, and a key
 * added to a check tomorrow is covered without anyone remembering to come back here.
 *
 * Masking in place rather than withholding, which is what this had to do before `redactSecrets`
 * could locate the span: `'<redacted>' = NULL` keeps the shape of the comparison, which is the part
 * of the evidence worth reading.
 *
 * Masked against the whole block, not against each field alone. Half the provider patterns need
 * surrounding context, so a URI password reused as a column name is invisible to a scan of that
 * column name by itself. The block is the evidence; a field lifted out of it is not.
 */
/**
 * Scan a block for credentials under the rules its type warrants.
 *
 * The heuristic rule — a long literal assigned to a secret-looking name — is applied only to
 * blocks holding executable source, where such a literal usually is a key. In prose it is usually
 * an example.
 */
export function findBlockSecrets(block: DeepnoteBlock): SecretFinding[] {
  const content = blockContent(block)
  if (content.trim() === '') {
    return []
  }
  const isSource = SOURCE_BLOCK_TYPES.has(block.type)
  if (!isSource && !PROSE_BLOCK_TYPES.has(block.type)) {
    return []
  }
  return findSecrets(content, { includeHeuristic: isSource })
}

/**
 * The label any lint rule may use for `block`, given the content-derived `label` it would use.
 *
 * Whether a block holds a credential decides what may be quoted about it, and that decision cannot
 * belong to the rule doing the quoting. `credential-hardcoded` reports a fingerprint precisely so
 * the secret need not be written down — but it is one rule among many reporting the same block
 * into the same output, and a sibling rule quoting the block's first line publishes what the
 * fingerprint was protecting. `unused-variable` on a one-line `TOKEN = "…"` assignment does
 * exactly that.
 *
 * So the lint layer resolves every block's label through here before any rule sees it, rather than
 * each rule remembering. This is deliberately not gated on `--governance`: the leak is a property
 * of the block, not of which checks were asked for.
 *
 * Masked in place rather than replaced wholesale. The label is what makes a finding locatable in a
 * notebook, so `SEGMENT_WRITE_KEY = "<redacted>"` is worth strictly more than the block's type and
 * id, and `redactSecretsWithContext` can locate the span exactly. Masked against the whole block
 * rather than the one line, because half the provider patterns need surrounding context: a URI
 * password is recognizable in `postgres://admin:…@host/db` and unrecognizable on its own.
 */
export function safeBlockLabel(block: DeepnoteBlock, label: string): string {
  return redactSecretsWithContext(label, blockContent(block))
}

/**
 * Every string a SQL finding carries out of the block, with credentials masked.
 *
 * Three fields leaked here in turn before this existed — the block label, the snippet, and
 * `details.column` — each found separately because each was reasoned about separately. They have
 * one cause: every one of them is derived from block text, and block text is where credentials are.
 * So this does not name the fields it protects. It walks the finished details object, and a key
 * added to a check tomorrow is covered without anyone remembering to come back here.
 *
 * Masking in place rather than withholding, which is what this had to do before `redactSecrets`
 * could locate the span: `'<redacted>' = NULL` keeps the shape of the comparison, which is the part
 * of the evidence worth reading.
 *
 * Masked against the whole block, not against each field alone. Half the provider patterns need
 * surrounding context, so a URI password reused as a column name is invisible to a scan of that
 * column name by itself. The block is the evidence; a field lifted out of it is not.
 */
function redactSqlFinding(
  message: string,
  details: Record<string, unknown>,
  content: string
): { message: string; details: Record<string, unknown> } {
  const scrub = (text: string): string => redactSecretsWithContext(text, content)
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    redacted[key] = typeof value === 'string' ? scrub(value) : value
  }
  return { message: scrub(message), details: redacted }
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
  blockMap: Map<string, BlockInfo>,
  integrations?: ReadonlyArray<{ id: string; type?: string }>
): GovernanceResult {
  // The project's integration list is what turns `sql_integration_id` into a dialect. Absent it
  // every block resolves to the unknown dialect, which is the silent-rather-than-guessing default.
  const typesById = integrationTypesById(integrations)
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

    const isScannable = SOURCE_BLOCK_TYPES.has(block.type) || PROSE_BLOCK_TYPES.has(block.type)
    const secretFindings = findBlockSecrets(block)

    // The lint layer already resolved `info.label` through `safeBlockLabel`, so this is a no-op on
    // the normal path. It is re-derived anyway because `runProjectGovernanceChecks` is exported and
    // callers build their own block maps; the redaction is idempotent, so paying for it twice costs
    // nothing and forgetting it once costs a credential.
    //
    // The same reasoning covers a SQL finding's evidence, for a less obvious reason: the snippet
    // spans only the flagged comparison, but a literal that is itself an operand of that comparison
    // is inside the span — `WHERE 'AKIA…' = NULL`. The message quotes the snippet verbatim, so both
    // go through the scanner.
    const label = safeBlockLabel(block, info.label)

    if (block.type === 'sql') {
      sqlBlocks++
      const integrationId = integrationIdOf(block)
      const dialect = resolveDialect(integrationId, typesById)
      for (const finding of checkSqlQuery(content, dialect)) {
        const safe = redactSqlFinding(
          finding.message,
          {
            line: finding.line,
            column: finding.column,
            snippet: finding.snippet,
            ...(integrationId ? { integrationId } : {}),
            ...finding.details,
          },
          content
        )
        issues.push({
          severity: SEVERITY_BY_CODE[finding.code],
          code: finding.code,
          message: safe.message,
          blockId: block.id,
          blockLabel: label,
          notebookName: info.notebookName,
          details: safe.details,
        })
      }
    }

    if (!isScannable) {
      continue
    }
    contentBlocks++

    for (const finding of secretFindings) {
      const entry = secretsByFingerprint.get(finding.fingerprint) ?? { blockIds: new Set<string>(), findings: [] }
      entry.blockIds.add(block.id)
      entry.findings.push({ block, info: { ...info, label }, finding })
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
