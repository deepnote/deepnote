/**
 * Project-scoped governance checks.
 *
 * These answer "what is wrong inside this project" from the project file alone: queries that are
 * silently wrong, credentials written into blocks, and dependencies that will not install the same
 * twice. They run under `deepnote lint --governance`, so they are per-file, deterministic, and need
 * neither the network nor a Python interpreter.
 *
 * The scope split is deliberate and load-bearing. The questions governance also wants answered —
 * is this metric defined two different ways, how many *live* projects read this table, whose
 * personal data is scattered across which notebooks — are consensus questions, and consensus over
 * one project is not evidence. Rather than return a confidently empty answer, this module reports
 * what its scope can actually support and says so in the summary.
 */

import type { DeepnoteBlock } from '@deepnote/blocks'
import type { BlockInfo, IssueSeverity, LintIssue } from '../analysis'
import { collectDependencies, type PackageEntry, type ProjectEnvironment, reconcile } from './dependencies'
import { integrationTypesById, resolveDialect } from './dialect'
import { findSecrets, redactSecrets, redactSecretsWithContext, type SecretFinding } from './secrets'
import { checkSqlQuery } from './sql-checks'
import { redactSubjects } from './subjects'

export type { ProjectEnvironment } from './dependencies'
export { fingerprintSecret, redactSecrets, redactSecretsWithContext } from './secrets'

/** Every code this module can emit, in report order. */
export const GOVERNANCE_CHECK_CODES = [
  'sql-null-comparison',
  'sql-tautology',
  'sql-string-boolean',
  'credential-hardcoded',
  'dependency-unpinned',
  'dependency-untracked',
] as const

export type GovernanceCheckCode = (typeof GOVERNANCE_CHECK_CODES)[number]

/** Checks that are defined but need the whole synced workspace, so a single project cannot run them. */
export const WORKSPACE_SCOPED_CHECKS = [
  'sql-divergence',
  'dependency-drift',
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
  /** The project's dependency set: a small SBOM, and how much of it is reproducible. */
  dependencies: {
    total: number
    pinned: number
    ranged: number
    unpinned: number
    /** Installed by a block but absent from `environment.packages`. */
    untracked: number
  }
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
  // A reproducibility risk rather than a defect: an unpinned notebook runs correctly today. It is
  // the day it stops, with no diff to blame, that this is about.
  'dependency-unpinned': 'warning',
  'dependency-untracked': 'warning',
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
 *
 * Subjects as well as secrets: `WHERE 'jane@acme.io' = NULL` is the same shape as
 * `WHERE 'AKIA…' = NULL`, and a scatter finding that withholds a subject's fingerprint by design
 * must not name them in the evidence beside it.
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
 *
 * Personal identifiers go the same way as credentials. `owner = "jane@acme.io"` is a label that
 * names the person a `pii-subject-scatter` finding is about, in the field beside the fingerprint
 * that exists so it need not be named.
 */
export function safeBlockLabel(block: DeepnoteBlock, label: string): string {
  return redactSubjects(redactSecretsWithContext(label, blockContent(block)))
}

/** What a string withheld for holding a credential is replaced with. */
const WITHHELD = '<redacted>'

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
  const scrub = (text: string): string => redactSubjects(redactSecretsWithContext(text, content))
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    redacted[key] = typeof value === 'string' ? scrub(value) : value
  }

  // One exception to masking in place. The snippet spans a whole comparison, so it can hold two
  // credentials — and the scanner only recognizes some kinds. `'AKIA…' = '<slack webhook>'` has
  // its AWS key masked and its webhook published, because no pattern matches a webhook URL.
  //
  // Once the evidence is known to contain *a* credential, the rest of it is not text to be
  // trusted. Withholding the snippet in that case costs the shape of one comparison and keeps
  // its code, line and column; publishing it costs a credential. Detected by whether masking
  // changed the text, rather than by re-scanning the snippet, so a credential only recognizable
  // with the surrounding block around it counts too.
  const snippet = typeof details.snippet === 'string' ? details.snippet : undefined
  if (snippet !== undefined && redacted.snippet !== snippet) {
    redacted.snippet = WITHHELD
    return { message: scrub(message.split(snippet).join(WITHHELD)), details: redacted }
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
  integrations?: ReadonlyArray<{ id: string; type?: string }>,
  environment?: ProjectEnvironment
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
    // nothing and forgetting it once costs a credential or somebody's address.
    //
    // The same reasoning covers a SQL finding's evidence, for a less obvious reason: the snippet
    // spans only the flagged comparison, but a literal that is itself an operand of that comparison
    // is inside the span — `WHERE 'AKIA…' = NULL`, `WHERE owner = 'jane@acme.io'`. The message
    // quotes the snippet verbatim, so both go through the scanner.
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

  const dependencies = checkDependencies(environment, blocks, blockMap)
  issues.push(...dependencies.issues)

  return {
    issues,
    summary: {
      scope: 'project',
      checks: [...GOVERNANCE_CHECK_CODES],
      scanned: { sqlBlocks, contentBlocks },
      credentialFingerprints: [...secretsByFingerprint.keys()].sort(),
      dependencies: dependencies.summary,
      note: WORKSPACE_SCOPE_NOTE,
    },
  }
}

/** Notebook heading the project-level dependency findings are filed under. */
const ENVIRONMENT_SCOPE = 'Project environment'

/** Where a declaration lives, named the way the file names it. */
const SOURCE_LABEL = {
  environment: 'environment.packages',
  requirements: 'settings.requirements',
  'install-command': 'a block',
} as const

/** How the declaration responsible for a finding should be described. */
function blameLabel(entry: PackageEntry): string {
  const source = entry.weakestSource ?? entry.sources[entry.sources.length - 1]
  return source === 'install-command' ? 'installed by a block' : `declared in ${SOURCE_LABEL[source]}`
}

/**
 * The dependency checks: is this project's dependency set reproducible, and is all of it declared.
 *
 * Both are per-file, which is why they live here rather than in the audit — a CI job that gates on
 * an unpinned dependency has one project in scope and needs no workspace.
 */
function checkDependencies(
  environment: ProjectEnvironment | undefined,
  blocks: DeepnoteBlock[],
  blockMap: Map<string, BlockInfo>
): { issues: LintIssue[]; summary: GovernanceSummary['dependencies'] } {
  const collected = collectDependencies(environment, blocks)
  const entries = reconcile(collected.requirements)
  const issues: LintIssue[] = []
  let untracked = 0

  for (const entry of entries) {
    // Where to file it: the install command's block when there is one, otherwise the project's
    // declared environment, which belongs to no notebook.
    // Attribute the finding to the declaration that caused it: an install command's block when
    // that is what broke the pin, and the project's declared environment otherwise.
    const blamesBlock = entry.weakestSource === 'install-command' && entry.blockId !== undefined
    const info = blamesBlock ? blockMap.get(entry.blockId as string) : undefined
    const where = {
      blockId: info ? (entry.blockId as string) : '',
      blockLabel: info ? redactSubjects(redactSecrets(info.label)) : SOURCE_LABEL[entry.weakestSource ?? 'environment'],
      notebookName: info?.notebookName ?? ENVIRONMENT_SCOPE,
    }

    if (entry.pin !== 'pinned') {
      const asked = `"${entry.rawName}${entry.specifier ?? ''}"`
      // A resolved version alongside an unpinned finding means the lockfile has one but something
      // re-installs the package anyway — worth stating, since it looks pinned from the file.
      const resolved = entry.versions.length > 0 ? ` The environment resolves it to ${entry.versions.join(', ')}.` : ''
      issues.push({
        severity: SEVERITY_BY_CODE['dependency-unpinned'],
        code: 'dependency-unpinned',
        message: `${asked}, ${blameLabel(entry)}, is not pinned to an exact version, so this project may install something different tomorrow.${resolved}`,
        ...where,
        details: {
          package: entry.name,
          pin: entry.pin,
          sources: entry.sources,
          ...(entry.weakestSource ? { declaredIn: entry.weakestSource } : {}),
          ...(entry.specifier ? { specifier: entry.specifier } : {}),
          ...(entry.versions.length > 0 ? { resolvedVersions: entry.versions } : {}),
          ...(entry.line ? { line: entry.line } : {}),
        },
      })
    }

    // Only meaningful against a resolved environment: with no `environment.packages` at all,
    // everything is "untracked" and the finding would say nothing.
    if (collected.hasEnvironment && entry.sources.includes('install-command') && !collected.tracked.has(entry.name)) {
      untracked++
      const installInfo = entry.blockId ? blockMap.get(entry.blockId) : undefined
      issues.push({
        severity: SEVERITY_BY_CODE['dependency-untracked'],
        code: 'dependency-untracked',
        message: `"${entry.rawName}" is installed by a block but is not in environment.packages, so it is missing from every inventory built from this project and is re-installed on every run.`,
        blockId: installInfo ? (entry.blockId as string) : '',
        blockLabel: installInfo ? redactSubjects(redactSecrets(installInfo.label)) : SOURCE_LABEL['install-command'],
        notebookName: installInfo?.notebookName ?? ENVIRONMENT_SCOPE,
        details: {
          package: entry.name,
          pin: entry.pin,
          ...(entry.line ? { line: entry.line } : {}),
        },
      })
    }
  }

  return {
    issues,
    summary: {
      total: entries.length,
      pinned: entries.filter(entry => entry.pin === 'pinned').length,
      ranged: entries.filter(entry => entry.pin === 'ranged').length,
      unpinned: entries.filter(entry => entry.pin === 'unpinned').length,
      untracked,
    },
  }
}
