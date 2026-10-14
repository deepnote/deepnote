import { serializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { codeNotebook } from './integration-notebook'

describe('codeNotebook', () => {
  it('builds a notebook without blocks when no snippets are given', () => {
    expect(codeNotebook().project.notebooks[0].blocks).toEqual([])
  })

  it('builds one code block per snippet, in order', () => {
    const file = codeNotebook('a = 1', 'b = 2')

    expect(file.version).toBe('1.0.0')
    expect(file.project.notebooks).toHaveLength(1)
    expect(file.project.notebooks[0].name).toBe('Main')
    expect(file.project.notebooks[0].blocks).toEqual([
      {
        id: 'block-1',
        blockGroup: 'group-1',
        sortingKey: 'a0',
        type: 'code',
        content: 'a = 1',
        metadata: {},
        executionCount: null,
        outputs: [],
      },
      {
        id: 'block-2',
        blockGroup: 'group-2',
        sortingKey: 'a1',
        type: 'code',
        content: 'b = 2',
        metadata: {},
        executionCount: null,
        outputs: [],
      },
    ])
  })

  it('produces a file that serializes', () => {
    expect(() => serializeDeepnoteFile(codeNotebook('a = 1'))).not.toThrow()
  })
})
