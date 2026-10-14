/**
 * The workspace-scoped governance pass.
 *
 * `deepnote lint --governance` answers what one project can answer alone. This answers the two
 * questions that only exist once the whole synced tree is in scope:
 *
 *   - **What do I have?** Every native integration, which projects read it, and which are declared
 *     but used by nobody — the orphans that keep a credential alive for a pipeline that is gone.
 *   - **Where does my data go?** Every third-party host a notebook writes to, recovered from the
 *     code, plus every credential that appears in more than one project.
 *
 * The result is a flow map — integrations feed projects, projects reach external hosts — and a
 * ranked list of findings over the same `LintIssue` shape the lint command already emits.
 */

import crypto from 'node:crypto'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { getSqlEnvVarName, isBuiltinIntegration } from '@deepnote/database-integrations'
import type { BlockInfo, LintIssue } from '../analysis'
import { getBlockLabel } from '../block-label'
import { collectDependencies, type PackageEntry, type PinState, packageUrl, reconcile } from './dependencies'
import { findExternalEndpoints } from './egress'
import { redactSecrets, runProjectGovernanceChecks } from './index'
import { type SeverityScore, scoreFinding } from './scoring'
import {
  DEFAULT_MIN_CONFIDENCE,
  type DivergenceGroup,
  type DivergenceKind,
  type DivergenceScope,
  dissenters,
  divergenceSignal,
  findDivergence,
  type QueryObservation,
} from './sql-divergence'
import { extractQueryFacts } from './sql-facts'
import { canonicalTableKey, findTableReferences, UNKNOWN_INTEGRATION_SCOPE } from './sql-tables'
import { type AssetAge, assetAge, formatAge, medianAgeDays } from './staleness'
import { buildSubjectIndex, SCATTER_NOTEBOOK_THRESHOLD } from './subject-index'
import { createSubjectFingerprinter, redactSubjects } from './subjects'
import { type TriageResult, toCandidate, VERDICT_SIGNAL } from './triage'
import { type LoadedWorkspace, projectBlocks, type WorkspaceLoadError, type WorkspaceProject } from './workspace'

/** A lint issue, placed in the workspace it was found in and ranked against the rest. */
export interface AuditIssue extends LintIssue {
  projectId: string
  projectName: string
  /** Workspace-root-relative path of the file the issue was found in. */
  path: string
  /** Severity and the four factors it is built from, so the ranking can be taken apart. */
  score: SeverityScore
}

/**
 * An issue before it is scored. Three of the four severity factors — neglect, and both halves of
 * blast radius — are only knowable once the whole workspace has been read, so findings are collected
 * unscored and ranked in one pass at the end.
 */
type PendingAuditIssue = Omit<AuditIssue, 'score'> & { score?: SeverityScore }

/** One project's use of an integration. */
export interface IntegrationConsumer {
  projectId: string
  projectName: string
  /** SQL blocks in this project that run against the integration. */
  blockCount: number
  /** The project declares the integration in its `project.integrations`. */
  declared: boolean
}

export interface IntegrationUsage {
  id: string
  /** Name as declared. Absent when only a block's `sql_integration_id` revealed the integration. */
  name?: string
  type?: string
  consumers: IntegrationConsumer[]
  /** SQL blocks running against this integration across the workspace. */
  blockCount: number
  /** Declared by at least one project and used by none. */
  orphan: boolean
  /** Projects querying it that were edited within the past year — the reach that is actually live. */
  liveProjectCount: number
}

/** A table referenced by the workspace's SQL, and how much live work depends on it. */
export interface TableUsage {
  /** The table's short name, lower-cased: `users` for `analytics.public.users`. */
  name: string
  /**
   * The integration this row is scoped to, or `unknown` for blocks that declare none.
   *
   * A `users` behind two warehouses is two rows, because it is two tables.
   */
  integrationId: string
  /**
   * Every qualified spelling seen for this table, sorted. `['users']` when nobody qualified it.
   *
   * Present so that merging `analytics.users` with a bare `users` is visible rather than silent —
   * two schemas behind one integration will show up here as two entries on one row.
   */
  qualifiedNames: string[]
  /** Projects whose SQL references it. */
  projectCount: number
  /** Of those, the ones edited within the past year. */
  liveProjectCount: number
  /** SQL blocks referencing it. */
  blockCount: number
  projects: Array<{ projectId: string; projectName: string; live: boolean }>
}

/** How much of the workspace is still being maintained. */
export interface StalenessSummary {
  /** Notebooks whose file carries a usable timestamp. */
  dated: number
  live: number
  aging: number
  /** Untouched for three years or more. */
  cold: number
  /** Notebooks with no timestamp to judge by. */
  unknown: number
  /** Median age in days across dated notebooks. */
  medianAgeDays?: number
}

export interface EgressUsage {
  host: string
  scheme: string
  /** The strongest direction observed: a host written to anywhere counts as a write. */
  direction: 'write' | 'read' | 'unknown'
  projects: Array<{ projectId: string; projectName: string; blockCount: number }>
  blockCount: number
}

export interface CredentialUsage {
  fingerprint: string
  kinds: string[]
  projects: Array<{ projectId: string; projectName: string }>
  blockCount: number
}

/** One package across the whole workspace: who installs it, and at which versions. */
export interface PackageUsage {
  /** Normalized name (PEP 503). */
  name: string
  /** The name as the projects write it. */
  rawName: string
  /** Every exact version pinned anywhere, sorted. */
  versions: string[]
  /** The weakest pin any project holds it at — the one that decides reproducibility. */
  pin: PinState
  /** A PyPI package URL, which is what an SBOM consumer matches advisories against. */
  purl: string
  projects: Array<{
    projectId: string
    projectName: string
    pin: PinState
    version?: string
    /** Whether the project is still maintained — only these count towards drift. */
    live: boolean
  }>
  /** Maintained projects pinning it to two or more different exact versions. */
  drifted: boolean
  /** The versions those maintained projects pin, sorted. This is what drift is measured on. */
  maintainedVersions: string[]
}

export type FlowNodeKind = 'integration' | 'project' | 'host'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  label: string
  /** Secondary label: an integration's type, or a host's scheme. */
  detail?: string
}

export interface FlowEdge {
  from: string
  to: string
  /** `reads`: integration into project. `writes` / `calls`: project out to a host. */
  kind: 'reads' | 'writes' | 'calls'
  blockCount: number
}

/** How many people the workspace holds data about, and how widely each is spread. */
export interface SubjectSummary {
  /** Distinct people identified across the workspace. */
  total: number
  /** Those whose domain is not one of `--internal-domain`. */
  external: number
  /** Those appearing in more than one notebook. */
  scattered: number
  /** Places a subject identifier was found. */
  locations: number
  /** Domains used to tell colleagues from customers; empty when none were given. */
  internalDomains: string[]
}

export interface WorkspaceAudit {
  root: string
  scope: 'workspace'
  summary: {
    projects: number
    notebooks: number
    blocks: number
    sqlBlocks: number
    codeBlocks: number
  }
  integrations: IntegrationUsage[]
  tables: TableUsage[]
  /** Anchors the workspace disagrees on, best-attested first. Every variant and location included,
   *  so the precision of this check can be measured rather than asserted. */
  divergence: DivergenceGroup[]
  /** Findings a model judged not to be defects. Kept out of the ranking and in the report, so the
   *  suppression is inspectable rather than just a smaller number. */
  suppressed: AuditIssue[]
  egress: EgressUsage[]
  staleness: StalenessSummary
  /** Credentials found in more than one project. Within-project reuse is a lint-level finding. */
  credentials: CredentialUsage[]
  /** The workspace's dependency set — a software bill of materials, one row per package. */
  packages: PackageUsage[]
  subjects: SubjectSummary
  flow: { nodes: FlowNode[]; edges: FlowEdge[] }
  issues: AuditIssue[]
  issueCount: { errors: number; warnings: number; total: number }
  /** Files that could not be parsed. */
  errors: WorkspaceLoadError[]
  /** What this run could and could not establish, given the workspace it saw. */
  notes: string[]
}

export interface AuditOptions {
  /** Restrict the audit to one project, matched by name or id. */
  project?: string
  /** Skip the consensus checks entirely. They are the only ones whose precision is unvalidated. */
  divergence?: boolean
  /** Anchor families to look for. Defaults to all three. */
  divergenceKinds?: DivergenceKind[]
  /** How strictly two queries must share a warehouse before they are compared. */
  divergenceScope?: DivergenceScope
  /** Precision measured from a reviewed sample, per kind. Displaces the prior where present. */
  measuredPrecision?: Partial<Record<DivergenceKind, number>>
  /** Consensus confidence below which a divergence group is reported but raises no issue. */
  minConfidence?: number
  /**
   * Model verdicts by candidate id, when `--triage` ran. Absent by default, and absence means the
   * deterministic path verbatim — same findings, same order.
   */
  triage?: Map<string, TriageResult>
  /** Domains belonging to your own organization, so colleagues are not counted as data subjects. */
  internalDomains?: string[]
  /** Fixed clock, so tests and reproducible reports do not depend on the time of day. */
  now?: Date
}

/**
 * Below this many projects, cross-project consensus checks have little to measure: two queries
 * agreeing is not a convention, and the ranking they produce would be noise presented as signal.
 * Inventory and flow are unaffected — they are counts, not consensus.
 *
 * A round order-of-magnitude figure, not a measured threshold, and nothing is gated on it: below
 * the line the audit still runs the consensus checks and adds a note saying how far below it is.
 * The per-group Wilson bound is what actually discounts thin evidence.
 */
export const CONSENSUS_PROJECT_FLOOR = 100

const DIVERGENCE_SCALE_NOTE =
  `Divergence ran, but consensus thins out below roughly ${CONSENSUS_PROJECT_FLOOR} projects. ` +
  'Weight each group by its confidence rather than by the fact that it was reported.'

const DIVERGENCE_PRECISION_NOTE =
  'Divergence precision is unvalidated. Run "deepnote audit --divergence" to see every group with ' +
  'every variant and location, and judge it before acting on the ranking.'

const EGRESS_LOWER_BOUND_NOTE =
  'Egress is a lower bound: it sees hosts written into block content, not hosts assembled from variables at run time.'

const INTEGRATION_LOWER_BOUND_NOTE =
  'Integration usage counts SQL blocks inside notebooks only. dbt models, BI tools and other consumers of the same warehouse are invisible from here.'

/** Issue severities for the workspace-scoped codes. */
const SEVERITY = {
  'ingress-integration-orphan': 'warning',
  'ingress-integration-undeclared': 'warning',
  'egress-external': 'warning',
  'credential-shared': 'error',
  'pii-subject-scatter': 'warning',
  'asset-stale': 'warning',
  'dependency-drift': 'warning',
  // A warning, never an error: the check knows a query is unusual, not that it is wrong.
  'sql-divergence': 'warning',
} as const

/**
 * Mask every credential and personal identifier in one user-facing string.
 *
 * Exported because not every string the audit command prints comes out of a report. The
 * "project not found" message names the workspace root and the closest project names, and a
 * project name can be a connection string — so a mistyped `--project` printed a password into a
 * CI log, from the very helper whose comment warns about disclosing names.
 *
 * Applied whole first, then per `/`-separated segment. A URI password is only recognizable with
 * its scheme and host around it, so the whole-string pass has to come first; the segment pass then
 * catches patterns that deliberately refuse to match across a `/` — the address pattern does, so
 * that a URL's userinfo is not mistaken for a person — which is how a value buried in a filesystem
 * path or a URL would otherwise survive. Masking is idempotent, so running both costs nothing on a
 * string that holds neither.
 */
export function scrubText(text: string): string {
  const scrub = (part: string): string => redactSubjects(redactSecrets(part))
  const whole = scrub(text)
  return whole.includes('/') ? whole.split('/').map(scrub).join('/') : whole
}

/** A block's content with secrets and identifiers masked, for anything derived from it. */
function scrubContent(block: DeepnoteBlock): unknown {
  const content = (block as { content?: unknown }).content
  return typeof content === 'string' ? scrubText(content) : content
}

/**
 * Subtrees the boundary pass must leave alone, by dotted key path with `*` for an array index.
 *
 * Anything in here is a deliberate exception and needs a reason written beside it.
 *
 * `subjects.*.locations` — the subject index is sensitive *by design*. Its whole purpose is to
 * answer "which notebooks hold this person's data", and a location with the project and notebook
 * masked answers nothing; the per-subject fingerprint, not the location, is what keeps the index
 * from being a second copy of the data it indexes.
 *
 * This entry is forward-looking rather than load-bearing today: the audit report carries only
 * `SubjectSummary`, which is counts, and the index itself is written by `deepnote subjects index`
 * on a path that never reaches this function. It is declared anyway so that moving locations into
 * the report — the obvious next step for anyone wanting them in one place — does not silently
 * redact the one structure whose value is that it is not redacted. `subjects.test.ts` holds the
 * test that would catch it.
 */
const BOUNDARY_EXEMPT_PATHS = new Set<string>(['subjects.*.locations'])

function isExemptPath(path: readonly string[]): boolean {
  return BOUNDARY_EXEMPT_PATHS.has(path.join('.'))
}

/**
 * Mask every string in `value`, recursing through arrays and plain objects.
 *
 * Deliberately not a list of fields. Raw text has now escaped through four fields in turn —
 * a block label, a SQL snippet, an egress evidence URI, a suppressed finding — and each was found
 * by review rather than by design, because each was added by someone who had no reason to think of
 * that field as a place a credential or a person's name could reach. A project *name* routinely
 * contains an address, so the set of fields that can leak is not knowable in advance; what is
 * knowable is that they are all strings in one report.
 *
 * Masking a field that needed no masking is free — the scrubbers only replace what they match — so
 * the default is to cover everything and name the exceptions.
 */
function redactDeep<T>(value: T, path: readonly string[] = []): T {
  if (isExemptPath(path)) {
    return value
  }
  if (typeof value === 'string') {
    return scrubText(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map(item => redactDeep(item, [...path, '*'])) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(item, [...path, key])
    }
    return out as unknown as T
  }
  return value
}

/**
 * The single point where an assembled report becomes output.
 *
 * Must run *after* scoring. Severity is weighted by how recently an asset was touched, and the
 * scorer looks assets up by notebook name — a masked name matches nothing, and every finding would
 * silently score as though its notebook had never been edited.
 */
export function redactAuditReport(report: WorkspaceAudit): WorkspaceAudit {
  return redactDeep(report)
}

function blockMapFor(project: WorkspaceProject): Map<string, BlockInfo> {
  const map = new Map<string, BlockInfo>()
  for (const notebook of project.notebooks) {
    for (const block of notebook.blocks) {
      map.set(block.id, {
        id: block.id,
        // Labels are the block's first line, which for a credential assignment is the credential and
        // for `owner = "jane@acme.io"` is the person the finding is about. Redacting the finished
        // label is not enough on its own: `getBlockLabel` truncates to a fixed width first, so an
        // address straddling the cut is left as a surviving prefix — `jane.doe.report…` — that
        // matches no pattern. Redact the content, then label it, then redact again for the labels
        // that come from metadata rather than content.
        label: scrubText(getBlockLabel({ ...block, content: scrubContent(block) } as DeepnoteBlock)),
        type: block.type,
        notebookName: notebook.name,
        sortingKey: block.sortingKey,
      })
    }
  }
  return map
}

function sqlIntegrationIdOf(block: { type: string; metadata?: unknown }): string | undefined {
  if (block.type !== 'sql') {
    return undefined
  }
  const id = (block.metadata as Record<string, unknown> | undefined)?.sql_integration_id
  return typeof id === 'string' && id !== '' && !isBuiltinIntegration(id) ? id : undefined
}

/**
 * When a notebook was last touched.
 *
 * The file's `modifiedAt` is the baseline, but a block's recorded execution is stronger evidence:
 * a notebook that ran last week is live even if nobody edited the file. The later of the two wins.
 */
function notebookLastTouchedAt(notebook: WorkspaceProject['notebooks'][number]): string | undefined {
  let latest: string | undefined
  let latestMs = Number.NEGATIVE_INFINITY

  // An unparseable timestamp is no evidence of anything, so it is skipped rather than carried.
  // Comparing against it kept it forever — every `Date.parse(executed) > NaN` is false — so one
  // malformed `modifiedAt` made a notebook that ran last week report as undated, which is the
  // liveness the whole ranking is weighted by. The `Number.isNaN` guard also keeps a malformed
  // value from becoming the baseline; that half is defense in depth, since `assetAge` rejects an
  // unparseable date downstream either way.
  const consider = (value: unknown): void => {
    if (typeof value !== 'string') {
      return
    }
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed) || parsed <= latestMs) {
      return
    }
    latest = value
    latestMs = parsed
  }

  consider(notebook.modifiedAt)
  for (const block of notebook.blocks) {
    consider((block as { executionFinishedAt?: unknown }).executionFinishedAt)
  }
  return latest
}

/** How a SQL block's integration was determined. */
export type IntegrationSource = 'declared' | 'inferred' | 'unknown'

/**
 * The integration a SQL block runs against.
 *
 * A sizeable minority of SQL blocks carry no `sql_integration_id`. Comparing those only against
 * each other is the right default — two tables of the same name behind two connections are not
 * the same table, and guessing would merge them.
 *
 * But the ambiguity is not always there. When the project declares exactly one integration, every
 * SQL block in it runs against that one; there is nothing else for it to run against. Attributing
 * the block is then not a guess, and leaving it in the unknown bucket costs real comparisons: the
 * block is excluded from its own warehouse's consensus and pooled instead with blocks from
 * projects it has nothing to do with.
 *
 * Projects declaring none, or more than one, keep their blocks in the unknown bucket. The rule
 * that applied is recorded on every finding, so the inference is auditable rather than invisible.
 */
export function resolveBlockIntegration(
  declared: string | undefined,
  projectIntegrationIds: readonly string[]
): { id?: string; source: IntegrationSource } {
  if (declared !== undefined) {
    return { id: declared, source: 'declared' }
  }
  return projectIntegrationIds.length === 1
    ? { id: projectIntegrationIds[0], source: 'inferred' }
    : { source: 'unknown' }
}

/** `--project` matches a project by exact id, or by name case-insensitively. */
function matchesProject(project: WorkspaceProject, filter: string): boolean {
  return project.id === filter || project.name.toLowerCase() === filter.toLowerCase()
}

/** Audit a loaded workspace. Pure: no I/O, so the whole report is reproducible from the tree. */
export function auditWorkspace(workspace: LoadedWorkspace, options: AuditOptions = {}): WorkspaceAudit {
  const projects = options.project
    ? workspace.projects.filter(project => matchesProject(project, options.project as string))
    : workspace.projects

  const issues: PendingAuditIssue[] = []
  const integrations = new Map<string, IntegrationUsage>()
  const egress = new Map<string, EgressUsage>()
  const credentials = new Map<string, CredentialUsage & { blockIds: Set<string> }>()

  let notebookCount = 0
  let blockCount = 0
  let sqlBlockCount = 0
  let codeBlockCount = 0

  // Labels are kept per project so the scatter findings, which are decided after every project has
  // been scanned, can still name the block they point at.
  const blockLabelsByProject = new Map<string, Map<string, string>>()

  // Ages drive both the neglect multiplier and the liveness weighting of every blast radius, so they
  // are resolved up front, per notebook as well as per project: sync writes one file per notebook,
  // so a live project can still contain notebooks nobody has opened in four years.
  const now = options.now ?? new Date()
  /**
   * Keyed by `projectId:notebookId`. The id alone is unique only *within* a project, and this map
   * spans the workspace — two projects sharing a notebook id, which is what forking one produces,
   * had the later read overwrite the earlier. The fork's fresh age then hid the original's
   * `asset-stale` finding entirely, and `staleness` counted one notebook where there were two.
   */
  const notebookAges = new Map<string, AssetAge>()
  const notebookAgeKey = (projectId: string, notebookId: string): string => `${projectId}:${notebookId}`
  /**
   * Keyed by `projectId:notebookName`, for findings that record only the name. `undefined` marks a
   * name two notebooks share: which of them a finding sits in is then genuinely unknown, so it
   * falls back to the project's age rather than borrowing whichever was read last.
   */
  const agesByName = new Map<string, AssetAge | undefined>()
  const projectAges = new Map<string, AssetAge>()
  const tables = new Map<string, TableUsage>()
  /** Tables referenced by each block, so a SQL finding can be scored by what depends on them. */
  const tablesByBlock = new Map<string, string[]>()
  /** Every SQL block's claims, which is the corpus the consensus checks run over. */
  const observations: QueryObservation[] = []
  /** Each project's reconciled dependency set, for the workspace bill of materials. */
  const packagesByProject = new Map<string, PackageEntry[]>()

  // Integration types come from whichever project declared them; a block only carries the id.
  const declaredTypes = new Map<string, string>()
  for (const project of projects) {
    for (const integration of project.integrations) {
      if (integration.type) {
        declaredTypes.set(integration.id, integration.type)
      }
    }
  }

  for (const project of projects) {
    projectAges.set(project.id, assetAge(project.modifiedAt, now))
    for (const notebook of project.notebooks) {
      const age = assetAge(notebookLastTouchedAt(notebook), now)
      notebookAges.set(notebookAgeKey(project.id, notebook.id), age)
      const nameKey = `${project.id}:${notebook.name}`
      agesByName.set(nameKey, agesByName.has(nameKey) ? undefined : age)
    }
  }

  /** Age of the asset an issue sits in: its notebook when it has one, else its project. */
  const ageFor = (projectId: string, notebookName: string): AssetAge =>
    agesByName.get(`${projectId}:${notebookName}`) ?? projectAges.get(projectId) ?? { liveness: 'unknown' }

  for (const project of projects) {
    const blockMap = blockMapFor(project)
    const projectIsLive = projectAges.get(project.id)?.liveness === 'live'
    // A project declaring exactly one integration leaves its undeclared SQL blocks unambiguous.
    const projectIntegrationIds = project.integrations.map(integration => integration.id)
    blockLabelsByProject.set(project.id, new Map([...blockMap].map(([id, info]) => [id, info.label])))
    notebookCount += project.notebooks.length

    // Declared integrations are registered before any block is read, so an integration nobody uses
    // still appears in the inventory — being unused is the finding.
    for (const declared of project.integrations) {
      // `liveProjectCount` is recomputed from the consumers once every project has been read.
      const usage: IntegrationUsage = integrations.get(declared.id) ?? {
        id: declared.id,
        consumers: [],
        blockCount: 0,
        orphan: true,
        liveProjectCount: 0,
      }
      usage.name ??= declared.name
      usage.type ??= declared.type
      usage.consumers.push({
        projectId: project.id,
        projectName: project.name,
        blockCount: 0,
        declared: true,
      })
      integrations.set(declared.id, usage)
    }

    for (const notebook of project.notebooks) {
      for (const block of notebook.blocks) {
        blockCount++
        const content =
          typeof (block as { content?: unknown }).content === 'string' ? (block as { content: string }).content : ''

        const declaredIntegrationId = sqlIntegrationIdOf(block)
        // Blocks that name their integration keep it; blocks in a single-integration project are
        // attributed to it. Everything else stays unscoped. The tables section and the divergence
        // anchors both read this, so they continue to agree on what a table is.
        const { id: integrationId, source: integrationSource } = resolveBlockIntegration(
          declaredIntegrationId,
          projectIntegrationIds
        )
        if (block.type === 'sql') {
          sqlBlockCount++
          const referenced = findTableReferences(content)
          // Keyed through `canonicalTableKey` so that `analytics.users` and a bare `users` behind
          // the same integration are one row with one reach count — the same identity the
          // divergence anchors use, rather than a second answer to the same question.
          tablesByBlock.set(
            block.id,
            referenced.map(reference => canonicalTableKey(reference.shortName, integrationId))
          )
          for (const { name, shortName } of referenced) {
            const key = canonicalTableKey(shortName, integrationId)
            const usage = tables.get(key) ?? {
              name: shortName.toLowerCase(),
              integrationId: integrationId ?? UNKNOWN_INTEGRATION_SCOPE,
              qualifiedNames: [],
              projectCount: 0,
              liveProjectCount: 0,
              blockCount: 0,
              projects: [],
            }
            if (!usage.qualifiedNames.includes(name)) {
              usage.qualifiedNames.push(name)
              usage.qualifiedNames.sort()
            }
            if (!usage.projects.some(entry => entry.projectId === project.id)) {
              usage.projects.push({ projectId: project.id, projectName: project.name, live: projectIsLive })
              usage.projectCount++
              if (projectIsLive) {
                usage.liveProjectCount++
              }
            }
            usage.blockCount++
            tables.set(key, usage)
          }

          observations.push({
            location: {
              projectId: project.id,
              projectName: project.name,
              notebookName: notebook.name,
              path: notebook.path,
              blockId: block.id,
              blockLabel: blockMap.get(block.id)?.label ?? block.id,
              integrationSource,
            },
            // Which warehouse the query runs against. Two tables called `users` behind two
            // connections are not one subject, so the consensus checks scope on this.
            facts: extractQueryFacts(content, {
              ...(integrationId ? { integrationId } : {}),
              ...(integrationId && declaredTypes.get(integrationId)
                ? { integrationType: declaredTypes.get(integrationId) }
                : {}),
            }),
          })
        }
        // The inventory counts what a block actually names. An inferred attribution is good enough
        // to scope a comparison; it is not evidence that the block ran against the integration,
        // and counting it as usage would make an orphan look used.
        if (declaredIntegrationId) {
          const integrationId = declaredIntegrationId
          const usage: IntegrationUsage = integrations.get(integrationId) ?? {
            id: integrationId,
            consumers: [],
            blockCount: 0,
            orphan: false,
            liveProjectCount: 0,
          }
          const consumer = usage.consumers.find(entry => entry.projectId === project.id)
          if (consumer) {
            consumer.blockCount++
          } else {
            usage.consumers.push({
              projectId: project.id,
              projectName: project.name,
              blockCount: 1,
              declared: false,
            })
          }
          usage.blockCount++
          usage.orphan = false
          integrations.set(integrationId, usage)
        }

        if (block.type !== 'code') {
          continue
        }
        codeBlockCount++

        // `findExternalEndpoints` returns one endpoint per line and direction, so a block posting
        // to the same host twice yields two. The counter is called `blockCount`, the output says
        // "n blocks" and the docs agree — so a host is counted once per block it appears in, not
        // once per mention. The direction merge and the per-write findings stay per occurrence:
        // each line is a separate place to change.
        const countedHostsInBlock = new Set<string>()
        for (const endpoint of findExternalEndpoints(content)) {
          const usage = egress.get(endpoint.host) ?? {
            host: endpoint.host,
            scheme: endpoint.scheme,
            direction: endpoint.direction,
            projects: [],
            blockCount: 0,
          }
          // A host written to anywhere is an egress path, whatever the other references do; a
          // known read still beats no information at all.
          if (endpoint.direction === 'write') {
            usage.direction = 'write'
          } else if (usage.direction === 'unknown') {
            usage.direction = endpoint.direction
          }
          if (!countedHostsInBlock.has(endpoint.host)) {
            countedHostsInBlock.add(endpoint.host)
            const entry = usage.projects.find(p => p.projectId === project.id)
            if (entry) {
              entry.blockCount++
            } else {
              usage.projects.push({ projectId: project.id, projectName: project.name, blockCount: 1 })
            }
            usage.blockCount++
          }
          egress.set(endpoint.host, usage)

          if (endpoint.direction === 'write') {
            const info = blockMap.get(block.id)
            issues.push({
              severity: SEVERITY['egress-external'],
              code: 'egress-external',
              message: `This block writes to ${endpoint.host}, a host outside Deepnote and outside the configured integrations.`,
              blockId: block.id,
              blockLabel: info?.label ?? block.id,
              notebookName: notebook.name,
              projectId: project.id,
              projectName: project.name,
              path: notebook.path,
              details: {
                host: endpoint.host,
                scheme: endpoint.scheme,
                endpoint: endpoint.evidence,
                line: endpoint.line,
              },
            })
          }
        }
      }
    }

    // Per-project checks run here too, so one pass over a synced workspace reports everything
    // `deepnote lint --governance` would report for each project, attributed to its project.
    const projectBlockList = project.notebooks.flatMap(notebook => notebook.blocks)
    packagesByProject.set(
      project.id,
      reconcile(collectDependencies(project.environment, projectBlockList).requirements)
    )

    const projectResult = runProjectGovernanceChecks(
      projectBlockList,
      blockMap,
      // The integration list is what turns `sql_integration_id` into a dialect. Omitting it here
      // made the audit quietly weaker than the lint it is supposed to subsume: every
      // dialect-dependent finding resolved to the unknown dialect and stayed silent.
      project.integrations,
      project.environment
    )
    const notebookByBlockId = new Map(projectBlocks(project).map(({ block, notebook }) => [block.id, notebook]))
    for (const issue of projectResult.issues) {
      const notebook = notebookByBlockId.get(issue.blockId)
      issues.push({ ...issue, projectId: project.id, projectName: project.name, path: notebook?.path ?? project.dir })

      if (issue.code === 'credential-hardcoded' && typeof issue.details?.fingerprint === 'string') {
        const fingerprint = issue.details.fingerprint
        const usage = credentials.get(fingerprint) ?? {
          fingerprint,
          kinds: [],
          projects: [],
          blockCount: 0,
          blockIds: new Set<string>(),
        }
        const kind = typeof issue.details.kind === 'string' ? issue.details.kind : 'Credential'
        if (!usage.kinds.includes(kind)) {
          usage.kinds.push(kind)
        }
        if (!usage.projects.some(entry => entry.projectId === project.id)) {
          usage.projects.push({ projectId: project.id, projectName: project.name })
        }
        usage.blockIds.add(issue.blockId)
        usage.blockCount = usage.blockIds.size
        credentials.set(fingerprint, usage)
      }
    }

    // An integration a block runs against but the project never declared: the block cannot be run
    // from a fresh checkout, and the integration is missing from every inventory built from the
    // project file.
    const declaredIds = new Set(project.integrations.map(integration => integration.id))
    const undeclared = new Map<string, { blockId: string; notebookName: string; path: string }>()
    for (const notebook of project.notebooks) {
      for (const block of notebook.blocks) {
        const integrationId = sqlIntegrationIdOf(block)
        if (integrationId && !declaredIds.has(integrationId) && !undeclared.has(integrationId)) {
          undeclared.set(integrationId, { blockId: block.id, notebookName: notebook.name, path: notebook.path })
        }
      }
    }
    for (const [integrationId, where] of undeclared) {
      issues.push({
        severity: SEVERITY['ingress-integration-undeclared'],
        code: 'ingress-integration-undeclared',
        message: `SQL blocks run against integration "${integrationId}", which this project does not declare (set ${getSqlEnvVarName(integrationId)} to run them).`,
        blockId: where.blockId,
        blockLabel: blockMap.get(where.blockId)?.label ?? where.blockId,
        notebookName: where.notebookName,
        projectId: project.id,
        projectName: project.name,
        path: where.path,
        details: { integrationId },
      })
    }
  }

  // Orphans and shared credentials are decided only once every project has been seen.
  for (const usage of integrations.values()) {
    if (!usage.orphan) {
      continue
    }
    for (const consumer of usage.consumers) {
      const project = projects.find(candidate => candidate.id === consumer.projectId)
      issues.push({
        severity: SEVERITY['ingress-integration-orphan'],
        code: 'ingress-integration-orphan',
        message: `Integration "${usage.name ?? usage.id}" (${usage.type ?? 'unknown type'}) is declared but no SQL block in the audited workspace uses it. Its credentials are still live.`,
        blockId: '',
        blockLabel: 'project',
        notebookName: '',
        projectId: consumer.projectId,
        projectName: consumer.projectName,
        path: project?.dir ?? '',
        details: { integrationId: usage.id, integrationType: usage.type },
      })
    }
  }

  const sharedCredentials: CredentialUsage[] = []
  for (const usage of credentials.values()) {
    if (usage.projects.length < 2) {
      continue
    }
    const { blockIds, ...shared } = usage
    sharedCredentials.push(shared)
    for (const project of usage.projects) {
      issues.push({
        severity: SEVERITY['credential-shared'],
        code: 'credential-shared',
        message: `Credential ${usage.fingerprint} (${usage.kinds.join(', ')}) is hardcoded in ${usage.projects.length} projects. Rotating it breaks all of them at once.`,
        blockId: '',
        blockLabel: 'project',
        notebookName: '',
        projectId: project.projectId,
        projectName: project.projectName,
        path: projects.find(candidate => candidate.id === project.projectId)?.dir ?? '',
        details: {
          fingerprint: usage.fingerprint,
          kinds: usage.kinds,
          projectCount: usage.projects.length,
          blockCount: blockIds.size,
          // The projects actually holding this credential, so blast radius can be measured over
          // them rather than over the workspace they happen to sit in.
          projectIds: usage.projects.map(entry => entry.projectId),
        },
      })
    }
  }

  // Data subjects are fingerprinted under a salt generated for this run and discarded with it.
  // Nothing here is persisted, so the salt never has to be managed — and an audit report cannot be
  // turned back into a list of people even by whoever ran it. Answering "where is this person's
  // data" needs an index that survives the run, which is what `deepnote subjects index` builds,
  // under a salt the operator keeps.
  const subjectIndex = buildSubjectIndex(projects, {
    fingerprinter: createSubjectFingerprinter(crypto.randomBytes(32).toString('hex')),
    internalDomains: options.internalDomains,
    root: workspace.root,
  })

  for (const subject of subjectIndex.subjects) {
    if (subject.notebookCount < SCATTER_NOTEBOOK_THRESHOLD) {
      continue
    }
    const [first] = subject.locations
    issues.push({
      severity: SEVERITY['pii-subject-scatter'],
      code: 'pii-subject-scatter',
      message: `Data about one ${subject.internal ? 'internal' : 'external'} person at ${subject.domain} appears in ${subject.notebookCount} notebooks across ${subject.projectCount} ${subject.projectCount === 1 ? 'project' : 'projects'}. An erasure request would have to reach all of them.`,
      blockId: first.blockId,
      blockLabel: blockLabelsByProject.get(first.projectId)?.get(first.blockId) ?? first.blockId,
      notebookName: first.notebookName,
      projectId: first.projectId,
      projectName: first.projectName,
      path: first.path,
      details: {
        domain: subject.domain,
        internal: subject.internal,
        notebookCount: subject.notebookCount,
        projectCount: subject.projectCount,
        locationCount: subject.locations.length,
        // Deliberately no fingerprint: this one is salted per run and would be meaningless — and
        // misleading — in a report compared against another.
      },
    })
  }

  // A notebook nobody has touched in three years. Reported last of the workspace checks, because it
  // is the multiplier the others are already scored by rather than a problem in its own right.
  for (const project of projects) {
    for (const notebook of project.notebooks) {
      const age = notebookAges.get(notebookAgeKey(project.id, notebook.id))
      if (age?.liveness !== 'cold' || age.ageDays === undefined) {
        continue
      }
      issues.push({
        severity: SEVERITY['asset-stale'],
        code: 'asset-stale',
        message: `Notebook "${notebook.name}" has not been edited or run in ${formatAge(age.ageDays)}. Nobody is maintaining what it queries, or watching what it holds.`,
        blockId: '',
        blockLabel: 'notebook',
        notebookName: notebook.name,
        projectId: project.id,
        projectName: project.name,
        path: notebook.path,
        score: scoreFinding('asset-stale', { age, occurrences: 1 }),
        details: { lastTouchedAt: age.lastTouchedAt, ageDays: age.ageDays },
      })
    }
  }

  // The bill of materials. Built from every project's reconciled set, so a package installed by one
  // project in a block and locked by another in `environment.packages` is one row with both facts
  // on it rather than two rows that disagree.
  const packages = buildPackageInventory(projects, packagesByProject, projectAges)

  for (const usage of packages) {
    if (!usage.drifted) {
      continue
    }
    // Filed against each project that pins a version, because there is no one project at fault —
    // the finding is that they disagree. Those projects are also the finding's holders: a live
    // consumer that declares the package without a version is not part of the disagreement, and
    // nothing outside the list is part of its reach.
    const holders = usage.projects.filter(entry => entry.live && entry.version !== undefined)
    for (const consumer of holders) {
      issues.push({
        severity: SEVERITY['dependency-drift'],
        code: 'dependency-drift',
        message: `"${usage.rawName}" is pinned to ${listVersions(usage.maintainedVersions)} across maintained projects (this one: ${consumer.version}). Results computed against one are not comparable with the other.`,
        blockId: '',
        blockLabel: 'project environment',
        notebookName: '',
        projectId: consumer.projectId,
        projectName: consumer.projectName,
        path: projects.find(candidate => candidate.id === consumer.projectId)?.dir ?? '',
        details: {
          package: usage.name,
          versions: usage.maintainedVersions,
          allVersions: usage.versions,
          version: consumer.version,
          projectIds: holders.map(entry => entry.projectId),
          projectCount: holders.length,
        },
      })
    }
  }

  // Consensus. This is the only check that cannot be decided from any one file: a query is
  // "divergent" purely relative to what the rest of the workspace does with the same subject, so it
  // runs last, over every SQL block the walk collected.
  //
  // Every qualifying group is reported, but only those whose consensus clears `minConfidence`
  // become issues. The groups below the line are the ones a reviewer has to click through before
  // the precision of this check is anything more than an assertion, which is why they are kept in
  // the report rather than dropped.
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const divergence =
    options.divergence === false
      ? []
      : findDivergence(observations, { kinds: options.divergenceKinds, scope: options.divergenceScope })

  // Two reach indexes, because a group's scope decides which one answers its question.
  //
  // `tables` already holds one row per (short name, integration) — the same identity the anchors
  // use. An `integration`-scoped group is about exactly one warehouse, so it reads that row and no
  // other: merging across integrations and taking the maximum would score a disagreement in a
  // three-project staging warehouse with the reach of a thirty-project production one, which is
  // the cross-warehouse mixing integration scoping exists to prevent.
  //
  // `type` and `none` groups genuinely span integrations, so they fall back to the merged index.
  // That still over-counts for `type` — it merges every integration rather than every integration
  // of that type — but those scopes are the deliberate relaxations, and over-counting reach inside
  // a scope the user widened on purpose is the lesser error.
  const reachByTableKey = new Map<string, { live: number; total: number }>()
  const reachByShortName = new Map<string, { live: number; total: number }>()
  for (const usage of tables.values()) {
    reachByTableKey.set(canonicalTableKey(usage.name, usage.integrationId), {
      live: usage.liveProjectCount,
      total: usage.projectCount,
    })
    const existing = reachByShortName.get(usage.name)
    reachByShortName.set(usage.name, {
      live: Math.max(existing?.live ?? 0, usage.liveProjectCount),
      total: Math.max(existing?.total ?? 0, usage.projectCount),
    })
  }

  for (const group of divergence) {
    if (group.confidence < minConfidence) {
      continue
    }
    // A verdict, when `--triage` ran, replaces the per-kind prior in `signal`. Both numbers are
    // recorded on the finding so a reviewer can always tell which one they are reading.
    const verdict = options.triage?.get(toCandidate(group).id)
    const reachFor = (table: string): { live: number; total: number } | undefined =>
      group.scopeRule === 'integration'
        ? reachByTableKey.get(canonicalTableKey(table, group.scopeKey))
        : reachByShortName.get(table)
    const measured = options.measuredPrecision ?? {}
    const prior = divergenceSignal(group, measured)
    const signal = verdict ? group.confidence * VERDICT_SIGNAL[verdict.verdict] : prior
    const consensusCount = group.consensus.members.length
    const attestation = `${consensusCount} of ${group.observations} queries across ${group.projectCount} ${group.projectCount === 1 ? 'project' : 'projects'}`

    for (const { variant, member } of dissenters(group)) {
      const message =
        group.kind === 'join'
          ? `This query joins ${group.anchorLabel} on ${variant.label}. ${attestation} join them on ${group.consensus.label}.`
          : group.kind === 'metric'
            ? `${group.anchorLabel} is defined here as ${variant.label}. ${attestation} define it as ${group.consensus.label}.`
            : `This query reads ${group.tables[0]} without constraining ${group.anchor}. ${attestation} do.`

      issues.push({
        severity: SEVERITY['sql-divergence'],
        code: 'sql-divergence',
        message,
        blockId: member.location.blockId,
        blockLabel: member.location.blockLabel,
        notebookName: member.location.notebookName,
        projectId: member.location.projectId,
        projectName: member.location.projectName,
        path: member.location.path,
        score: scoreFinding('sql-divergence', {
          age: ageFor(member.location.projectId, member.location.notebookName),
          // What a disagreement costs is set by how much live work reads the tables it is about.
          reach: group.tables.reduce(
            (totals, table) => {
              const reach = reachFor(table)
              return reach
                ? { live: Math.max(totals.live, reach.live), total: Math.max(totals.total, reach.total) }
                : totals
            },
            { live: 0, total: 0 }
          ),
          signal,
        }),
        details: {
          kind: group.kind,
          anchor: group.anchor,
          consensus: group.consensus.label,
          variant: variant.label,
          // The four numbers behind the ranking, so a reviewer can recompute it or disagree with
          // one of them without re-running the audit.
          observations: group.observations,
          consensusCount,
          projectCount: group.projectCount,
          confidence: Number(group.confidence.toFixed(4)),
          // Which number produced `score.signal`, and what the other one was. Without this a
          // reader cannot tell a model's judgment from a hardcoded constant.
          // Which queries were allowed into this comparison, and on what rule.
          scopeRule: group.scopeRule,
          scopeKey: group.scopeKey,
          // And how *this* query came to be in that scope: its block named the integration, or
          // the project declared exactly one and it was attributed.
          ...(member.location.integrationSource ? { integrationSource: member.location.integrationSource } : {}),
          signalSource: verdict ? 'triage' : measured[group.kind] !== undefined ? 'measured' : 'prior',
          prior: Number(prior.toFixed(4)),
          ...(measured[group.kind] !== undefined ? { measuredPrecision: measured[group.kind] } : {}),
          ...(verdict
            ? {
                verdict: verdict.verdict,
                verdictReason: verdict.reason,
                ...(verdict.canonical ? { canonical: verdict.canonical } : {}),
              }
            : {}),
          ...(member.evidence ? { evidence: member.evidence } : {}),
          ...(member.line ? { line: member.line } : {}),
        },
      })
    }
  }

  // Score everything, then rank. Scoring happens here rather than at each push because three of the
  // four factors — neglect, and both halves of blast radius — are only knowable once the whole
  // workspace has been read.
  const allScored: AuditIssue[] = issues.map(issue => ({
    ...issue,
    score: issue.score ?? scoreIssue(issue, { ageFor, tables, tablesByBlock, projectAges, subjectIndex }),
  }))

  // A model verdict of `false-positive` takes a finding out of the work queue but not out of the
  // report. Suppression that cannot be inspected is indistinguishable from a check that quietly
  // stopped working, which in a compliance tool is the expensive kind of silence.
  //
  // Both halves of this split reach the report, and both go through the boundary pass on the way
  // out. A notebook name does not stop naming a person because the finding that located it was
  // ranked out of the queue, and `suppressed` was the fourth field to escape redaction by sitting
  // beside the array someone had remembered to cover.
  const suppressed = allScored.filter(issue => issue.details?.verdict === 'false-positive')
  const scoredIssues = allScored.filter(issue => issue.details?.verdict !== 'false-positive')

  // Highest score first: the ranking is the work queue. Ties fall back to severity and then code, so
  // two runs over the same tree produce the same order.
  scoredIssues.sort(
    (a, b) =>
      b.score.score - a.score.score ||
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
      a.code.localeCompare(b.code)
  )

  const notebookAgeList = [...notebookAges.values()]
  const staleness: StalenessSummary = {
    dated: notebookAgeList.filter(age => age.liveness !== 'unknown').length,
    live: notebookAgeList.filter(age => age.liveness === 'live').length,
    aging: notebookAgeList.filter(age => age.liveness === 'aging').length,
    cold: notebookAgeList.filter(age => age.liveness === 'cold').length,
    unknown: notebookAgeList.filter(age => age.liveness === 'unknown').length,
    medianAgeDays: medianAgeDays(notebookAgeList),
  }

  const notes = [INTEGRATION_LOWER_BOUND_NOTE, EGRESS_LOWER_BOUND_NOTE]
  if (staleness.unknown > 0) {
    notes.push(
      `${staleness.unknown} of ${notebookAgeList.length} notebooks carry no modification date, so their findings are scored as neither live nor abandoned.`
    )
  }
  if (subjectIndex.summary.subjects > 0 && (options.internalDomains ?? []).length === 0) {
    notes.push('No --internal-domain was given, so colleagues and customers are counted alike as data subjects.')
  }
  if (divergence.length > 0) {
    notes.push(DIVERGENCE_PRECISION_NOTE)
  }
  const unscopedQueries = observations.filter(observation => !observation.facts.integrationId).length
  const inferredQueries = observations.filter(
    observation => observation.location.integrationSource === 'inferred'
  ).length
  if (options.divergence !== false && unscopedQueries > 0) {
    notes.push(
      `${unscopedQueries} of ${observations.length} SQL blocks could not be attributed to an integration — their block names none and their project declares none or several. They are compared only with each other, never against a known warehouse, because two tables of the same name behind two connections are not the same table.`
    )
  }
  if (options.divergence !== false && inferredQueries > 0) {
    notes.push(
      `${inferredQueries} SQL blocks name no integration but sit in a project that declares exactly one, so they are attributed to it. Each affected finding records this in details.integrationSource.`
    )
  }
  if (options.divergence !== false && workspace.projects.length < CONSENSUS_PROJECT_FLOOR) {
    notes.push(
      `${DIVERGENCE_SCALE_NOTE} This workspace has ${workspace.projects.length} project${workspace.projects.length === 1 ? '' : 's'}.`
    )
  }
  if (options.project) {
    notes.push(
      `Filtered to one project: counts and the flow map describe that project only, not the workspace it sits in.`
    )
  }

  // Every section of the report goes through the boundary pass together, at the one point where it
  // is finished and before anything can serialize it. A notebook called "churn for jane@acme.io"
  // puts that address in `notebookName`, and `path` and `projectName` carry whatever someone typed
  // there — so a scatter finding could withhold the subject's fingerprint, as it deliberately
  // does, and name them in the field beside it. Sections added by later branches inherit this
  // without touching the line.
  return redactAuditReport({
    root: workspace.root,
    scope: 'workspace',
    summary: {
      projects: projects.length,
      notebooks: notebookCount,
      blocks: blockCount,
      sqlBlocks: sqlBlockCount,
      codeBlocks: codeBlockCount,
    },
    integrations: [...integrations.values()]
      .map(usage => ({
        ...usage,
        liveProjectCount: usage.consumers.filter(
          consumer => consumer.blockCount > 0 && projectAges.get(consumer.projectId)?.liveness === 'live'
        ).length,
      }))
      .sort((a, b) => b.blockCount - a.blockCount || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    divergence,
    suppressed,
    // Ranked by live reach, not by raw reach: a table twenty abandoned projects query is not a
    // bigger dependency than one three live projects query.
    tables: [...tables.values()].sort(
      (a, b) =>
        b.liveProjectCount - a.liveProjectCount ||
        b.projectCount - a.projectCount ||
        a.name.localeCompare(b.name) ||
        // The short name is no longer unique now that rows are scoped per integration, so the
        // scope is the final tie-break. Without it two warehouses' `users` would sort unstably.
        a.integrationId.localeCompare(b.integrationId)
    ),
    staleness,
    egress: [...egress.values()].sort((a, b) => b.blockCount - a.blockCount || a.host.localeCompare(b.host)),
    credentials: sharedCredentials.sort((a, b) => b.projects.length - a.projects.length),
    packages,
    subjects: {
      total: subjectIndex.summary.subjects,
      external: subjectIndex.summary.externalSubjects,
      scattered: subjectIndex.summary.scattered,
      locations: subjectIndex.summary.locations,
      internalDomains: subjectIndex.internalDomains,
    },
    flow: buildFlowMap(projects, [...integrations.values()], [...egress.values()]),
    issues: scoredIssues,
    issueCount: {
      errors: scoredIssues.filter(issue => issue.severity === 'error').length,
      warnings: scoredIssues.filter(issue => issue.severity === 'warning').length,
      total: scoredIssues.length,
    },
    errors: workspace.errors,
    notes,
  })
}

interface ScoreIssueContext {
  ageFor: (projectId: string, notebookName: string) => AssetAge
  tables: Map<string, TableUsage>
  tablesByBlock: Map<string, string[]>
  projectAges: Map<string, AssetAge>
  subjectIndex: ReturnType<typeof buildSubjectIndex>
}

/**
 * Reach over the projects a finding names, not over the workspace.
 *
 * Every "N projects share this" finding has the same trap: the workspace's live-project count is
 * easy to reach for and is the wrong number. Counting live projects workspace-wide and clamping to
 * the finding's own count scores something held by three abandoned projects as if all three were
 * live, whenever the workspace has three live projects anywhere in it — and blast radius is the
 * multiplier the whole ranking rests on.
 *
 * So liveness is only ever counted among the holders the finding itself lists. A finding that
 * carries no `projectIds` is scored as having no live reach rather than assumed to have some:
 * under-stating an unknown is the failure this tool can survive.
 */
export function holderReach(
  details: PendingAuditIssue['details'],
  projectAges: Map<string, AssetAge>
): { live: number; total: number } {
  const holders = Array.isArray(details?.projectIds) ? (details.projectIds as string[]) : []
  const total = holders.length || (typeof details?.projectCount === 'number' ? details.projectCount : 1)
  return { live: holders.filter(id => projectAges.get(id)?.liveness === 'live').length, total }
}

/**
 * Give one finding the evidence its blast radius should be measured from.
 *
 * The evidence differs by code, and that is the point. A wrong predicate's reach is the live work
 * depending on the tables it queries. A shared credential's reach is the live projects it is
 * hardcoded in. Using one notion of "reach" for both would make the ranking a restatement of the
 * severity field it is supposed to refine.
 */
function scoreIssue(issue: PendingAuditIssue, context: ScoreIssueContext): SeverityScore {
  const age = context.ageFor(issue.projectId, issue.notebookName)

  switch (issue.code) {
    case 'sql-null-comparison':
    case 'sql-tautology':
    case 'sql-string-boolean': {
      // A query that is wrong matters in proportion to what reads the same tables — and only the
      // part of that which is still live.
      const tableNames = context.tablesByBlock.get(issue.blockId) ?? []
      const reach = tableNames.reduce(
        (totals, name) => {
          const usage = context.tables.get(name)
          return usage
            ? { live: Math.max(totals.live, usage.liveProjectCount), total: Math.max(totals.total, usage.projectCount) }
            : totals
        },
        { live: 0, total: 0 }
      )
      // A query against no table the audit could resolve still sits in a notebook someone may run.
      return reach.total === 0
        ? scoreFinding(issue.code, { age, occurrences: 1 })
        : scoreFinding(issue.code, { age, reach })
    }

    case 'credential-hardcoded':
      return scoreFinding(issue.code, {
        age,
        occurrences: typeof issue.details?.blockCount === 'number' ? issue.details.blockCount : 1,
        // The heuristic rule is a guess about a variable name; the pattern rules recognize a shape
        // the issuer assigned. Scoring them alike would bury the certain findings under the guesses.
        signal: issue.details?.confidence === 'heuristic' ? 0.5 : undefined,
      })

    case 'credential-shared':
      // Reach is the projects that hold the credential, and the live half of it is how many of
      // *those* are still maintained.
      return scoreFinding(issue.code, { age, reach: holderReach(issue.details, context.projectAges) })

    case 'pii-subject-scatter': {
      const notebookCount = typeof issue.details?.notebookCount === 'number' ? issue.details.notebookCount : 1
      return scoreFinding(issue.code, { age, occurrences: notebookCount })
    }

    case 'dependency-unpinned':
      // A bare name will install anything; a range at least bounds what can arrive.
      return scoreFinding(issue.code, { age, signal: issue.details?.pin === 'ranged' ? 0.6 : undefined })

    case 'dependency-drift':
      // Its reach is the projects that disagree, weighted by how many of them are still live.
      return scoreFinding(issue.code, { age, reach: holderReach(issue.details, context.projectAges) })

    case 'ingress-integration-orphan':
      // No live consumer by definition — that is the finding. Its reach is the projects still
      // declaring it, whose own liveness the occurrence weighting already accounts for.
      return scoreFinding(issue.code, { age, occurrences: 1 })

    default:
      return scoreFinding(issue.code, { age, occurrences: 1 })
  }
}

/** `1.5.3, 2.0.1 and 2.1.0` — a list a person reads, rather than three `and`s in a row. */
export function listVersions(versions: string[]): string {
  if (versions.length <= 1) {
    return versions.join('')
  }
  return `${versions.slice(0, -1).join(', ')} and ${versions[versions.length - 1]}`
}

/**
 * Fold every project's dependency set into one row per package.
 *
 * The weakest pin wins, because reproducibility is decided by the loosest declaration anywhere —
 * one project installing `pandas` bare makes the workspace's pandas unreproducible however firmly
 * the other six lock it.
 */
function buildPackageInventory(
  projects: WorkspaceProject[],
  packagesByProject: Map<string, PackageEntry[]>,
  projectAges: Map<string, AssetAge>
): PackageUsage[] {
  const inventory = new Map<string, PackageUsage>()
  const rank: Record<PinState, number> = { pinned: 2, ranged: 1, unpinned: 0 }

  for (const project of projects) {
    for (const entry of packagesByProject.get(project.id) ?? []) {
      const usage = inventory.get(entry.name) ?? {
        name: entry.name,
        rawName: entry.rawName,
        versions: [],
        pin: entry.pin,
        purl: packageUrl(entry.name),
        projects: [],
        drifted: false,
        maintainedVersions: [],
      }

      for (const version of entry.versions) {
        if (!usage.versions.includes(version)) {
          usage.versions.push(version)
        }
      }
      if (rank[entry.pin] < rank[usage.pin]) {
        usage.pin = entry.pin
      }
      usage.projects.push({
        projectId: project.id,
        projectName: project.name,
        pin: entry.pin,
        live: projectAges.get(project.id)?.liveness !== 'cold',
        // The version this project actually ends up with. `versions` is sorted, so taking its
        // first element reported the lowest one seen rather than the one that wins.
        ...(entry.effectiveVersion ? { version: entry.effectiveVersion } : {}),
      })
      inventory.set(entry.name, usage)
    }
  }

  return [...inventory.values()]
    .map(usage => {
      usage.versions.sort()
      // Only versions a project actually pinned count, and only from projects somebody still
      // maintains. A notebook abandoned in 2021 pinning the version that was current in 2021 is not
      // a team disagreeing with itself — it is the whole point of pinning, and reporting it would
      // put a finding on every package in every workspace that has ever had an old project in it.
      const pinnedVersions = new Set(
        usage.projects
          .filter(entry => entry.live)
          .map(entry => entry.version)
          .filter((version): version is string => version !== undefined)
      )
      return {
        ...usage,
        drifted: pinnedVersions.size > 1,
        maintainedVersions: [...pinnedVersions].sort(),
        purl: packageUrl(usage.name, usage.versions.length === 1 ? usage.versions[0] : undefined),
      }
    })
    .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name))
}

/**
 * The flow map: integrations → projects → external hosts.
 *
 * Emitted as nodes and edges rather than as a rendering, so the same data backs the terminal
 * summary, a JSON consumer, and anything drawing the graph.
 */
function buildFlowMap(
  projects: WorkspaceProject[],
  integrations: IntegrationUsage[],
  egress: EgressUsage[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const referencedProjects = new Set<string>()

  for (const integration of integrations) {
    nodes.push({
      id: `integration:${integration.id}`,
      kind: 'integration',
      label: scrubText(integration.name ?? integration.id),
      detail: integration.type,
    })
    for (const consumer of integration.consumers) {
      if (consumer.blockCount === 0) {
        continue
      }
      referencedProjects.add(consumer.projectId)
      edges.push({
        from: `integration:${integration.id}`,
        to: `project:${consumer.projectId}`,
        kind: 'reads',
        blockCount: consumer.blockCount,
      })
    }
  }

  for (const host of egress) {
    nodes.push({ id: `host:${host.host}`, kind: 'host', label: host.host, detail: host.scheme })
    for (const project of host.projects) {
      referencedProjects.add(project.projectId)
      edges.push({
        from: `project:${project.projectId}`,
        to: `host:${host.host}`,
        kind: host.direction === 'write' ? 'writes' : 'calls',
        blockCount: project.blockCount,
      })
    }
  }

  // Every project is a node, including the ones with no edges — a project connected to nothing is
  // a real answer to "what do I have", not an omission.
  for (const project of projects) {
    nodes.push({
      id: `project:${project.id}`,
      kind: 'project',
      // The flow map is the artifact most likely to be pasted into a ticket or a slide, and a
      // project named after the customer it is about carries that name into it.
      label: scrubText(project.name),
      detail: referencedProjects.has(project.id) ? undefined : 'no tracked flows',
    })
  }

  return { nodes, edges }
}
