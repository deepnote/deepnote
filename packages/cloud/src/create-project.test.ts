import { ApiError } from '@deepnote/database-integrations'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BlockSpec, createProject, type ProjectSpec } from './create-project'

const BASE = 'https://api.deepnote.com'
const TOKEN = 't'

const SPEC: ProjectSpec = {
  name: 'Sales',
  notebooks: [
    {
      name: 'Dashboard',
      blocks: [
        { type: 'input-slider', content: '', metadata: { deepnote_variable_name: 'n' } },
        { type: 'code', content: 'print(n)', metadata: {} },
      ],
    },
  ],
}

/** Route each request to a canned response, and record what was sent. */
function mockApi(
  overrides: { projectNotebooks?: Array<{ id: string; name?: string }>; onDelete?: () => Response } = {}
) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  let notebooksCreated = 0
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

    if (method === 'POST' && path === '/v2/projects') {
      return json(
        { project: { id: 'proj-1', name: 'Sales', notebooks: overrides.projectNotebooks ?? [{ id: 'ph-1' }] } },
        201
      )
    }
    if (method === 'POST' && path === '/v2/notebooks')
      return json({ notebook: { id: `nb-${++notebooksCreated}`, name: body.name } }, 201)
    if (method === 'POST' && path === '/v2/blocks') return json({ block: { id: `blk-${calls.length}` } }, 201)
    if (method === 'DELETE' && path.startsWith('/v2/notebooks/')) return overrides.onDelete?.() ?? json({}, 200)
    return json({ message: 'unexpected' }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('createProject', () => {
  it('creates the project, notebook, and blocks, and returns the new ids', async () => {
    const calls = mockApi()

    const result = await createProject(BASE, TOKEN, SPEC)

    expect(result.projectId).toBe('proj-1')
    expect(result.notebooks).toEqual([{ id: 'nb-1', name: 'Dashboard', blockIds: ['blk-3', 'blk-4'] }])
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /v2/projects',
      'POST /v2/notebooks',
      'POST /v2/blocks',
      'POST /v2/blocks',
      'DELETE /v2/notebooks/ph-1',
    ])
  })

  it('sends each block with its position, so document order survives', async () => {
    const calls = mockApi()

    await createProject(BASE, TOKEN, SPEC)

    const blocks = calls.filter(c => c.path === '/v2/blocks').map(c => c.body as { type: string; position: number })
    expect(blocks).toEqual([
      expect.objectContaining({ type: 'input-slider', position: 0 }),
      expect.objectContaining({ type: 'code', position: 1 }),
    ])
  })

  it('deletes the placeholder notebook Deepnote seeds the project with, and only that one', async () => {
    const calls = mockApi({ projectNotebooks: [{ id: 'ph-1' }, { id: 'ph-2' }] })

    await createProject(BASE, TOKEN, SPEC)

    const deletes = calls.filter(c => c.method === 'DELETE').map(c => c.path)
    expect(deletes).toEqual(['/v2/notebooks/ph-1', '/v2/notebooks/ph-2'])
    // Never the notebook we created.
    expect(deletes).not.toContain('/v2/notebooks/nb-1')
  })

  it('deletes placeholders only after creating our notebooks, so the project is never left empty', async () => {
    const calls = mockApi()

    await createProject(BASE, TOKEN, SPEC)

    const firstDelete = calls.findIndex(c => c.method === 'DELETE')
    const createNotebook = calls.findIndex(c => c.method === 'POST' && c.path === '/v2/notebooks')
    expect(createNotebook).toBeLessThan(firstDelete)
  })

  it('adopts the seeded notebook when a source notebook wants its name, rather than colliding with it', async () => {
    // `POST /v2/notebooks` 409s on a duplicate name and there is no rename endpoint, so a notebook
    // called "Notebook 1" — Deepnote's own default — is only creatable by taking over the seed.
    const calls = mockApi({ projectNotebooks: [{ id: 'ph-1', name: 'Notebook 1' }] })

    const result = await createProject(BASE, TOKEN, {
      name: 'Sales',
      notebooks: [{ name: 'Notebook 1', blocks: [{ type: 'code', content: 'print(1)', metadata: {} }] }],
    })

    expect(calls.filter(c => c.path === '/v2/notebooks' && c.method === 'POST')).toHaveLength(0)
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0)
    expect(result.notebooks).toEqual([{ id: 'ph-1', name: 'Notebook 1', blockIds: ['blk-2'] }])
    expect(calls.find(c => c.path === '/v2/blocks')?.body).toMatchObject({ notebookId: 'ph-1' })
  })

  it('still deletes a seeded notebook no source notebook adopted', async () => {
    const calls = mockApi({ projectNotebooks: [{ id: 'ph-1', name: 'Notebook 1' }, { id: 'ph-2' }] })

    await createProject(BASE, TOKEN, {
      name: 'Sales',
      notebooks: [{ name: 'Notebook 1', blocks: [] }],
    })

    expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/v2/notebooks/ph-2'])
  })

  it('creates every notebook before any block, so a block can reference one of them', async () => {
    // A notebook-function block names the notebook it invokes, and that name has to be Deepnote's
    // id for it — which does not exist while the notebooks are still being created one at a time.
    const calls = mockApi()

    await createProject(BASE, TOKEN, {
      name: 'Sales',
      notebooks: [
        { name: 'First', blocks: [{ type: 'code', content: 'a', metadata: {} }] },
        { name: 'Second', blocks: [{ type: 'code', content: 'b', metadata: {} }] },
      ],
    })

    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /v2/projects',
      'POST /v2/notebooks',
      'POST /v2/notebooks',
      'POST /v2/blocks',
      'POST /v2/blocks',
      'DELETE /v2/notebooks/ph-1',
    ])
  })

  it('rewrites a block against the ids Deepnote assigned, keyed by the caller’s own ids', async () => {
    const calls = mockApi()
    const rewriteBlock = vi.fn((block: BlockSpec, notebookIds: ReadonlyMap<string, string>) => {
      const target = (block.metadata as { calls?: string }).calls
      return target ? { ...block, metadata: { calls: notebookIds.get(target) } } : block
    })

    const result = await createProject(
      BASE,
      TOKEN,
      {
        name: 'Sales',
        notebooks: [
          {
            sourceId: 'local-1',
            name: 'First',
            blocks: [{ type: 'notebook-function', metadata: { calls: 'local-2' } }],
          },
          { sourceId: 'local-2', name: 'Second', blocks: [] },
        ],
      },
      { rewriteBlock }
    )

    // The reference now names the created notebook, not the one the caller knew about.
    const second = result.notebooks[1].id
    expect(calls.find(c => c.path === '/v2/blocks')?.body).toMatchObject({ metadata: { calls: second } })
    expect(rewriteBlock.mock.calls[0][1]).toEqual(
      new Map([
        ['local-1', result.notebooks[0].id],
        ['local-2', second],
      ])
    )
  })

  it('refuses two notebooks sharing a name before it creates anything', async () => {
    // Names are unique within a project, so this 409s partway through and strands a half-built
    // project — the request is worth refusing while it still costs nothing.
    const calls = mockApi()

    await expect(
      createProject(BASE, TOKEN, {
        name: 'Sales',
        notebooks: [
          { name: 'Dupe', blocks: [] },
          { name: 'Dupe', blocks: [] },
        ],
      })
    ).rejects.toThrow(/both named "Dupe"/)
    expect(calls).toHaveLength(0)
  })

  it('refuses a nameless notebook before it creates anything', async () => {
    const calls = mockApi()

    await expect(
      createProject(BASE, TOKEN, { name: 'Sales', notebooks: [{ name: '  ', blocks: [] }] })
    ).rejects.toThrow(/needs a name/)
    expect(calls).toHaveLength(0)
  })

  it('reports a placeholder it could not delete as a warning, without failing the create', async () => {
    mockApi({ onDelete: () => new Response('{"message":"nope"}', { status: 500 }) })
    const onWarning = vi.fn()

    const result = await createProject(BASE, TOKEN, SPEC, { onWarning })

    expect(result.projectId).toBe('proj-1')
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0][0]).toMatch(/placeholder notebook/i)
  })

  it('reports progress across the per-block round-trips', async () => {
    mockApi()
    const onProgress = vi.fn()

    await createProject(BASE, TOKEN, SPEC, { onProgress })

    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('reports a non-JSON body as an ApiError, not a raw SyntaxError', async () => {
    // Callers of this package catch ApiError; a bare SyntaxError from JSON.parse would escape that
    // and read as a bug in their code rather than the API misbehaving.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 201 }))
    )

    await expect(createProject(BASE, TOKEN, SPEC)).rejects.toThrow(ApiError)
    await expect(createProject(BASE, TOKEN, SPEC)).rejects.toThrow(/not valid JSON/i)
  })

  it('surfaces a bad token as a 401 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"bad token"}', { status: 401 }))
    )

    await expect(createProject(BASE, TOKEN, SPEC)).rejects.toThrow(ApiError)
    await expect(createProject(BASE, TOKEN, SPEC)).rejects.toThrow(/Authentication failed/)
  })
})
