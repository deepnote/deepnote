import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { auditWorkspace, CONSENSUS_PROJECT_FLOOR } from './audit'
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
    it('says divergence was not run and why, below the consensus floor', () => {
      const audit = auditWorkspace(workspace([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])]))

      expect(audit.notes.some(note => note.includes(`${CONSENSUS_PROJECT_FLOOR}+ projects`))).toBe(true)
      expect(audit.notes.some(note => note.includes('has 1 project'))).toBe(true)
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
