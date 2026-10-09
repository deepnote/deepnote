import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { auditWorkspace, CONSENSUS_PROJECT_FLOOR, holderReach, resolveBlockIntegration } from './audit'
import { buildReviewFile } from './review'
import type { DivergenceGroup } from './sql-divergence'
import type { AssetAge } from './staleness'
import { runTriage, type TriageProvider, toCandidate } from './triage'
import type { LoadedWorkspace, WorkspaceProject } from './workspace'

interface TestBlock {
  id: string
  type: string
  content?: string
  integrationId?: string
}

function project(
  id: string,
  name: string,
  notebooks: Array<{ name: string; blocks: TestBlock[] }>,
  integrations: Array<{ id: string; name: string; type: string }> = []
): WorkspaceProject {
  return {
    id,
    name,
    dir: name.toLowerCase(),
    integrations,
    notebooks: notebooks.map((notebook, index) => ({
      id: `${id}-n${index}`,
      name: notebook.name,
      path: `${name.toLowerCase()}/${notebook.name}.deepnote`,
      blocks: notebook.blocks.map(block => ({
        id: block.id,
        type: block.type,
        content: block.content ?? '',
        metadata: block.integrationId ? { sql_integration_id: block.integrationId } : {},
      })) as unknown as DeepnoteBlock[],
    })),
  }
}

function workspace(projects: WorkspaceProject[]): LoadedWorkspace {
  return { root: '/workspace', projects, errors: [], fileCount: projects.length }
}

/** Issues of one code, in report order. */
function issuesOf(audit: ReturnType<typeof auditWorkspace>, code: string) {
  return audit.issues.filter(issue => issue.code === code)
}

/** A fixed clock, so staleness is a property of the fixture rather than of the day the test runs. */
const NOW = new Date('2026-10-07T00:00:00.000Z')

/** An ISO timestamp `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** `project`, with a last-modified date on the project and every notebook it holds. */
function datedProject(
  id: string,
  name: string,
  modifiedAt: string,
  notebooks: Array<{ name: string; blocks: TestBlock[] }>,
  integrations: Array<{ id: string; name: string; type: string }> = []
): WorkspaceProject {
  const built = project(id, name, notebooks, integrations)
  return {
    ...built,
    modifiedAt,
    notebooks: built.notebooks.map(notebook => ({ ...notebook, modifiedAt })),
  }
}

describe('auditWorkspace', () => {
  describe('inventory', () => {
    it('counts projects, notebooks, and blocks by kind', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'sql', content: 'SELECT 1' },
                { id: 'b2', type: 'code', content: 'x = 1' },
              ],
            },
            { name: 'Two', blocks: [{ id: 'b3', type: 'markdown', content: 'Notes' }] },
          ]),
        ])
      )

      expect(audit.summary).toEqual({ projects: 1, notebooks: 2, blocks: 3, sqlBlocks: 1, codeBlocks: 1 })
      expect(audit.scope).toBe('workspace')
    })
  })

  describe('ingress', () => {
    const warehouse = { id: 'i1', name: 'Warehouse', type: 'snowflake' }

    it('counts each integration against the projects that query it', () => {
      const audit = auditWorkspace(
        workspace([
          project(
            'p1',
            'Alpha',
            [{ name: 'One', blocks: [{ id: 'b1', type: 'sql', integrationId: 'i1' }] }],
            [warehouse]
          ),
          project(
            'p2',
            'Bravo',
            [
              {
                name: 'One',
                blocks: [
                  { id: 'b2', type: 'sql', integrationId: 'i1' },
                  { id: 'b3', type: 'sql', integrationId: 'i1' },
                ],
              },
            ],
            [warehouse]
          ),
        ])
      )

      expect(audit.integrations).toHaveLength(1)
      expect(audit.integrations[0]).toMatchObject({
        id: 'i1',
        name: 'Warehouse',
        type: 'snowflake',
        blockCount: 3,
        orphan: false,
      })
      expect(audit.integrations[0].consumers.map(c => [c.projectName, c.blockCount])).toEqual([
        ['Alpha', 1],
        ['Bravo', 2],
      ])
    })

    it('reports an integration declared by a project and used by nobody', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [{ name: 'One', blocks: [] }], [{ id: 'i9', name: 'Legacy', type: 'redshift' }]),
        ])
      )

      expect(audit.integrations[0].orphan).toBe(true)
      expect(issuesOf(audit, 'ingress-integration-orphan')).toHaveLength(1)
      expect(issuesOf(audit, 'ingress-integration-orphan')[0].message).toContain('credentials are still live')
    })

    it('does not call an integration an orphan when another project uses it', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [{ name: 'One', blocks: [] }], [warehouse]),
          project('p2', 'Bravo', [{ name: 'One', blocks: [{ id: 'b1', type: 'sql', integrationId: 'i1' }] }]),
        ])
      )

      expect(audit.integrations[0].orphan).toBe(false)
      expect(issuesOf(audit, 'ingress-integration-orphan')).toEqual([])
    })

    it('reports an integration a block runs against but the project never declared', () => {
      const audit = auditWorkspace(
        workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', type: 'sql', integrationId: 'i7' }] }])])
      )

      const undeclared = issuesOf(audit, 'ingress-integration-undeclared')
      expect(undeclared).toHaveLength(1)
      expect(undeclared[0].details).toMatchObject({ integrationId: 'i7' })
      expect(undeclared[0].message).toContain('SQL_I7')
    })

    it('reports an undeclared integration once per project, not once per block', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'sql', integrationId: 'i7' },
                { id: 'b2', type: 'sql', integrationId: 'i7' },
              ],
            },
          ]),
        ])
      )

      expect(issuesOf(audit, 'ingress-integration-undeclared')).toHaveLength(1)
    })
  })

  describe('egress', () => {
    it('groups hosts across projects and flags each write', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [{ id: 'b1', type: 'code', content: 'requests.post("https://api.segment.io/v1/track")' }],
            },
          ]),
          project('p2', 'Bravo', [
            {
              name: 'One',
              blocks: [{ id: 'b2', type: 'code', content: 'requests.post("https://api.segment.io/v1/track")' }],
            },
          ]),
        ])
      )

      expect(audit.egress).toHaveLength(1)
      expect(audit.egress[0]).toMatchObject({ host: 'api.segment.io', direction: 'write', blockCount: 2 })
      expect(issuesOf(audit, 'egress-external')).toHaveLength(2)
    })

    it('inventories a read without reporting it as egress', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [{ id: 'b1', type: 'code', content: 'pd.read_csv("https://data.example.com/x.csv")' }],
            },
          ]),
        ])
      )

      expect(audit.egress[0]).toMatchObject({ host: 'data.example.com', direction: 'read' })
      expect(issuesOf(audit, 'egress-external')).toEqual([])
    })

    it('treats a host written to anywhere as a write', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'code', content: 'requests.get("https://api.example.com/a")' },
                { id: 'b2', type: 'code', content: 'requests.post("https://api.example.com/b")' },
              ],
            },
          ]),
        ])
      )

      expect(audit.egress[0].direction).toBe('write')
    })

    it('ignores URLs outside code blocks', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'One', blocks: [{ id: 'b1', type: 'markdown', content: 'See https://api.segment.io/docs' }] },
          ]),
        ])
      )

      expect(audit.egress).toEqual([])
    })
  })

  describe('credentials', () => {
    const leak = 'key = "AKIAIOSFODNN7EXAMPLE"'

    it('reports a credential hardcoded in more than one project', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', type: 'code', content: leak }] }]),
          project('p2', 'Bravo', [{ name: 'One', blocks: [{ id: 'b2', type: 'code', content: leak }] }]),
        ])
      )

      expect(audit.credentials).toHaveLength(1)
      expect(audit.credentials[0]).toMatchObject({ kinds: ['AWS access key ID'], blockCount: 2 })
      expect(audit.credentials[0].projects.map(p => p.projectName)).toEqual(['Alpha', 'Bravo'])
      expect(issuesOf(audit, 'credential-shared')).toHaveLength(2)
      expect(issuesOf(audit, 'credential-shared')[0].severity).toBe('error')
    })

    it('does not report a credential confined to one project as shared', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'code', content: leak },
                { id: 'b2', type: 'code', content: leak },
              ],
            },
          ]),
        ])
      )

      expect(audit.credentials).toEqual([])
      expect(issuesOf(audit, 'credential-shared')).toEqual([])
      expect(issuesOf(audit, 'credential-hardcoded')).toHaveLength(2)
    })

    it('never puts the credential itself in the report', () => {
      const audit = auditWorkspace(
        workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', type: 'code', content: leak }] }])])
      )

      expect(JSON.stringify(audit)).not.toContain('AKIAIOSFODNN7EXAMPLE')
    })
  })

  describe('per-project checks', () => {
    it('runs the lint governance checks against every project and attributes them', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'Queries', blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM t WHERE a = NULL' }] },
          ]),
        ])
      )

      const issue = issuesOf(audit, 'sql-null-comparison')[0]
      expect(issue).toMatchObject({
        projectId: 'p1',
        projectName: 'Alpha',
        notebookName: 'Queries',
        path: 'alpha/Queries.deepnote',
      })
    })
  })

  describe('data subjects', () => {
    it('counts people and flags the ones spread across notebooks', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'owner = "jane@acme-corp.io"' }] },
            { name: 'Two', blocks: [{ id: 'b2', type: 'code', content: 'owner = "jane@acme-corp.io"' }] },
          ]),
          project('p2', 'Bravo', [
            { name: 'One', blocks: [{ id: 'b3', type: 'code', content: 'owner = "sam@globex.co"' }] },
          ]),
        ])
      )

      expect(audit.subjects).toMatchObject({ total: 2, scattered: 1, locations: 3 })
      const scatter = issuesOf(audit, 'pii-subject-scatter')
      expect(scatter).toHaveLength(1)
      expect(scatter[0].details).toMatchObject({ domain: 'acme-corp.io', notebookCount: 2, projectCount: 1 })
      expect(scatter[0].message).toContain('erasure request')
    })

    it('keeps the person out of the report that is about them', () => {
      // A notebook, a project or a file named after the customer it is about puts that address in
      // `notebookName`, `projectName` and `path` — so a scatter finding could withhold the
      // subject's fingerprint, as it deliberately does, and name them in the field beside it.
      const address = 'jane.doe.reporting@acme-corp.io'
      const audit = auditWorkspace(
        workspace([
          project('11111111-aaaa-4aaa-8aaa-111111111111', `Churn for ${address}`, [
            { name: `analysis for ${address}`, blocks: [{ id: 'b1', type: 'code', content: `owner = "${address}"` }] },
            { name: `followup for ${address}`, blocks: [{ id: 'b2', type: 'code', content: `owner = "${address}"` }] },
          ]),
        ])
      )

      const [scatter] = issuesOf(audit, 'pii-subject-scatter')
      expect(scatter.notebookName).not.toContain('jane')
      expect(scatter.projectName).not.toContain('jane')
      expect(scatter.path).not.toContain('jane')
      // Including the flow map, which is the artifact most likely to be pasted into a ticket.
      expect(JSON.stringify(audit.flow)).not.toContain('jane')
      expect(JSON.stringify(audit)).not.toContain(address)
    })

    it('does not leave a half-truncated address in a block label', () => {
      // `getBlockLabel` truncates to a fixed width before anything is redacted, so an address
      // straddling the cut used to survive as `jane.doe.report…` — a name, matching no pattern.
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'code', content: `# ${'x'.repeat(35)} jane.doe.reporting@acme-corp.io` },
                { id: 'b2', type: 'code', content: `# ${'x'.repeat(35)} jane.doe.reporting@acme-corp.io` },
              ],
            },
            { name: 'Two', blocks: [{ id: 'b3', type: 'code', content: 'owner = "jane.doe.reporting@acme-corp.io"' }] },
          ]),
        ])
      )

      expect(JSON.stringify(audit)).not.toContain('jane.doe')
    })

    it('does not flag a person confined to one notebook', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'a = "jane@acme-corp.io"' }] },
          ]),
        ])
      )

      expect(audit.subjects.scattered).toBe(0)
      expect(issuesOf(audit, 'pii-subject-scatter')).toEqual([])
    })

    it('separates colleagues from customers when told which domains are internal', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            {
              name: 'One',
              blocks: [{ id: 'b1', type: 'code', content: 'a = "jane@acme-corp.io"\nb = "sam@globex.co"' }],
            },
          ]),
        ]),
        { internalDomains: ['globex.co'] }
      )

      expect(audit.subjects).toMatchObject({ total: 2, external: 1, internalDomains: ['globex.co'] })
    })

    it('never puts an address or a stable fingerprint in the report', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'a = "jane@acme-corp.io"' }] },
            { name: 'Two', blocks: [{ id: 'b2', type: 'code', content: 'a = "jane@acme-corp.io"' }] },
          ]),
        ])
      )

      // The salt is generated per run and discarded, so there is nothing to compare across reports
      // and nothing to reverse. A persistent index is `deepnote subjects index`.
      expect(JSON.stringify(audit)).not.toContain('jane@acme-corp.io')
      expect(issuesOf(audit, 'pii-subject-scatter')[0].details?.fingerprint).toBeUndefined()
    })

    it('says when nobody was classified as internal', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [
            { name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'a = "jane@acme-corp.io"' }] },
          ]),
        ])
      )

      expect(audit.notes.some(note => note.includes('No --internal-domain'))).toBe(true)
    })
  })

  describe('flow map', () => {
    it('links integrations into projects and projects out to hosts', () => {
      const audit = auditWorkspace(
        workspace([
          project(
            'p1',
            'Alpha',
            [
              {
                name: 'One',
                blocks: [
                  { id: 'b1', type: 'sql', integrationId: 'i1' },
                  { id: 'b2', type: 'code', content: 'requests.post("https://api.segment.io/v1/track")' },
                ],
              },
            ],
            [{ id: 'i1', name: 'Warehouse', type: 'snowflake' }]
          ),
        ])
      )

      expect(audit.flow.edges).toEqual([
        { from: 'integration:i1', to: 'project:p1', kind: 'reads', blockCount: 1 },
        { from: 'project:p1', to: 'host:api.segment.io', kind: 'writes', blockCount: 1 },
      ])
      expect(audit.flow.nodes.map(node => node.id)).toEqual(['integration:i1', 'host:api.segment.io', 'project:p1'])
    })

    it('includes a project with no flows, marked as such', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]))

      expect(audit.flow.edges).toEqual([])
      expect(audit.flow.nodes[0]).toMatchObject({ kind: 'project', detail: 'no tracked flows' })
    })
  })

  describe('scope and limits', () => {
    it('says how far below the consensus floor the workspace is, rather than hiding the caveat', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]))

      expect(audit.notes.some(note => note.includes(`below roughly ${CONSENSUS_PROJECT_FLOOR} projects`))).toBe(true)
      expect(audit.notes.some(note => note.includes('has 1 project'))).toBe(true)
    })

    it('drops the scale caveat when the consensus checks were not asked for', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]), {
        divergence: false,
      })

      expect(audit.notes.some(note => note.includes('below roughly'))).toBe(false)
    })

    it('always states that egress and integration usage are lower bounds', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]))

      expect(audit.notes.some(note => note.includes('lower bound'))).toBe(true)
      expect(audit.notes.some(note => note.includes('dbt models'))).toBe(true)
    })

    it('restricts the report to one project and says the counts are not the workspace', () => {
      const audit = auditWorkspace(
        workspace([
          project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'x = 1' }] }]),
          project('p2', 'Bravo', [{ name: 'One', blocks: [{ id: 'b2', type: 'code', content: 'y = 2' }] }]),
        ]),
        { project: 'Bravo' }
      )

      expect(audit.summary.projects).toBe(1)
      expect(audit.flow.nodes.map(n => n.label)).toEqual(['Bravo'])
      expect(audit.notes.some(note => note.includes('Filtered to one project'))).toBe(true)
    })

    it('matches --project by id as well as by name', () => {
      const projects = [
        project('p1', 'Alpha', [{ name: 'One', blocks: [] }]),
        project('p2', 'Bravo', [{ name: 'One', blocks: [] }]),
      ]

      expect(auditWorkspace(workspace(projects), { project: 'p2' }).flow.nodes[0].label).toBe('Bravo')
      expect(auditWorkspace(workspace(projects), { project: 'alpha' }).flow.nodes[0].label).toBe('Alpha')
    })

    it('passes through the files that could not be parsed', () => {
      const loaded = { ...workspace([]), errors: [{ path: 'bad.deepnote', message: 'boom' }] }

      expect(auditWorkspace(loaded).errors).toEqual([{ path: 'bad.deepnote', message: 'boom' }])
    })
  })

  describe('staleness', () => {
    it('classifies notebooks by how long ago they were touched', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Live', daysAgo(30), [{ name: 'One', blocks: [] }]),
          datedProject('p2', 'Aging', daysAgo(500), [{ name: 'One', blocks: [] }]),
          datedProject('p3', 'Cold', daysAgo(1500), [{ name: 'One', blocks: [] }]),
          project('p4', 'Undated', [{ name: 'One', blocks: [] }]),
        ]),
        { now: NOW }
      )

      expect(audit.staleness).toMatchObject({ live: 1, aging: 1, cold: 1, unknown: 1, dated: 3 })
      expect(audit.staleness.medianAgeDays).toBe(500)
    })

    it('reports a notebook untouched for three years', () => {
      const audit = auditWorkspace(
        workspace([datedProject('p1', 'Cold', daysAgo(1500), [{ name: 'Old', blocks: [] }])]),
        { now: NOW }
      )

      const stale = issuesOf(audit, 'asset-stale')
      expect(stale).toHaveLength(1)
      expect(stale[0].message).toContain('4.1 years')
      expect(stale[0].details).toMatchObject({ ageDays: 1500 })
    })

    it('does not report an undated notebook as abandoned', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Undated', [{ name: 'One', blocks: [] }])]), { now: NOW })

      expect(issuesOf(audit, 'asset-stale')).toEqual([])
      expect(audit.notes.some(note => note.includes('no modification date'))).toBe(true)
    })

    it('counts a recently executed block as a touch, even when the file is old', () => {
      const old = datedProject('p1', 'Executed', daysAgo(1500), [{ name: 'One', blocks: [{ id: 'b1', type: 'code' }] }])
      old.notebooks[0].blocks[0] = {
        ...old.notebooks[0].blocks[0],
        executionFinishedAt: daysAgo(10),
      } as (typeof old.notebooks)[number]['blocks'][number]

      const audit = auditWorkspace(workspace([old]), { now: NOW })

      expect(audit.staleness.live).toBe(1)
      expect(issuesOf(audit, 'asset-stale')).toEqual([])
    })

    it('ignores an unparseable modification date rather than carrying it', () => {
      // Every comparison against NaN is false, so a malformed `modifiedAt` could never be replaced
      // by a valid execution time. A notebook that ran last week reported as undated, and liveness
      // is the multiplier the whole ranking is weighted by.
      const broken = datedProject('p1', 'Broken', daysAgo(1500), [
        { name: 'One', blocks: [{ id: 'b1', type: 'code' }] },
      ])
      broken.notebooks[0] = { ...broken.notebooks[0], modifiedAt: 'last Tuesday' }
      broken.notebooks[0].blocks[0] = {
        ...broken.notebooks[0].blocks[0],
        executionFinishedAt: daysAgo(10),
      } as (typeof broken.notebooks)[number]['blocks'][number]

      const audit = auditWorkspace(workspace([broken]), { now: NOW })

      expect(audit.staleness.live).toBe(1)
      expect(audit.staleness.unknown).toBe(0)
    })

    it('counts notebooks that share a name separately, and does not guess between them', () => {
      // Notebook names are not unique within a project. Keying ages by name collapsed two
      // notebooks into one, so the staleness summary counted one too few and the stale check read one
      // notebook's age for both — reporting a live notebook as stale, or missing a cold one.
      const mixed = datedProject('p1', 'Mixed', daysAgo(30), [
        { name: 'Analysis', blocks: [] },
        { name: 'Analysis', blocks: [] },
      ])
      mixed.notebooks[0] = { ...mixed.notebooks[0], modifiedAt: daysAgo(1500) }
      mixed.notebooks[1] = { ...mixed.notebooks[1], modifiedAt: daysAgo(10) }

      const audit = auditWorkspace(workspace([mixed]), { now: NOW })

      expect(audit.summary.notebooks).toBe(2)
      expect(audit.staleness.dated).toBe(2)
      expect(audit.staleness.cold).toBe(1)
      expect(audit.staleness.live).toBe(1)
      // Exactly one is stale — not both, and not neither.
      expect(issuesOf(audit, 'asset-stale')).toHaveLength(1)
    })
  })

  describe('tables and blast radius', () => {
    it('inventories tables with their live and total reach', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Live', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM users' }] },
          ]),
          datedProject('p2', 'Abandoned', daysAgo(1500), [
            { name: 'One', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM users' }] },
          ]),
        ]),
        { now: NOW }
      )

      expect(audit.tables).toHaveLength(1)
      expect(audit.tables[0]).toMatchObject({ name: 'users', projectCount: 2, liveProjectCount: 1, blockCount: 2 })
    })

    it('ranks tables by live reach rather than raw reach', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Live A', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM live_table' }] },
          ]),
          datedProject('p2', 'Live B', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM live_table' }] },
          ]),
          datedProject('p3', 'Dead A', daysAgo(1500), [
            { name: 'One', blocks: [{ id: 'b3', type: 'sql', content: 'SELECT * FROM dead_table' }] },
          ]),
          datedProject('p4', 'Dead B', daysAgo(1500), [
            { name: 'One', blocks: [{ id: 'b4', type: 'sql', content: 'SELECT * FROM dead_table JOIN x ON 1 = 2' }] },
          ]),
          datedProject('p5', 'Dead C', daysAgo(1500), [
            { name: 'One', blocks: [{ id: 'b5', type: 'sql', content: 'SELECT * FROM dead_table' }] },
          ]),
        ]),
        { now: NOW }
      )

      expect(audit.tables[0].name).toBe('live_table')
      expect(audit.tables.find(table => table.name === 'dead_table')?.projectCount).toBe(3)
      expect(audit.tables.find(table => table.name === 'dead_table')?.liveProjectCount).toBe(0)
    })

    it('scores a wrong query higher when live projects read the same table', () => {
      const wrongQuery = { id: 'b1', type: 'sql', content: 'SELECT * FROM users WHERE deleted_at = NULL' }
      const alone = auditWorkspace(
        workspace([datedProject('p1', 'Alpha', daysAgo(30), [{ name: 'One', blocks: [wrongQuery] }])]),
        { now: NOW }
      )
      const widelyRead = auditWorkspace(
        workspace([
          datedProject('p1', 'Alpha', daysAgo(30), [{ name: 'One', blocks: [wrongQuery] }]),
          datedProject('p2', 'Bravo', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM users' }] },
          ]),
          datedProject('p3', 'Charlie', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b3', type: 'sql', content: 'SELECT id FROM users' }] },
          ]),
        ]),
        { now: NOW }
      )

      const scoreOf = (audit: ReturnType<typeof auditWorkspace>) =>
        issuesOf(audit, 'sql-null-comparison')[0].score.score
      expect(scoreOf(widelyRead)).toBeGreaterThan(scoreOf(alone))
    })
  })

  describe('ranking', () => {
    it('scores every finding and returns them highest first', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Alpha', daysAgo(30), [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'sql', content: 'SELECT * FROM t WHERE a = NULL' },
                { id: 'b2', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' },
                { id: 'b3', type: 'code', content: 'requests.post("https://api.segment.io/v1/track")' },
              ],
            },
          ]),
        ]),
        { now: NOW }
      )

      const scores = audit.issues.map(issue => issue.score.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
      expect(audit.issues.every(issue => issue.score.score > 0)).toBe(true)
    })

    it('exposes all four factors, so the ranking can be argued with', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Alpha', daysAgo(30), [
            { name: 'One', blocks: [{ id: 'b1', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' }] },
          ]),
        ]),
        { now: NOW }
      )

      expect(audit.issues[0].score).toMatchObject({
        signal: expect.any(Number),
        exposure: expect.any(Number),
        neglect: expect.any(Number),
        blastRadius: expect.any(Number),
      })
    })

    it('ranks a credential in an abandoned notebook above one in a live notebook', () => {
      // The key still works. Liveness weighting must not be allowed to score it as harmless.
      const leak = { id: 'b1', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' }
      const live = auditWorkspace(
        workspace([datedProject('p1', 'Live', daysAgo(30), [{ name: 'One', blocks: [leak] }])]),
        { now: NOW }
      )
      const abandoned = auditWorkspace(
        workspace([datedProject('p1', 'Cold', daysAgo(1500), [{ name: 'One', blocks: [leak] }])]),
        { now: NOW }
      )

      const credentialScore = (audit: ReturnType<typeof auditWorkspace>) =>
        issuesOf(audit, 'credential-hardcoded')[0].score.score
      expect(credentialScore(abandoned)).toBeGreaterThan(credentialScore(live))
    })

    it('ranks the heuristic credential rule below the pattern rules', () => {
      const audit = auditWorkspace(
        workspace([
          datedProject('p1', 'Alpha', daysAgo(30), [
            {
              name: 'One',
              blocks: [
                { id: 'b1', type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' },
                { id: 'b2', type: 'code', content: 'api_key = "9f8e7d6c5b4a39281706"' },
              ],
            },
          ]),
        ]),
        { now: NOW }
      )

      const [first, second] = issuesOf(audit, 'credential-hardcoded')
      expect(first.details?.confidence).toBe('pattern')
      expect(second.details?.confidence).toBe('heuristic')
      expect(first.score.score).toBeGreaterThan(second.score.score)
    })
  })

  it('counts issues by severity', () => {
    const audit = auditWorkspace(
      workspace([
        project('p1', 'Alpha', [
          {
            name: 'One',
            blocks: [
              { id: 'b1', type: 'sql', content: 'SELECT * FROM t WHERE a = NULL' },
              { id: 'b2', type: 'code', content: 'requests.post("https://api.segment.io/v1/track")' },
            ],
          },
        ]),
      ])
    )

    expect(audit.issueCount).toEqual({
      errors: audit.issues.filter(i => i.severity === 'error').length,
      warnings: audit.issues.filter(i => i.severity === 'warning').length,
      total: audit.issues.length,
    })
    expect(audit.issueCount.total).toBe(2)
  })

  it('reports an empty workspace without inventing findings', () => {
    const audit = auditWorkspace(workspace([]))

    expect(audit.summary.projects).toBe(0)
    expect(audit.issues).toEqual([])
    expect(audit.flow).toEqual({ nodes: [], edges: [] })
  })
})

describe('auditWorkspace — the redaction boundary covers the whole report', () => {
  // A connection string: `redactSecrets` recognizes the password only with the scheme and host
  // around it, which is why the boundary pass scrubs whole strings before it scrubs path segments.
  const SECRET = 'postgres://svc:hunter2correct@warehouse.internal:5432/analytics'

  function leakyWorkspace(): LoadedWorkspace {
    return {
      root: `/srv/${SECRET}`,
      fileCount: 1,
      errors: [{ path: `broken/${SECRET}.deepnote`, message: `could not parse ${SECRET}` }],
      projects: [
        project(
          'p1',
          `Export ${SECRET}`,
          [
            {
              name: `Notes ${SECRET}`,
              blocks: [
                { id: 'b1', type: 'sql', content: 'SELECT id FROM users', integrationId: 'warehouse' },
                { id: 'b2', type: 'code', content: `requests.post("https://hooks.example.com/${SECRET}", data=df)` },
                { id: 'b3', type: 'code', content: `DSN = "${SECRET}"` },
              ],
            },
          ],
          [{ id: 'warehouse', name: `Warehouse ${SECRET}`, type: 'postgres' }]
        ),
        project('p2', 'Second', [
          { name: 'Reuse', blocks: [{ id: 'b4', type: 'code', content: `DSN = "${SECRET}"` }] },
        ]),
      ],
    }
  }

  it('leaves no credential anywhere in the serialized report, at any depth', () => {
    const audit = auditWorkspace(leakyWorkspace())

    // Asserted over the whole report rather than a named set of fields. Four fields have leaked in
    // turn, each one added by someone with no reason to think of it as a place a secret could
    // reach — so the test cannot be a list of the fields anyone has thought of so far.
    expect(JSON.stringify(audit)).not.toContain('hunter2correct')
  })

  it('reaches the sections that sit beside issues[], not just issues[] itself', () => {
    const audit = auditWorkspace(leakyWorkspace())

    // Each of these is a separate structure assembled by its own code path, and none of them is an
    // AuditIssue — the shape the original redaction pass was written for.
    expect(audit.integrations[0].consumers[0].projectName).not.toContain('hunter2correct')
    expect(audit.egress[0].projects[0].projectName).not.toContain('hunter2correct')
    expect(audit.credentials[0].projects[0].projectName).not.toContain('hunter2correct')
    expect(JSON.stringify(audit.flow)).not.toContain('hunter2correct')
    expect(JSON.stringify(audit.errors)).not.toContain('hunter2correct')
    expect(audit.root).not.toContain('hunter2correct')
  })

  it('masks the credential rather than discarding the text around it', () => {
    const audit = auditWorkspace(leakyWorkspace())

    // The project is still identifiable; only the password is gone.
    expect(audit.credentials[0].projects[0].projectName).toContain('Export')
    expect(audit.credentials[0].projects[0].projectName).toContain('warehouse.internal')
  })

  it('still scores and counts off the raw names, so redaction cannot change the findings', () => {
    const clean = auditWorkspace(
      workspace([
        project('p1', 'Export', [{ name: 'Notes', blocks: [{ id: 'b3', type: 'code', content: 'DSN = "x"' }] }]),
      ])
    )
    const leaky = auditWorkspace(leakyWorkspace())

    // The leaky workspace has the same shape plus a second project, so the credential is shared.
    expect(leaky.credentials).toHaveLength(1)
    expect(leaky.credentials[0].projects).toHaveLength(2)
    expect(clean.credentials).toHaveLength(0)
  })
})

describe('auditWorkspace — egress blockCount counts blocks', () => {
  it('counts a host once per block, not once per mention', () => {
    // `findExternalEndpoints` returns one endpoint per line and direction. Incrementing per
    // endpoint made one block posting twice read as two blocks — in the field called
    // `blockCount`, in the `— n blocks` line of the report, and on the flow edge.
    const audit = auditWorkspace(
      workspace([
        project('p1', 'Alpha', [
          {
            name: 'N',
            blocks: [
              {
                id: 'b1',
                type: 'code',
                content: [
                  'requests.post("https://hooks.example.com/a", data=df)',
                  'requests.post("https://hooks.example.com/b", data=df)',
                ].join('\n'),
              },
              { id: 'b2', type: 'code', content: 'requests.post("https://hooks.example.com/c", data=df)' },
            ],
          },
        ]),
      ])
    )

    expect(audit.egress).toHaveLength(1)
    expect(audit.egress[0].blockCount).toBe(2)
    expect(audit.egress[0].projects[0].blockCount).toBe(2)
    expect(audit.flow.edges.filter(edge => edge.kind === 'writes').map(edge => edge.blockCount)).toEqual([2])
  })

  it('still raises one finding per line, because each is a separate place to change', () => {
    const audit = auditWorkspace(
      workspace([
        project('p1', 'Alpha', [
          {
            name: 'N',
            blocks: [
              {
                id: 'b1',
                type: 'code',
                content: [
                  'requests.post("https://hooks.example.com/a", data=df)',
                  'requests.post("https://hooks.example.com/b", data=df)',
                ].join('\n'),
              },
            ],
          },
        ]),
      ])
    )

    expect(issuesOf(audit, 'egress-external')).toHaveLength(2)
  })
})

describe('auditWorkspace — the per-project checks get the project integrations', () => {
  it('reads a double-quoted boolean through the block dialect, as lint does', () => {
    // Omitting the integration list made the audit quietly weaker than the lint it subsumes:
    // every dialect-dependent finding resolved to the unknown dialect and stayed silent.
    const audit = auditWorkspace(
      workspace([
        project(
          'p1',
          'Alpha',
          [
            {
              name: 'N',
              blocks: [
                { id: 'b1', type: 'sql', content: 'SELECT * FROM users WHERE is_active = "true"', integrationId: 'wh' },
              ],
            },
          ],
          [{ id: 'wh', name: 'Warehouse', type: 'mysql' }]
        ),
      ])
    )

    expect(issuesOf(audit, 'sql-string-boolean')).toHaveLength(1)
  })

  it('leaves the same query alone on an identifier-quoting warehouse', () => {
    const audit = auditWorkspace(
      workspace([
        project(
          'p1',
          'Alpha',
          [
            {
              name: 'N',
              blocks: [
                { id: 'b1', type: 'sql', content: 'SELECT * FROM users WHERE is_active = "true"', integrationId: 'wh' },
              ],
            },
          ],
          [{ id: 'wh', name: 'Warehouse', type: 'pgsql' }]
        ),
      ])
    )

    expect(issuesOf(audit, 'sql-string-boolean')).toEqual([])
  })
})

describe('auditWorkspace — credential-shared reach', () => {
  function credProject(id: string, name: string, modifiedAt: string): WorkspaceProject {
    return datedProject(id, name, modifiedAt, [
      { name: 'Setup', blocks: [{ id: `${id}-b0`, type: 'code', content: 'key = "AKIAIOSFODNN7EXAMPLE"' }] },
    ])
  }

  const HOLDERS = ['h1', 'h2', 'h3', 'h4', 'h5']

  it('measures reach over the projects holding the credential, not the whole workspace', () => {
    // Five abandoned projects share a key, in a workspace that also has five live projects doing
    // something else. Counting live projects workspace-wide and clamping to the credential's own
    // project count scored those five as if all five were live.
    const audit = auditWorkspace(
      workspace([
        ...HOLDERS.map(id => credProject(id, id, daysAgo(1800))),
        ...['x1', 'x2', 'x3', 'x4', 'x5'].map(id => datedProject(id, id, daysAgo(10), [{ name: 'N', blocks: [] }])),
      ]),
      { now: NOW }
    )

    const shared = issuesOf(audit, 'credential-shared')
    expect(shared).toHaveLength(5)
    expect(shared[0].details?.projectIds).toEqual(HOLDERS)
    // No live holder, so reach collapses to the floor the code deliberately keeps for an exposure
    // finding — a key does not stop working because the notebook went quiet.
    expect(shared[0].score.blastRadius).toBeCloseTo(0.6, 5)
  })

  it('scores a credential shared by live projects well above the floor', () => {
    const audit = auditWorkspace(workspace(HOLDERS.map(id => credProject(id, id, daysAgo(10)))), { now: NOW })

    expect(issuesOf(audit, 'credential-shared')[0].score.blastRadius).toBeGreaterThan(0.75)
  })
})

describe('holderReach', () => {
  const ages = new Map<string, AssetAge>([
    ['live-1', { liveness: 'live' }],
    ['live-2', { liveness: 'live' }],
    ['cold-1', { liveness: 'cold' }],
    ['cold-2', { liveness: 'cold' }],
    ['cold-3', { liveness: 'cold' }],
  ])

  it('counts live projects among the holders, never across the workspace', () => {
    // The trap this helper exists to close: three cold holders in a workspace that has two live
    // projects elsewhere. A workspace-wide count clamped to the holder count returns two.
    expect(holderReach({ projectIds: ['cold-1', 'cold-2', 'cold-3'] }, ages)).toEqual({ live: 0, total: 3 })
  })

  it('counts the live holders when there are some', () => {
    expect(holderReach({ projectIds: ['live-1', 'cold-1'] }, ages)).toEqual({ live: 1, total: 2 })
  })

  it('ignores a holder the workspace has no age for', () => {
    expect(holderReach({ projectIds: ['live-1', 'never-seen'] }, ages)).toEqual({ live: 1, total: 2 })
  })

  it('prefers the holder list over a projectCount that disagrees with it', () => {
    expect(holderReach({ projectIds: ['live-1'], projectCount: 9 }, ages)).toEqual({ live: 1, total: 1 })
  })

  it('reports no live reach rather than guessing when the holders are not named', () => {
    // Understating an unknown is survivable; inventing live reach for a finding that never said
    // which projects hold it is the thing that made the ranking untrustworthy.
    expect(holderReach({ projectCount: 4 }, ages)).toEqual({ live: 0, total: 4 })
    expect(holderReach(undefined, ages)).toEqual({ live: 0, total: 1 })
  })
})

describe('auditWorkspace — one table identity, shared with the divergence anchors', () => {
  it('merges a qualified and a bare reference to the same table', () => {
    // Keyed on the name as written, these were two rows with two reach counts — while the join
    // anchors, which fold to the short name, treated them as one table. Reach is the multiplier
    // the whole ranking rests on, so the split under-counted every finding on either row.
    const audit = auditWorkspace(
      workspace([
        project(
          'p1',
          'Qualified',
          [
            {
              name: 'A',
              blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM analytics.users', integrationId: 'wh' }],
            },
          ],
          [{ id: 'wh', name: 'Warehouse', type: 'snowflake' }]
        ),
        project(
          'p2',
          'Bare',
          [{ name: 'B', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM users', integrationId: 'wh' }] }],
          [{ id: 'wh', name: 'Warehouse', type: 'snowflake' }]
        ),
      ])
    )

    const users = audit.tables.filter(table => table.name === 'users')
    expect(users).toHaveLength(1)
    expect(users[0].projectCount).toBe(2)
    expect(users[0].blockCount).toBe(2)
    // Both spellings are kept, so the merge is visible rather than silent.
    expect(users[0].qualifiedNames).toEqual(['analytics.users', 'users'])
  })

  it('keeps same-named tables behind two integrations apart', () => {
    const audit = auditWorkspace(
      workspace([
        project(
          'p1',
          'Prod',
          [
            {
              name: 'A',
              blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM analytics.users', integrationId: 'prod' }],
            },
          ],
          [{ id: 'prod', name: 'Prod warehouse', type: 'snowflake' }]
        ),
        project(
          'p2',
          'Staging',
          [
            {
              name: 'B',
              blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM staging.users', integrationId: 'stg' }],
            },
          ],
          [{ id: 'stg', name: 'Staging warehouse', type: 'snowflake' }]
        ),
      ])
    )

    const users = audit.tables.filter(table => table.name === 'users')
    expect(users).toHaveLength(2)
    expect(users.map(table => table.integrationId).sort()).toEqual(['prod', 'stg'])
    expect(users.every(table => table.projectCount === 1)).toBe(true)
  })

  it('keeps a block that declares no integration out of a known integration bucket', () => {
    const audit = auditWorkspace(
      workspace([
        project(
          'p1',
          'Declared',
          [{ name: 'A', blocks: [{ id: 'b1', type: 'sql', content: 'SELECT * FROM users', integrationId: 'wh' }] }],
          [{ id: 'wh', name: 'Warehouse', type: 'snowflake' }]
        ),
        project('p2', 'Undeclared', [
          { name: 'B', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT * FROM users' }] },
        ]),
      ])
    )

    const users = audit.tables.filter(table => table.name === 'users')
    expect(users).toHaveLength(2)
    expect(users.map(table => table.integrationId).sort()).toEqual(['unknown', 'wh'])
  })

  it('scores a finding against the merged reach, not half of it', () => {
    const qualified = (id: string, name: string) =>
      datedProject(
        id,
        name,
        daysAgo(10),
        [
          {
            name: 'N',
            blocks: [
              {
                id: `${id}-b`,
                type: 'sql',
                content: 'SELECT * FROM analytics.users WHERE deleted_at = NULL',
                integrationId: 'wh',
              },
            ],
          },
        ],
        [{ id: 'wh', name: 'Warehouse', type: 'snowflake' }]
      )
    const bare = (id: string, name: string) =>
      datedProject(
        id,
        name,
        daysAgo(10),
        [{ name: 'N', blocks: [{ id: `${id}-b`, type: 'sql', content: 'SELECT * FROM users', integrationId: 'wh' }] }],
        [{ id: 'wh', name: 'Warehouse', type: 'snowflake' }]
      )

    const audit = auditWorkspace(
      workspace([qualified('p1', 'One'), ...['p2', 'p3', 'p4', 'p5'].map(id => bare(id, id))]),
      { now: NOW }
    )

    // The four bare readers count towards the reach of the one qualified writer's finding.
    expect(audit.tables.filter(table => table.name === 'users')).toHaveLength(1)
    expect(issuesOf(audit, 'sql-null-comparison')[0].score.blastRadius).toBeGreaterThan(0.75)
  })
})

describe('auditWorkspace — divergence', () => {
  /** A project whose single notebook holds one SQL block per query. */
  function sqlProject(id: string, name: string, queries: string[], modifiedAt = daysAgo(30)): WorkspaceProject {
    return datedProject(id, name, modifiedAt, [
      {
        name: 'Queries',
        blocks: queries.map((content, index) => ({ id: `${id}-b${index}`, type: 'sql', content })),
      },
    ])
  }

  const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
  const JOIN_REVERSED = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id'
  const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

  it('finds a table pair joined two ways across projects', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN]),
        sqlProject('p2', 'Beta', [JOIN_REVERSED]),
        sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(audit.divergence).toHaveLength(1)
    expect(audit.divergence[0]).toMatchObject({
      kind: 'join',
      anchorLabel: 'orders ↔ users',
      observations: 3,
      projectCount: 3,
    })
    // The reversed, unaliased spelling in Beta is the same claim as Alpha's, not a third variant.
    expect(audit.divergence[0].consensus.label).toBe('orders.user_id = users.id')
    expect(audit.divergence[0].consensus.members).toHaveLength(2)
  })

  it('raises one finding per diverging block, pointed at that block', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN, JOIN]),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    const findings = issuesOf(audit, 'sql-divergence')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ projectName: 'Gamma', blockId: 'p3-b0', severity: 'warning' })
    expect(findings[0].message).toContain('orders.email = users.email')
    expect(findings[0].message).toContain('3 of 4 queries across 3 projects')
  })

  it('reports the evidence behind the ranking, so the score can be recomputed', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN]),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN]),
        sqlProject('p4', 'Delta', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(issuesOf(audit, 'sql-divergence')[0].details).toMatchObject({
      kind: 'join',
      consensus: 'orders.user_id = users.id',
      variant: 'orders.email = users.email',
      observations: 4,
      consensusCount: 3,
      projectCount: 4,
    })
  })

  it('raises no finding below the confidence floor, but still reports the group', () => {
    // Two agreeing and one dissenting scores 0.21 — under the 0.25 default. The group stays in the
    // report because somebody has to be able to look at the ones that did not make the cut.
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN]),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(audit.divergence).toHaveLength(1)
    expect(issuesOf(audit, 'sql-divergence')).toEqual([])
  })

  it('honours an explicit confidence floor', () => {
    const projects = [
      sqlProject('p1', 'Alpha', [JOIN]),
      sqlProject('p2', 'Beta', [JOIN]),
      sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
    ]

    expect(
      issuesOf(auditWorkspace(workspace(projects), { now: NOW, minConfidence: 0.1 }), 'sql-divergence')
    ).toHaveLength(1)
    expect(issuesOf(auditWorkspace(workspace(projects), { now: NOW, minConfidence: 0.9 }), 'sql-divergence')).toEqual(
      []
    )
  })

  it('scores a divergence by what live work reads the tables it is about', () => {
    const live = [
      sqlProject('p1', 'Alpha', [JOIN]),
      sqlProject('p2', 'Beta', [JOIN]),
      sqlProject('p3', 'Gamma', [JOIN]),
      sqlProject('p4', 'Delta', [JOIN_DIVERGENT]),
      sqlProject('p5', 'Epsilon', [JOIN]),
    ]
    // The same disagreement, in a workspace nobody has touched in five years.
    const cold = live.map(project => ({
      ...project,
      modifiedAt: daysAgo(2000),
      notebooks: project.notebooks.map(notebook => ({ ...notebook, modifiedAt: daysAgo(2000) })),
    }))

    const fresh = issuesOf(auditWorkspace(workspace(live), { now: NOW }), 'sql-divergence')[0]
    const stale = issuesOf(auditWorkspace(workspace(cold), { now: NOW }), 'sql-divergence')[0]

    expect(fresh.score.blastRadius).toBeGreaterThan(stale.score.blastRadius)
    // Neglect still raises the abandoned one: nobody is watching it either.
    expect(stale.score.neglect).toBeGreaterThan(fresh.score.neglect)
  })

  it('sets signal from the Wilson confidence rather than from the code', () => {
    const thin = auditWorkspace(
      workspace([sqlProject('p1', 'Alpha', [JOIN, JOIN, JOIN]), sqlProject('p2', 'Beta', [JOIN_DIVERGENT])]),
      { now: NOW }
    )
    const thick = auditWorkspace(
      workspace([
        sqlProject(
          'p1',
          'Alpha',
          Array.from({ length: 20 }, () => JOIN)
        ),
        sqlProject('p2', 'Beta', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(issuesOf(thick, 'sql-divergence')[0].score.signal).toBeGreaterThan(
      issuesOf(thin, 'sql-divergence')[0].score.signal
    )
  })

  /** The filter anchor is opt-in, so every filter test asks for it explicitly. */
  const FILTER_WORKSPACE = () =>
    workspace([
      sqlProject('p1', 'Alpha', ['SELECT * FROM orders WHERE is_test = false']),
      sqlProject('p2', 'Beta', ['SELECT * FROM orders o WHERE o.is_test = false']),
      sqlProject('p3', 'Gamma', ['SELECT * FROM orders WHERE is_test = false']),
      sqlProject('p4', 'Delta', ['SELECT count(*) FROM orders']),
    ])

  it('finds the query that omits a filter the rest of the workspace applies', () => {
    const audit = auditWorkspace(FILTER_WORKSPACE(), { now: NOW, divergenceKinds: ['filter'] })

    const finding = issuesOf(audit, 'sql-divergence')[0]
    expect(finding.projectName).toBe('Delta')
    expect(finding.message).toContain('without constraining orders.is_test')
    expect(finding.details).toMatchObject({ kind: 'filter', observations: 4, consensusCount: 3 })
  })

  it('does not look for filter anchors unless asked', () => {
    // The lowest-precision anchor of the three, and the one that produces the most findings — one
    // per query that merely omits the filter. What it reliably catches that is actually wrong is
    // a comparison against NULL, which `sql-null-comparison` already catches per query.
    const audit = auditWorkspace(FILTER_WORKSPACE(), { now: NOW })

    expect(audit.divergence.filter(group => group.kind === 'filter')).toEqual([])
    expect(issuesOf(audit, 'sql-divergence')).toEqual([])
  })

  it('finds one metric name backed by two aggregates', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', ['SELECT sum(o.amount) AS revenue FROM orders o']),
        sqlProject('p2', 'Beta', ['SELECT sum(amount) AS revenue FROM orders']),
        sqlProject('p3', 'Gamma', ['SELECT sum(o.amount) AS revenue FROM orders o']),
        sqlProject('p4', 'Delta', ['SELECT sum(o.amount_gross) AS revenue FROM orders o']),
      ]),
      { now: NOW }
    )

    const finding = issuesOf(audit, 'sql-divergence')[0]
    expect(finding.projectName).toBe('Delta')
    expect(finding.details).toMatchObject({
      kind: 'metric',
      consensus: 'sum(orders.amount)',
      variant: 'sum(orders.amount_gross)',
    })
  })

  it('skips the consensus checks entirely when asked', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN]),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
      ]),
      { now: NOW, divergence: false }
    )

    expect(audit.divergence).toEqual([])
    expect(issuesOf(audit, 'sql-divergence')).toEqual([])
  })

  it('runs only the anchor families it is asked for', () => {
    const corpus = [
      'SELECT sum(x) AS m FROM t JOIN u ON t.id = u.t_id',
      'SELECT sum(x) AS m FROM t JOIN u ON t.id = u.t_id',
      'SELECT avg(x) AS m FROM t JOIN u ON t.x = u.x',
    ]
    const audit = auditWorkspace(
      workspace(corpus.map((query, index) => sqlProject(`p${index}`, `P${index}`, [query]))),
      { now: NOW, divergenceKinds: ['metric'] }
    )

    expect(audit.divergence.map(group => group.kind)).toEqual(['metric'])
  })

  it('says precision is unvalidated whenever it reports a group', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', [JOIN]),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(audit.notes.some(note => note.includes('precision is unvalidated'))).toBe(true)
  })

  it('folds a qualified and an unqualified name into one table', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', ['SELECT * FROM analytics.public.orders o JOIN prod.users u ON o.user_id = u.id']),
        sqlProject('p2', 'Beta', [JOIN]),
        sqlProject('p3', 'Gamma', [JOIN]),
        sqlProject('p4', 'Delta', [JOIN_DIVERGENT]),
      ]),
      { now: NOW }
    )

    expect(audit.divergence[0].consensus.members).toHaveLength(3)
  })

  it('reports nothing for a workspace whose queries share no subject', () => {
    const audit = auditWorkspace(
      workspace([
        sqlProject('p1', 'Alpha', ['SELECT * FROM alpha_only']),
        sqlProject('p2', 'Beta', ['SELECT * FROM beta_only']),
        sqlProject('p3', 'Gamma', ['SELECT * FROM gamma_only']),
      ]),
      { now: NOW }
    )

    expect(audit.divergence).toEqual([])
  })
})

describe('auditWorkspace — notebook ages are scoped to their project', () => {
  /** Two projects sharing a notebook id, which is what forking a project produces. */
  function forkedWorkspace(): LoadedWorkspace {
    const withNotebookId = (id: string, modifiedAt: string): WorkspaceProject => {
      const built = datedProject(id, id, modifiedAt, [
        { name: 'Report', blocks: [{ id: `${id}-b`, type: 'code', content: 'x = 1' }] },
      ])
      return { ...built, notebooks: built.notebooks.map(notebook => ({ ...notebook, id: 'shared-notebook-id' })) }
    }
    return workspace([withNotebookId('original', daysAgo(2000)), withNotebookId('fork', daysAgo(5))])
  }

  it('does not let a fork hide the original notebook staleness', () => {
    // Keyed on the notebook id alone, the fork's fresh age overwrote the original's — so the
    // three-year-old notebook raised no `asset-stale` finding at all, and the maintenance summary
    // counted one notebook where there were two.
    const audit = auditWorkspace(forkedWorkspace(), { now: NOW })

    expect(audit.staleness.dated).toBe(2)
    expect(audit.staleness.cold).toBe(1)
    expect(audit.staleness.live).toBe(1)
    expect(issuesOf(audit, 'asset-stale').map(issue => issue.projectId)).toEqual(['original'])
  })
})

describe('auditWorkspace — a suppressed finding is still a published finding', () => {
  function sqlProject(id: string, name: string, queries: string[]): WorkspaceProject {
    return datedProject(id, name, daysAgo(30), [
      {
        name: 'Queries',
        blocks: queries.map((content, index) => ({ id: `${id}-b${index}`, type: 'sql', content })),
      },
    ])
  }

  const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
  const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'
  const SUBJECT = 'jane.doe@acme-corp.io'

  /** Answers every candidate the same way, so no network is involved. */
  const rejectAll: TriageProvider = {
    async triage(batch) {
      return batch.map(candidate => ({
        id: candidate.id,
        verdict: 'false-positive' as const,
        reason: 'the two joins answer different questions',
      }))
    },
  }

  it('redacts the locating metadata of findings the model suppressed, not only of ranked ones', async () => {
    // The diverging query sits in a notebook named after the person it is about, which is how an
    // address reaches `notebookName` and `path` in the first place.
    const projects = [
      sqlProject('p1', 'Alpha', [JOIN]),
      sqlProject('p2', 'Beta', [JOIN]),
      sqlProject('p3', 'Gamma', [JOIN]),
      datedProject('p4', 'Delta', daysAgo(30), [
        { name: `churn for ${SUBJECT}`, blocks: [{ id: 'p4-b0', type: 'sql', content: JOIN_DIVERGENT }] },
      ]),
    ]
    const tree = workspace(projects)

    const deterministic = auditWorkspace(tree, { now: NOW })
    const { results } = await runTriage(deterministic.divergence, { provider: rejectAll })
    const audit = auditWorkspace(tree, { now: NOW, triage: results })

    // Suppression takes the finding out of the work queue, not out of the report.
    expect(issuesOf(audit, 'sql-divergence')).toEqual([])
    expect(audit.suppressed).toHaveLength(1)
    expect(audit.suppressed[0].details).toMatchObject({ verdict: 'false-positive' })

    expect(audit.suppressed[0].notebookName).not.toContain(SUBJECT)
    expect(audit.suppressed[0].path).not.toContain(SUBJECT)
    expect(JSON.stringify(audit.suppressed)).not.toContain(SUBJECT)
  })

  it('redacts it the same way it redacts a ranked one', async () => {
    const projects = [
      sqlProject('p1', 'Alpha', [JOIN]),
      sqlProject('p2', 'Beta', [JOIN]),
      sqlProject('p3', 'Gamma', [JOIN]),
      datedProject('p4', 'Delta', daysAgo(30), [
        { name: `churn for ${SUBJECT}`, blocks: [{ id: 'p4-b0', type: 'sql', content: JOIN_DIVERGENT }] },
      ]),
    ]
    const tree = workspace(projects)

    const ranked = issuesOf(auditWorkspace(tree, { now: NOW }), 'sql-divergence')[0]
    const { results } = await runTriage(auditWorkspace(tree, { now: NOW }).divergence, { provider: rejectAll })
    const suppressed = auditWorkspace(tree, { now: NOW, triage: results }).suppressed[0]

    // Same finding, same block, one verdict apart: the two must not disagree about what is safe to
    // print, which is the property that makes a single redaction pass worth having.
    expect(suppressed.blockId).toBe(ranked.blockId)
    expect(suppressed.notebookName).toBe(ranked.notebookName)
    expect(suppressed.path).toBe(ranked.path)
  })
})

describe('auditWorkspace — the same disagreement behind two integrations is two candidates', () => {
  const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
  const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

  /** A project whose SQL all runs against `integrationId`. */
  function scopedProject(id: string, integrationId: string, queries: string[]): WorkspaceProject {
    return datedProject(
      id,
      id,
      daysAgo(30),
      [
        {
          name: 'Queries',
          blocks: queries.map((content, index) => ({ id: `${id}-b${index}`, type: 'sql', content, integrationId })),
        },
      ],
      [{ id: integrationId, name: integrationId, type: 'snowflake' }]
    )
  }

  /** Two warehouses, each with the same table pair diverging the same way. */
  function twoWarehouses(): LoadedWorkspace {
    return workspace([
      ...['a1', 'a2', 'a3'].map(id => scopedProject(id, 'prod', [JOIN])),
      scopedProject('a4', 'prod', [JOIN_DIVERGENT]),
      ...['b1', 'b2', 'b3'].map(id => scopedProject(id, 'staging', [JOIN])),
      scopedProject('b4', 'staging', [JOIN_DIVERGENT]),
    ])
  }

  it('produces one group per integration, not one shared group', () => {
    const audit = auditWorkspace(twoWarehouses(), { now: NOW })
    const joins = audit.divergence.filter(group => group.kind === 'join')

    expect(joins).toHaveLength(2)
    expect(joins.map(group => group.scopeKey).sort()).toEqual(['prod', 'staging'])
  })

  it('exports two review entries with different ids', () => {
    // The two groups agree on kind, subject and every variant form, and differ only in the
    // warehouse they describe. Hashing without the scope gave them one id, so a reviewer's verdict
    // on one silently governed the other and the precision denominator counted one group twice.
    const file = buildReviewFile(auditWorkspace(twoWarehouses(), { now: NOW }).divergence)
    const joins = file.entries.filter(entry => entry.kind === 'join')

    expect(joins).toHaveLength(2)
    expect(joins[0].subject).toBe(joins[1].subject)
    expect(joins[0].variants.map(v => v.form)).toEqual(joins[1].variants.map(v => v.form))
    expect(joins[0].id).not.toBe(joins[1].id)
  })

  it('applies a verdict to the warehouse it was given for, and leaves the other on its prior', () => {
    const audit = auditWorkspace(twoWarehouses(), { now: NOW })
    const prodGroup = audit.divergence.find(group => group.kind === 'join' && group.scopeKey === 'prod')
    expect(prodGroup).toBeDefined()

    const judged = auditWorkspace(twoWarehouses(), {
      now: NOW,
      triage: new Map([
        [
          toCandidate(prodGroup as DivergenceGroup).id,
          { id: toCandidate(prodGroup as DivergenceGroup).id, verdict: 'real' as const, reason: 'different column' },
        ],
      ]),
    })

    const sources = new Map(
      judged.issues
        .filter(issue => issue.code === 'sql-divergence' && issue.details?.kind === 'join')
        .map(issue => [issue.details?.scopeKey as string, issue.details?.signalSource as string])
    )

    expect(sources.get('prod')).toBe('triage')
    expect(sources.get('staging')).toBe('prior')
  })
})

describe('resolveBlockIntegration', () => {
  it('keeps what the block declares', () => {
    expect(resolveBlockIntegration('wh', ['wh', 'other'])).toEqual({ id: 'wh', source: 'declared' })
  })

  it('attributes an undeclared block when the project leaves no choice', () => {
    expect(resolveBlockIntegration(undefined, ['wh'])).toEqual({ id: 'wh', source: 'inferred' })
  })

  it('leaves an undeclared block unscoped when the project declares none', () => {
    expect(resolveBlockIntegration(undefined, [])).toEqual({ source: 'unknown' })
  })

  it('leaves an undeclared block unscoped when the project declares several', () => {
    // Two candidates is the ambiguity the unknown bucket exists for; picking one would merge
    // tables that may well be different.
    expect(resolveBlockIntegration(undefined, ['wh', 'other'])).toEqual({ source: 'unknown' })
  })
})

describe('auditWorkspace — attributing SQL blocks that declare no integration', () => {
  const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
  const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

  function proj(
    id: string,
    queries: Array<{ sql: string; integrationId?: string }>,
    declared: string[]
  ): WorkspaceProject {
    return datedProject(
      id,
      id,
      daysAgo(30),
      [
        {
          name: 'Queries',
          blocks: queries.map((query, index) => ({
            id: `${id}-b${index}`,
            type: 'sql',
            content: query.sql,
            ...(query.integrationId ? { integrationId: query.integrationId } : {}),
          })),
        },
      ],
      declared.map(integrationId => ({ id: integrationId, name: integrationId, type: 'snowflake' }))
    )
  }

  it('compares an undeclared block against the one integration its project declares', () => {
    const audit = auditWorkspace(
      workspace([
        // Enough agreement to clear the confidence floor, so the dissenter reaches `issues`.
        ...['a1', 'a2', 'a3', 'a4', 'a5'].map(id => proj(id, [{ sql: JOIN, integrationId: 'wh' }], ['wh'])),
        // Declares nothing on the block, but the project declares exactly one integration.
        proj('a6', [{ sql: JOIN_DIVERGENT }], ['wh']),
      ]),
      { now: NOW }
    )

    const joins = audit.divergence.filter(group => group.kind === 'join')
    expect(joins).toHaveLength(1)
    expect(joins[0].scopeKey).toBe('wh')
    expect(joins[0].observations).toBe(6)

    const finding = audit.issues.find(issue => issue.code === 'sql-divergence')
    expect(finding?.projectId).toBe('a6')
    expect(finding?.details?.integrationSource).toBe('inferred')
  })

  it('does not attribute a block whose project declares more than one integration', () => {
    const audit = auditWorkspace(
      workspace([
        proj('a1', [{ sql: JOIN, integrationId: 'wh' }], ['wh']),
        proj('a2', [{ sql: JOIN, integrationId: 'wh' }], ['wh']),
        proj('a3', [{ sql: JOIN_DIVERGENT }], ['wh', 'other']),
      ]),
      { now: NOW }
    )

    // The dissenter lands in the unknown bucket, so the `wh` group never sees it and agrees.
    const joins = audit.divergence.filter(group => group.kind === 'join' && group.scopeKey === 'wh')
    expect(joins).toHaveLength(0)
    expect(audit.notes.some(note => note.includes('could not be attributed'))).toBe(true)
  })

  it('never pools an unattributable block with a named warehouse', () => {
    const audit = auditWorkspace(
      workspace([
        proj('a1', [{ sql: JOIN, integrationId: 'wh' }], ['wh']),
        proj('a2', [{ sql: JOIN, integrationId: 'wh' }], ['wh']),
        proj('a3', [{ sql: JOIN_DIVERGENT }], []),
      ]),
      { now: NOW }
    )

    expect(audit.divergence.filter(group => group.scopeKey === 'wh' && group.kind === 'join')).toHaveLength(0)
  })

  it('reports how many blocks were attributed rather than declared', () => {
    const audit = auditWorkspace(workspace([proj('a1', [{ sql: JOIN }, { sql: JOIN_DIVERGENT }], ['wh'])]), {
      now: NOW,
    })

    expect(audit.notes.some(note => note.includes('attributed to it'))).toBe(true)
  })

  it('does not count an inferred attribution as usage, so an orphan stays an orphan', () => {
    // Being used by nobody is the finding `ingress-integration-orphan` exists to make. An
    // attribution is good enough to scope a comparison and is not evidence that a block ran.
    const audit = auditWorkspace(workspace([proj('a1', [], ['wh'])]), { now: NOW })

    expect(audit.integrations.find(usage => usage.id === 'wh')?.orphan).toBe(true)
  })
})

describe('auditWorkspace — blast radius stays inside the group integration scope', () => {
  const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
  const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

  function scoped(id: string, integrationId: string, sql: string): WorkspaceProject {
    return datedProject(
      id,
      id,
      daysAgo(10),
      [{ name: 'Q', blocks: [{ id: `${id}-b`, type: 'sql', content: sql, integrationId }] }],
      [{ id: integrationId, name: integrationId, type: 'snowflake' }]
    )
  }

  /** A large production warehouse and a small staging one, both with a `users` table. */
  function twoSizes(): LoadedWorkspace {
    return workspace([
      ...Array.from({ length: 30 }, (_, index) => scoped(`prod${index}`, 'prod', JOIN)),
      ...Array.from({ length: 5 }, (_, index) => scoped(`stg${index}`, 'staging', JOIN)),
      scoped('stgX', 'staging', JOIN_DIVERGENT),
    ])
  }

  it('scores a staging disagreement on staging reach, not production reach', () => {
    // `tables` holds one row per (short name, integration). Merging those rows by short name and
    // taking the maximum gave a six-project staging finding the reach of a thirty-project
    // production table — the cross-warehouse mixing that integration scoping exists to prevent.
    const audit = auditWorkspace(twoSizes(), { now: NOW })

    const rows = audit.tables.filter(table => table.name === 'users')
    expect(rows.map(row => row.projectCount).sort((a, b) => a - b)).toEqual([6, 30])

    const finding = audit.issues.find(issue => issue.code === 'sql-divergence')
    expect(finding?.details?.scopeKey).toBe('staging')
    // Six live projects, not thirty. Thirty saturates the radius to within a rounding error of 1,
    // so the threshold has to be well below that to tell the two apart.
    expect(finding?.score.blastRadius).toBeLessThan(0.95)
  })

  it('merges across integrations when the scope deliberately spans them', () => {
    // `--divergence-scope none` pools every warehouse, so the group really is about both tables
    // and the merged reach is the right answer for it.
    const audit = auditWorkspace(twoSizes(), { now: NOW, divergenceScope: 'none' })

    const finding = audit.issues.find(issue => issue.code === 'sql-divergence')
    expect(finding?.details?.scopeRule).toBe('none')
    // All 36 projects read the one pooled `users`, so the radius saturates.
    expect(finding?.score.blastRadius).toBeGreaterThan(0.99)
  })
})

describe('auditWorkspace — dependencies', () => {
  /** A project with a declared environment and optional install blocks. */
  function depProject(
    id: string,
    name: string,
    environment: { packages?: Record<string, string>; requirements?: string[] } | undefined,
    installs: string[] = [],
    modifiedAt = daysAgo(30)
  ): WorkspaceProject {
    const built = datedProject(id, name, modifiedAt, [
      {
        name: 'Setup',
        blocks: installs.map((content, index) => ({ id: `${id}-i${index}`, type: 'code', content })),
      },
    ])
    return environment ? { ...built, environment } : built
  }

  it('builds a bill of materials across the workspace', () => {
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { packages: { pandas: '2.0.1', numpy: '1.26.0' } }),
      ]),
      { now: NOW }
    )

    expect(audit.packages.map(entry => `${entry.name}:${entry.projects.length}`)).toEqual(['pandas:2', 'numpy:1'])
    expect(audit.packages[0].purl).toBe('pkg:pypi/pandas@2.0.1')
  })

  it('reports drift when two maintained projects pin different versions', () => {
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { packages: { pandas: '1.5.3' } }),
      ]),
      { now: NOW }
    )

    const pandas = audit.packages.find(entry => entry.name === 'pandas')
    expect(pandas?.drifted).toBe(true)
    expect(pandas?.maintainedVersions).toEqual(['1.5.3', '2.0.1'])
    // One finding per project, because neither side is the wrong one — they disagree.
    expect(issuesOf(audit, 'dependency-drift')).toHaveLength(2)
  })

  it('does not call an abandoned project disagreeing with the present', () => {
    // A 2021 notebook pinning the 2021 version is pinning working as intended. Counting it as
    // drift would put a finding on every package in every workspace with an old project in it.
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { packages: { pandas: '2.0.1' } }),
        depProject('p3', 'Legacy', { packages: { pandas: '1.0.0' } }, [], daysAgo(1800)),
      ]),
      { now: NOW }
    )

    const pandas = audit.packages.find(entry => entry.name === 'pandas')
    expect(pandas?.drifted).toBe(false)
    expect(pandas?.maintainedVersions).toEqual(['2.0.1'])
    // The old version is still inventoried — it is installed somewhere, it just is not a dispute.
    expect(pandas?.versions).toEqual(['1.0.0', '2.0.1'])
    expect(issuesOf(audit, 'dependency-drift')).toEqual([])
  })

  it('takes the weakest pin in the workspace as the package pin', () => {
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { requirements: ['pandas'] }),
      ]),
      { now: NOW }
    )

    expect(audit.packages.find(entry => entry.name === 'pandas')?.pin).toBe('unpinned')
  })

  it('reports an unpinned dependency against the project that declares it', () => {
    const audit = auditWorkspace(workspace([depProject('p1', 'Alpha', { requirements: ['pandas>=2.0'] })]), {
      now: NOW,
    })

    const findings = issuesOf(audit, 'dependency-unpinned')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ projectName: 'Alpha', severity: 'warning' })
    expect(findings[0].details).toMatchObject({ package: 'pandas', pin: 'ranged', declaredIn: 'requirements' })
  })

  it('reports a package a block installs but the environment does not track', () => {
    const audit = auditWorkspace(
      workspace([depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }, ['!pip install seaborn'])]),
      { now: NOW }
    )

    const findings = issuesOf(audit, 'dependency-untracked')
    expect(findings).toHaveLength(1)
    expect(findings[0].details).toMatchObject({ package: 'seaborn' })
    expect(findings[0].blockId).toBe('p1-i0')
  })

  it('does not call everything untracked when there is no environment to track against', () => {
    const audit = auditWorkspace(workspace([depProject('p1', 'Alpha', undefined, ['!pip install seaborn'])]), {
      now: NOW,
    })

    expect(issuesOf(audit, 'dependency-untracked')).toEqual([])
    // It is still unpinned, which is a fact about the install rather than about the environment.
    expect(issuesOf(audit, 'dependency-unpinned')).toHaveLength(1)
  })

  it('does not report a dependency the lockfile pins', () => {
    const audit = auditWorkspace(
      workspace([depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' }, requirements: ['pandas>=2.0'] })]),
      { now: NOW }
    )

    expect(issuesOf(audit, 'dependency-unpinned')).toEqual([])
  })

  it('reports nothing for a workspace that declares no dependencies', () => {
    const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]), { now: NOW })

    expect(audit.packages).toEqual([])
    expect(issuesOf(audit, 'dependency-unpinned')).toEqual([])
  })

  it('scores drift by how many maintained projects disagree', () => {
    const narrow = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { packages: { pandas: '1.5.3' } }),
      ]),
      { now: NOW }
    )
    const wide = auditWorkspace(
      workspace([
        ...['a', 'b', 'c', 'd', 'e'].map(id => depProject(id, id, { packages: { pandas: '2.0.1' } })),
        depProject('f', 'f', { packages: { pandas: '1.5.3' } }),
      ]),
      { now: NOW }
    )

    expect(issuesOf(wide, 'dependency-drift')[0].score.blastRadius).toBeGreaterThan(
      issuesOf(narrow, 'dependency-drift')[0].score.blastRadius
    )
  })

  it('measures drift reach over the projects that disagree, not every live consumer', () => {
    // A live project declaring pandas without a version consumes it but is not party to the
    // dispute, and a workspace-wide live count is not the reach of this finding either. Both come
    // from one list now: the projects that pin a version and disagree.
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { packages: { pandas: '2.0.1' } }),
        depProject('p2', 'Beta', { packages: { pandas: '1.5.3' } }),
        depProject('p3', 'Bare', { requirements: ['pandas'] }),
        depProject('p4', 'Elsewhere', { packages: { numpy: '1.26.0' } }),
      ]),
      { now: NOW }
    )

    const drift = issuesOf(audit, 'dependency-drift')
    expect(drift).toHaveLength(2)
    expect(drift[0].details?.projectIds).toEqual(['p1', 'p2'])
    expect(drift[0].details?.projectCount).toBe(2)
  })

  it('does not count an abandoned holder as live reach', () => {
    // Drift only files against maintained projects today, which is what kept a workspace-wide
    // live count from showing up as a wrong number. Reach is measured among the holders either
    // way, so it stays right if that filter ever loosens.
    const audit = auditWorkspace(
      workspace([
        ...['a', 'b', 'c'].map(id => depProject(id, id, { packages: { pandas: '2.0.1' } })),
        depProject('d', 'd', { packages: { pandas: '1.5.3' } }),
        // Five live projects elsewhere, which are not this finding's reach.
        ...['x1', 'x2', 'x3', 'x4', 'x5'].map(id => depProject(id, id, { packages: { numpy: '1.26.0' } })),
      ]),
      { now: NOW }
    )

    const drift = issuesOf(audit, 'dependency-drift')[0]
    expect(drift.details?.projectCount).toBe(4)
    expect((drift.details?.projectIds as string[]).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ranks a bare name above a bounded range', () => {
    const audit = auditWorkspace(
      workspace([
        depProject('p1', 'Alpha', { requirements: ['pandas'] }),
        depProject('p2', 'Beta', { requirements: ['scipy>=1.11'] }),
      ]),
      { now: NOW }
    )

    const bare = issuesOf(audit, 'dependency-unpinned').find(issue => issue.details?.package === 'pandas')
    const ranged = issuesOf(audit, 'dependency-unpinned').find(issue => issue.details?.package === 'scipy')
    expect(bare?.score.signal).toBeGreaterThan(ranged?.score.signal as number)
  })
})
