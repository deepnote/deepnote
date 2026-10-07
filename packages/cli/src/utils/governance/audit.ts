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
import { findExternalEndpoints } from './egress'
import { redactSecrets, runProjectGovernanceChecks } from './index'
import { type SeverityScore, scoreFinding } from './scoring'
import { findTableReferences } from './sql-tables'
import { type AssetAge, assetAge, formatAge, medianAgeDays } from './staleness'
import { buildSubjectIndex, SCATTER_NOTEBOOK_THRESHOLD } from './subject-index'
import { createSubjectFingerprinter, redactSubjects } from './subjects'
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
  /** Name as written, lower-cased: `analytics.public.users`. */
  name: string
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
  egress: EgressUsage[]
  staleness: StalenessSummary
  /** Credentials found in more than one project. Within-project reuse is a lint-level finding. */
  credentials: CredentialUsage[]
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

const DIVERGENCE_NOTE = `Divergence checks need roughly ${CONSENSUS_PROJECT_FLOOR}+ projects before consensus means anything, and are not run here.`

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
  /** Keyed by notebook id, which is the only thing unique within a project. */
  const notebookAges = new Map<string, AssetAge>()
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

  for (const project of projects) {
    projectAges.set(project.id, assetAge(project.modifiedAt, now))
    for (const notebook of project.notebooks) {
      const age = assetAge(notebookLastTouchedAt(notebook), now)
      notebookAges.set(notebook.id, age)
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

        const integrationId = sqlIntegrationIdOf(block)
        if (block.type === 'sql') {
          sqlBlockCount++
          const referenced = findTableReferences(content)
          tablesByBlock.set(
            block.id,
            referenced.map(reference => reference.name)
          )
          for (const { name } of referenced) {
            const usage = tables.get(name) ?? {
              name,
              projectCount: 0,
              liveProjectCount: 0,
              blockCount: 0,
              projects: [],
            }
            if (!usage.projects.some(entry => entry.projectId === project.id)) {
              usage.projects.push({ projectId: project.id, projectName: project.name, live: projectIsLive })
              usage.projectCount++
              if (projectIsLive) {
                usage.liveProjectCount++
              }
            }
            usage.blockCount++
            tables.set(name, usage)
          }
        }
        if (integrationId) {
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
    const projectResult = runProjectGovernanceChecks(
      project.notebooks.flatMap(notebook => notebook.blocks),
      blockMap,
      // The integration list is what turns `sql_integration_id` into a dialect. Omitting it here
      // made the audit quietly weaker than the lint it is supposed to subsume: every
      // dialect-dependent finding resolved to the unknown dialect and stayed silent.
      project.integrations
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
      const age = notebookAges.get(notebook.id)
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

  // Score everything, then rank. Scoring happens here rather than at each push because three of the
  // four factors — neglect, and both halves of blast radius — are only knowable once the whole
  // workspace has been read.
  const scoredIssues: AuditIssue[] = issues.map(issue => ({
    ...issue,
    score: issue.score ?? scoreIssue(issue, { ageFor, tables, tablesByBlock, projectAges, subjectIndex }),
  }))

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
  if (workspace.projects.length < CONSENSUS_PROJECT_FLOOR) {
    notes.push(
      `${DIVERGENCE_NOTE} This workspace has ${workspace.projects.length} project${workspace.projects.length === 1 ? '' : 's'}.`
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
    // Ranked by live reach, not by raw reach: a table twenty abandoned projects query is not a
    // bigger dependency than one three live projects query.
    tables: [...tables.values()].sort(
      (a, b) =>
        b.liveProjectCount - a.liveProjectCount || b.projectCount - a.projectCount || a.name.localeCompare(b.name)
    ),
    staleness,
    egress: [...egress.values()].sort((a, b) => b.blockCount - a.blockCount || a.host.localeCompare(b.host)),
    credentials: sharedCredentials.sort((a, b) => b.projects.length - a.projects.length),
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

    case 'ingress-integration-orphan':
      // No live consumer by definition — that is the finding. Its reach is the projects still
      // declaring it, whose own liveness the occurrence weighting already accounts for.
      return scoreFinding(issue.code, { age, occurrences: 1 })

    default:
      return scoreFinding(issue.code, { age, occurrences: 1 })
  }
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
