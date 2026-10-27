import { ApiError } from '@deepnote/database-integrations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlock, deleteBlock, getBlock, getNotebook, reorderBlocks, updateBlock } from './blocks'

const BASE_URL = 'https://api.example.com'
const TOKEN = 'tok-123'

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

/** The request init of the nth `fetch` call, typed for assertions. */
function callInit(spy: ReturnType<typeof vi.spyOn>, index = 0): RequestInit {
  return spy.mock.calls[index]?.[1] as RequestInit
}

/**
 * A `fetch` that never settles on its own, rejecting only once its signal aborts.
 *
 * Required to test the deadline at all: a mock that resolves immediately passes whether or not the
 * timeout is wired up, so it proves nothing about a request that hangs.
 */
function pendingFetch(): void {
  vi.spyOn(global, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject((init.signal as AbortSignal).reason))
      })
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getNotebook', () => {
  it('GETs the notebook with bearer auth and normalizes blocks and inputs', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        notebook: {
          id: 'nb-1',
          projectId: 'pr-1',
          name: 'Analysis',
          blocks: [
            { id: 'b1', type: 'code', content: 'print(1)' },
            { id: 'b2', type: 'markdown', content: null },
          ],
          inputs: [{ blockId: 'b3', name: 'region', type: 'input-select', value: ['eu'], label: 'Region' }],
        },
      })
    )

    const notebook = await getNotebook(BASE_URL, TOKEN, 'nb-1')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/notebooks/nb-1')
    expect(callInit(fetchSpy).method).toBe('GET')
    expect((callInit(fetchSpy).headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(notebook.id).toBe('nb-1')
    expect(notebook.projectId).toBe('pr-1')
    // A null content is normalized to '' so callers can diff strings without null-guarding.
    expect(notebook.blocks).toEqual([
      { id: 'b1', type: 'code', content: 'print(1)' },
      { id: 'b2', type: 'markdown', content: '' },
    ])
    expect(notebook.inputs[0]?.name).toBe('region')
  })

  it('defaults blocks and inputs to empty arrays when the API omits them', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ notebook: { id: 'nb-1' } }))

    const notebook = await getNotebook(BASE_URL, TOKEN, 'nb-1')

    expect(notebook.blocks).toEqual([])
    expect(notebook.inputs).toEqual([])
  })

  it('percent-encodes the notebook id', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ notebook: { id: 'a/b' } }))

    await getNotebook(BASE_URL, TOKEN, 'a/b')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/notebooks/a%2Fb')
  })

  it('throws a 401 ApiError with a token-specific message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ message: 'nope' }, { ok: false, status: 401, statusText: 'Unauthorized' })
    )

    await expect(getNotebook(BASE_URL, TOKEN, 'nb-1')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication failed. Please check your API token.',
    })
  })

  it('reports a non-JSON body as a 502 rather than leaking a SyntaxError', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('<html>gateway</html>'))

    const error = await getNotebook(BASE_URL, TOKEN, 'nb-1').catch(e => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(502)
    expect(error.message).toContain('not valid JSON')
  })

  it('reports a schema mismatch as a 502 naming the problem', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ notebook: { name: 'no id' } }))

    const error = await getNotebook(BASE_URL, TOKEN, 'nb-1').catch(e => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(502)
  })
})

describe('getBlock', () => {
  it('returns the metadata and integration the notebook endpoint omits', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({
        block: {
          id: 'b1',
          notebookId: 'nb-1',
          type: 'sql',
          content: 'select 1',
          metadata: { sql_integration_id: 'int-1' },
          integrationId: 'int-1',
          version: 3,
        },
      })
    )

    const block = await getBlock(BASE_URL, TOKEN, 'b1')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/blocks/b1')
    expect(block.metadata).toEqual({ sql_integration_id: 'int-1' })
    expect(block.integrationId).toBe('int-1')
    expect(block.version).toBe(3)
  })

  it('normalizes null metadata, content and integration to undefined/empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ block: { id: 'b1', type: 'code', content: null, metadata: null, integrationId: null } })
    )

    const block = await getBlock(BASE_URL, TOKEN, 'b1')

    expect(block.metadata).toBeUndefined()
    expect(block.integrationId).toBeUndefined()
    expect(block.content).toBe('')
  })
})

describe('createBlock', () => {
  it('POSTs to /v2/blocks with metadata and position, returning the new id', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ block: { id: 'new-1' } }))

    const created = await createBlock(BASE_URL, TOKEN, {
      notebookId: 'nb-1',
      type: 'code',
      content: 'x = 1',
      metadata: { deepnote_app_block_visible: true },
      position: 2,
    })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/blocks')
    expect(callInit(fetchSpy).method).toBe('POST')
    expect(JSON.parse(callInit(fetchSpy).body as string)).toEqual({
      notebookId: 'nb-1',
      type: 'code',
      content: 'x = 1',
      metadata: { deepnote_app_block_visible: true },
      position: 2,
    })
    expect(created.id).toBe('new-1')
  })

  it('uses the caller’s 403 message when the body carried none', async () => {
    // `parseApiErrorMessage` falls back to a generic "HTTP 403" string, so this only works if the
    // generic is recognized as "the body said nothing" rather than treated as a real message.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response('', { ok: false, status: 403, statusText: 'Forbidden' }))

    await expect(createBlock(BASE_URL, TOKEN, { notebookId: 'nb-1', type: 'code' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Access denied. You may not have permission to modify this notebook.',
    })
  })

  it('prefers the API’s own 403 message over the caller’s', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ message: 'notebook is archived' }, { ok: false, status: 403, statusText: 'Forbidden' })
    )

    await expect(createBlock(BASE_URL, TOKEN, { notebookId: 'nb-1', type: 'code' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'notebook is archived',
    })
  })

  it('times out a request that never responds', async () => {
    pendingFetch()

    await expect(getNotebook(BASE_URL, TOKEN, 'nb-1', { requestTimeoutMs: 5 })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('still times out when the caller supplies its own signal', async () => {
    // The whole point of combining the two: `signal ?? timeout` would drop the deadline here, so
    // this request would hang forever instead of failing after 5ms. A mock that resolves
    // immediately would pass either way — it has to stay pending until something aborts it.
    pendingFetch()
    const controller = new AbortController()

    await expect(
      getNotebook(BASE_URL, TOKEN, 'nb-1', { signal: controller.signal, requestTimeoutMs: 5 })
    ).rejects.toMatchObject({ name: 'TimeoutError' })

    // The deadline fired, not the caller.
    expect(controller.signal.aborted).toBe(false)
  })

  it('still aborts when the caller aborts, well before the deadline', async () => {
    pendingFetch()
    const controller = new AbortController()

    const pending = getNotebook(BASE_URL, TOKEN, 'nb-1', { signal: controller.signal, requestTimeoutMs: 60_000 })
    controller.abort(new Error('caller changed its mind'))

    await expect(pending).rejects.toThrow(/caller changed its mind/)
  })

  it('surfaces the API message on a 400', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ message: 'position out of range' }, { ok: false, status: 400, statusText: 'Bad Request' })
    )

    await expect(createBlock(BASE_URL, TOKEN, { notebookId: 'nb-1', type: 'code' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'position out of range',
    })
  })
})

describe('updateBlock', () => {
  it('PATCHes only content and integrationId', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ block: { id: 'b1', version: 4 } }))

    const updated = await updateBlock(BASE_URL, TOKEN, 'b1', { content: 'print(2)' })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/blocks/b1')
    expect(callInit(fetchSpy).method).toBe('PATCH')
    expect(JSON.parse(callInit(fetchSpy).body as string)).toEqual({ content: 'print(2)' })
    expect(updated).toEqual({ id: 'b1', version: 4 })
  })

  it('refuses an empty patch without spending a request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    await expect(updateBlock(BASE_URL, TOKEN, 'b1', {})).rejects.toThrow(/nothing to update/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends an empty-string content, which is a real change', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ block: { id: 'b1' } }))

    await updateBlock(BASE_URL, TOKEN, 'b1', { content: '' })

    expect(JSON.parse(callInit(fetchSpy).body as string)).toEqual({ content: '' })
  })
})

describe('deleteBlock', () => {
  it('DELETEs the block and tolerates an empty 204 body', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response('', { status: 204, statusText: 'No Content' }))

    await expect(deleteBlock(BASE_URL, TOKEN, 'b1')).resolves.toBeUndefined()

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/blocks/b1')
    expect(callInit(fetchSpy).method).toBe('DELETE')
  })

  it('throws on a 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      response({ message: 'block not found' }, { ok: false, status: 404, statusText: 'Not Found' })
    )

    await expect(deleteBlock(BASE_URL, TOKEN, 'gone')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reorderBlocks', () => {
  it('POSTs the move and returns the resulting order', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ blockIds: ['b2', 'b1', 'b3'] }))

    const order = await reorderBlocks(BASE_URL, TOKEN, 'nb-1', {
      blockIds: ['b2'],
      placement: { type: 'start' },
    })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.example.com/v2/notebooks/nb-1/reorder-blocks')
    expect(JSON.parse(callInit(fetchSpy).body as string)).toEqual({
      blockIds: ['b2'],
      placement: { type: 'start' },
    })
    expect(order).toEqual(['b2', 'b1', 'b3'])
  })

  it('sends an `after` placement verbatim', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ blockIds: [] }))

    await reorderBlocks(BASE_URL, TOKEN, 'nb-1', {
      blockIds: ['b3'],
      placement: { type: 'after', blockId: 'b1' },
    })

    expect(JSON.parse(callInit(fetchSpy).body as string).placement).toEqual({ type: 'after', blockId: 'b1' })
  })

  it('refuses an empty move without spending a request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')

    await expect(reorderBlocks(BASE_URL, TOKEN, 'nb-1', { blockIds: [], placement: { type: 'end' } })).rejects.toThrow(
      /at least one block/
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
