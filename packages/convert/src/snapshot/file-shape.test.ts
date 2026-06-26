import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { isComposedInitMainFile, isSingleNotebookDeepnoteFile } from './file-shape'

function makeFile(args: { initNotebookId?: string; notebooks: Array<{ id: string }> }): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: 'proj-1',
      name: 'Test',
      ...(args.initNotebookId !== undefined ? { initNotebookId: args.initNotebookId } : {}),
      notebooks: args.notebooks.map(nb => ({
        id: nb.id,
        name: nb.id,
        blocks: [],
      })),
    },
  }
}

describe('isSingleNotebookDeepnoteFile', () => {
  it('returns true for a single-notebook file', () => {
    expect(isSingleNotebookDeepnoteFile(makeFile({ notebooks: [{ id: 'nb-1' }] }))).toBe(true)
  })

  it('returns false for multi-notebook files', () => {
    expect(isSingleNotebookDeepnoteFile(makeFile({ notebooks: [{ id: 'nb-1' }, { id: 'nb-2' }] }))).toBe(false)
  })
})

describe('isComposedInitMainFile', () => {
  it('returns true for composed [init, main] shape', () => {
    const file = makeFile({
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init' }, { id: 'nb-main' }],
    })
    expect(isComposedInitMainFile(file)).toBe(true)
  })

  it('returns false for single-notebook files', () => {
    expect(isComposedInitMainFile(makeFile({ notebooks: [{ id: 'nb-1' }] }))).toBe(false)
  })

  it('returns false when initNotebookId does not match either notebook', () => {
    const file = makeFile({
      initNotebookId: 'nb-missing',
      notebooks: [{ id: 'nb-a' }, { id: 'nb-b' }],
    })
    expect(isComposedInitMainFile(file)).toBe(false)
  })

  it('returns false for legacy multi-notebook projects without init/main pairing', () => {
    const file = makeFile({
      notebooks: [{ id: 'nb-a' }, { id: 'nb-b' }, { id: 'nb-c' }],
    })
    expect(isComposedInitMainFile(file)).toBe(false)
  })
})
