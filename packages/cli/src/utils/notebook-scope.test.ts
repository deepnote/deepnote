import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { NotFoundInProjectError } from '../exit-codes'
import { getNotebooksForExecutionScope } from './notebook-scope'

const file = (): DeepnoteFile =>
  ({
    metadata: { createdAt: '2025-01-01T00:00:00.000Z' },
    project: {
      id: '00000000-0000-0000-0000-000000000100',
      name: 'Project',
      notebooks: [
        { id: 'a', name: 'Alpha', blocks: [] },
        { id: 'b', name: 'Beta', blocks: [] },
      ],
    },
    version: '1.0.0',
  }) as unknown as DeepnoteFile

describe('getNotebooksForExecutionScope', () => {
  it('returns every notebook when no --notebook is given', () => {
    expect(getNotebooksForExecutionScope(file(), {}).map(n => n.name)).toEqual(['Alpha', 'Beta'])
  })

  it('returns only the named notebook', () => {
    expect(getNotebooksForExecutionScope(file(), { notebook: 'Beta' }).map(n => n.id)).toEqual(['b'])
  })

  it('throws NotFoundInProjectError for an unknown notebook name', () => {
    // Must be NotFoundInProjectError, not a bare Error: that is what maps the failure to exit
    // code 2 (invalid usage) instead of 1, matching `deepnote cat --notebook <unknown>`.
    expect(() => getNotebooksForExecutionScope(file(), { notebook: 'Nope' })).toThrow(NotFoundInProjectError)
  })
})
