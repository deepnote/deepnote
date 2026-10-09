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

import { getSqlEnvVarName, isBuiltinIntegration } from '@deepnote/database-integrations'
import type { BlockInfo, LintIssue } from '../analysis'
import { getBlockLabel } from '../block-label'
import { findExternalEndpoints } from './egress'
import { redactSecrets, runProjectGovernanceChecks } from './index'
import { type LoadedWorkspace, projectBlocks, type WorkspaceLoadError, type WorkspaceProject } from './workspace'

/** A lint issue, placed in the workspace it was found in. */
export interface AuditIssue extends LintIssue {
  projectId: string
  projectName: string
  /** Workspace-root-relative path of the file the issue was found in. */
  path: string
}

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
  egress: EgressUsage[]
  /** Credentials found in more than one project. Within-project reuse is a lint-level finding. */
  credentials: CredentialUsage[]
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
} as const

/**
 * Mask every credential in one user-facing string.
 *
 * Exported because not every string the audit command prints comes out of a report. The
 * "project not found" message names the workspace root and the closest project names, and a
 * project name can be a connection string — so a mistyped `--project` printed a password into a
 * CI log, from the very helper whose comment warns about disclosing names.
 *
 * Applied whole first, then per `/`-separated segment. A URI password is only recognizable with
 * its scheme and host around it, so the whole-string pass has to come first; the segment pass then
 * catches patterns that deliberately refuse to match across a `/`, which is how a value buried in
 * a filesystem path or a URL would otherwise survive. Masking is idempotent, so running both
 * costs nothing on a string that has no secret in it.
 */
export function scrubText(text: string): string {
  const whole = redactSecrets(text)
  return whole.includes('/') ? whole.split('/').map(redactSecrets).join('/') : whole
}

/**
 * Subtrees the boundary pass must leave alone, by dotted key path with `*` for an array index.
 *
 * Empty here. The entry that matters arrives with the subject index, which is sensitive *by
 * design*: its whole purpose is to answer "which notebooks hold this person's data", and a
 * location with the project and notebook masked answers nothing. Anything added to this set is a
 * deliberate exception and needs a reason written beside it.
 */
const BOUNDARY_EXEMPT_PATHS = new Set<string>()

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
        // Labels are the block's first line, which for a credential assignment is the credential.
        label: redactSecrets(getBlockLabel(block)),
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

/** `--project` matches a project by exact id, or by name case-insensitively. */
function matchesProject(project: WorkspaceProject, filter: string): boolean {
  return project.id === filter || project.name.toLowerCase() === filter.toLowerCase()
}

/** Audit a loaded workspace. Pure: no I/O, so the whole report is reproducible from the tree. */
export function auditWorkspace(workspace: LoadedWorkspace, options: AuditOptions = {}): WorkspaceAudit {
  const projects = options.project
    ? workspace.projects.filter(project => matchesProject(project, options.project as string))
    : workspace.projects

  const issues: AuditIssue[] = []
  const integrations = new Map<string, IntegrationUsage>()
  const egress = new Map<string, EgressUsage>()
  const credentials = new Map<string, CredentialUsage & { blockIds: Set<string> }>()

  let notebookCount = 0
  let blockCount = 0
  let sqlBlockCount = 0
  let codeBlockCount = 0

  for (const project of projects) {
    const blockMap = blockMapFor(project)
    notebookCount += project.notebooks.length

    // Declared integrations are registered before any block is read, so an integration nobody uses
    // still appears in the inventory — being unused is the finding.
    for (const declared of project.integrations) {
      const usage = integrations.get(declared.id) ?? { id: declared.id, consumers: [], blockCount: 0, orphan: true }
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
        }
        if (integrationId) {
          const usage = integrations.get(integrationId) ?? {
            id: integrationId,
            consumers: [],
            blockCount: 0,
            orphan: false,
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
        },
      })
    }
  }

  const notes = [INTEGRATION_LOWER_BOUND_NOTE, EGRESS_LOWER_BOUND_NOTE]
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
  // is finished and before anything can serialize it. Sections added by later branches inherit it
  // without touching this line.
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
    integrations: [...integrations.values()].sort(
      (a, b) => b.blockCount - a.blockCount || (a.name ?? a.id).localeCompare(b.name ?? b.id)
    ),
    egress: [...egress.values()].sort((a, b) => b.blockCount - a.blockCount || a.host.localeCompare(b.host)),
    credentials: sharedCredentials.sort((a, b) => b.projects.length - a.projects.length),
    flow: buildFlowMap(projects, [...integrations.values()], [...egress.values()]),
    issues,
    issueCount: {
      errors: issues.filter(issue => issue.severity === 'error').length,
      warnings: issues.filter(issue => issue.severity === 'warning').length,
      total: issues.length,
    },
    errors: workspace.errors,
    notes,
  })
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
      label: integration.name ?? integration.id,
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
      label: project.name,
      detail: referencedProjects.has(project.id) ? undefined : 'no tracked flows',
    })
  }

  return { nodes, edges }
}
