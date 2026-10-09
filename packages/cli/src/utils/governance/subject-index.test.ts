import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { buildSubjectIndex, inferInternalDomain, lookupSubject, SCATTER_NOTEBOOK_THRESHOLD } from './subject-index'
import { createSubjectFingerprinter } from './subjects'
import type { WorkspaceProject } from './workspace'

const SALT = 'a-sufficiently-long-test-salt'
const fingerprinter = createSubjectFingerprinter(SALT)
const NOW = new Date('2026-10-07T00:00:00.000Z')

interface TestBlock {
  id: string
  content?: string
  outputs?: unknown[]
}

function project(id: string, name: string, notebooks: Array<{ name: string; blocks: TestBlock[] }>): WorkspaceProject {
  return {
    id,
    name,
    dir: name.toLowerCase(),
    integrations: [],
    notebooks: notebooks.map((notebook, index) => ({
      id: `${id}-n${index}`,
      name: notebook.name,
      path: `${name.toLowerCase()}/${notebook.name}.deepnote`,
      blocks: notebook.blocks.map(block => ({
        id: block.id,
        type: 'code',
        content: block.content ?? '',
        metadata: {},
        ...(block.outputs ? { outputs: block.outputs } : {}),
      })) as unknown as DeepnoteBlock[],
    })),
  }
}

function build(projects: WorkspaceProject[], internalDomains?: string[]) {
  return buildSubjectIndex(projects, { fingerprinter, internalDomains, root: '/workspace', now: NOW })
}

describe('buildSubjectIndex', () => {
  it('records a subject by fingerprint and never by address', () => {
    const index = build([
      project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', content: "WHERE email = 'jane@acme-corp.io'" }] }]),
    ])

    expect(index.subjects).toHaveLength(1)
    expect(index.subjects[0]).toMatchObject({
      fingerprint: fingerprinter.fingerprint('jane@acme-corp.io'),
      kind: 'email',
      domain: 'acme-corp.io',
      projectCount: 1,
      notebookCount: 1,
    })
    expect(JSON.stringify(index)).not.toContain('jane@acme-corp.io')
    expect(JSON.stringify(index)).not.toContain(SALT)
  })

  it('points each location at a file, notebook, block, and line', () => {
    const index = build([
      project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', content: "x = 1\ne = 'jane@acme-corp.io'" }] }]),
    ])

    expect(index.subjects[0].locations).toEqual([
      {
        projectId: 'p1',
        projectName: 'Alpha',
        notebookId: 'p1-n0',
        notebookName: 'One',
        blockId: 'b1',
        path: 'alpha/One.deepnote',
        line: 2,
        source: 'content',
      },
    ])
  })

  it('finds subjects in persisted outputs, not just in code', () => {
    const index = build([
      project('p1', 'Alpha', [
        {
          name: 'One',
          blocks: [{ id: 'b1', content: 'SELECT email FROM users', outputs: [{ text: 'jane@acme-corp.io' }] }],
        },
      ]),
    ])

    expect(index.subjects).toHaveLength(1)
    expect(index.subjects[0].locations[0].source).toBe('output')
  })

  it('merges the same person across spellings, projects and notebooks', () => {
    const index = build([
      project('p1', 'Alpha', [
        { name: 'One', blocks: [{ id: 'b1', content: 'jane@acme-corp.io' }] },
        { name: 'Two', blocks: [{ id: 'b2', content: 'Jane+billing@Acme-Corp.io' }] },
      ]),
      project('p2', 'Bravo', [{ name: 'One', blocks: [{ id: 'b3', content: 'jane@acme-corp.io' }] }]),
    ])

    expect(index.subjects).toHaveLength(1)
    expect(index.subjects[0]).toMatchObject({ projectCount: 2, notebookCount: 3 })
    expect(index.subjects[0].locations).toHaveLength(3)
  })

  it('counts notebooks of the same name in different projects separately', () => {
    const index = build([
      project('p1', 'Alpha', [{ name: 'Main', blocks: [{ id: 'b1', content: 'jane@acme-corp.io' }] }]),
      project('p2', 'Bravo', [{ name: 'Main', blocks: [{ id: 'b2', content: 'jane@acme-corp.io' }] }]),
    ])

    expect(index.subjects[0].notebookCount).toBe(2)
  })

  it('classifies subjects by internal domain', () => {
    const index = build(
      [
        project('p1', 'Alpha', [
          {
            name: 'One',
            blocks: [{ id: 'b1', content: 'colleague@deepnote-demo.io customer@acme-corp.io' }],
          },
        ]),
      ],
      ['deepnote-demo.io']
    )

    expect(index.subjects.find(s => s.domain === 'deepnote-demo.io')?.internal).toBe(true)
    expect(index.subjects.find(s => s.domain === 'acme-corp.io')?.internal).toBe(false)
    expect(index.summary.externalSubjects).toBe(1)
  })

  it('accepts an internal domain written with a leading @ or in mixed case', () => {
    const index = build(
      [project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', content: 'a@deepnote-demo.io' }] }])],
      ['@Deepnote-Demo.IO']
    )

    expect(index.subjects[0].internal).toBe(true)
    expect(index.internalDomains).toEqual(['deepnote-demo.io'])
  })

  it('ranks the most scattered subjects first', () => {
    const index = build([
      project('p1', 'Alpha', [
        { name: 'One', blocks: [{ id: 'b1', content: 'everywhere@acme-corp.io once@acme-corp.io' }] },
        { name: 'Two', blocks: [{ id: 'b2', content: 'everywhere@acme-corp.io' }] },
      ]),
    ])

    expect(index.subjects[0].fingerprint).toBe(fingerprinter.fingerprint('everywhere@acme-corp.io'))
    expect(index.subjects[0].notebookCount).toBe(SCATTER_NOTEBOOK_THRESHOLD)
    expect(index.summary.scattered).toBe(1)
  })

  it('summarizes the workspace it covered', () => {
    const index = build([
      project('p1', 'Alpha', [
        { name: 'One', blocks: [{ id: 'b1', content: 'a@acme-corp.io' }] },
        { name: 'Two', blocks: [{ id: 'b2', content: 'b@acme-corp.io' }] },
      ]),
      project('p2', 'Bravo', [{ name: 'One', blocks: [] }]),
    ])

    expect(index.summary).toMatchObject({ subjects: 2, locations: 2, projects: 2, notebooks: 3 })
    expect(index.createdAt).toBe('2026-10-07T00:00:00.000Z')
    expect(index.root).toBe('/workspace')
  })

  it('records the salt fingerprint and not the salt', () => {
    const index = build([project('p1', 'Alpha', [{ name: 'One', blocks: [] }])])

    expect(index.saltFingerprint).toBe(fingerprinter.saltFingerprint)
  })

  it('builds an empty index for a workspace with no subjects', () => {
    const index = build([project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', content: 'x = 1' }] }])])

    expect(index.subjects).toEqual([])
    expect(index.summary).toMatchObject({ subjects: 0, locations: 0, scattered: 0 })
  })

  it('survives outputs that cannot be serialized', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() =>
      build([project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', outputs: [circular] }] }])])
    ).not.toThrow()
  })
})

describe('lookupSubject', () => {
  const index = build([project('p1', 'Alpha', [{ name: 'One', blocks: [{ id: 'b1', content: 'jane@acme-corp.io' }] }])])

  it('finds a subject present in the index', () => {
    const result = lookupSubject(index, 'jane@acme-corp.io', fingerprinter)

    expect(result.saltMatches).toBe(true)
    expect(result.entry?.locations).toHaveLength(1)
  })

  it('reports a subject that is absent', () => {
    const result = lookupSubject(index, 'nobody@acme-corp.io', fingerprinter)

    expect(result.saltMatches).toBe(true)
    expect(result.entry).toBeUndefined()
  })

  it('refuses to answer under a different salt rather than reporting a false negative', () => {
    const other = createSubjectFingerprinter(`${SALT}-rotated`)
    const result = lookupSubject(index, 'jane@acme-corp.io', other)

    expect(result.saltMatches).toBe(false)
    expect(result.entry).toBeUndefined()
  })
})

describe('inferInternalDomain', () => {
  it('returns the most common domain and its share', () => {
    const result = inferInternalDomain([
      { domain: 'deepnote-demo.io' },
      { domain: 'deepnote-demo.io' },
      { domain: 'deepnote-demo.io' },
      { domain: 'acme-corp.io' },
    ])

    expect(result).toEqual({ domain: 'deepnote-demo.io', subjectCount: 3, share: 0.75 })
  })

  it('returns nothing when there are no subjects', () => {
    expect(inferInternalDomain([])).toBeUndefined()
  })
})

describe('buildSubjectIndex — notebooks that share a name', () => {
  it('counts two same-named notebooks in one project as two', () => {
    // Notebook names are not unique within a project. Counting on the name collapsed them, which
    // understates how far a person's data is spread — and that count is what scopes an erasure
    // request and what `pii-subject-scatter` is scored by.
    const index = build([
      project('p1', 'Alpha', [
        { name: 'Analysis', blocks: [{ id: 'b1', content: "e = 'jane@acme-corp.io'" }] },
        { name: 'Analysis', blocks: [{ id: 'b2', content: "e = 'jane@acme-corp.io'" }] },
      ]),
    ])

    expect(index.subjects[0].notebookCount).toBe(2)
    expect(index.subjects[0].locations.map(location => location.notebookId)).toEqual(['p1-n0', 'p1-n1'])
  })

  it('still counts one notebook once however many blocks mention the person', () => {
    const index = build([
      project('p1', 'Alpha', [
        {
          name: 'Analysis',
          blocks: [
            { id: 'b1', content: "e = 'jane@acme-corp.io'" },
            { id: 'b2', content: "also = 'jane@acme-corp.io'" },
          ],
        },
      ]),
    ])

    expect(index.subjects[0].notebookCount).toBe(1)
    expect(index.subjects[0].locations).toHaveLength(2)
  })
})
