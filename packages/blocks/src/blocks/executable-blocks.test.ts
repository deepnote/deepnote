import { describe, expect, it } from 'vitest'
import type { DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'
import { isExecutableBlock, isExecutableBlockType } from './executable-blocks'

describe('isExecutableBlock', () => {
  const executableTypes = [
    'agent',
    'code',
    'sql',
    'notebook-function',
    'visualization',
    'button',
    'big-number',
    'input-text',
    'input-textarea',
    'input-checkbox',
    'input-select',
    'input-slider',
    'input-date',
    'input-date-range',
    'input-file',
  ]

  for (const type of executableTypes) {
    it(`returns true for ${type} block`, () => {
      const block = { id: '1', type, blockGroup: 'g', sortingKey: 'a', metadata: {} } as DeepnoteBlock
      expect(isExecutableBlock(block)).toBe(true)
    })
  }

  const nonExecutableTypes = ['markdown', 'text-cell-h1', 'text-cell-p', 'text-cell-bullet', 'image', 'divider']

  for (const type of nonExecutableTypes) {
    it(`returns false for ${type} block`, () => {
      const block = { id: '1', type, blockGroup: 'g', sortingKey: 'a', metadata: {} } as DeepnoteBlock
      expect(isExecutableBlock(block)).toBe(false)
    })
  }
})

describe('isExecutableBlockType', () => {
  it('returns true for agent type', () => {
    expect(isExecutableBlockType('agent')).toBe(true)
  })

  it('returns true for code type', () => {
    expect(isExecutableBlockType('code')).toBe(true)
  })

  it('returns false for markdown type', () => {
    expect(isExecutableBlockType('markdown')).toBe(false)
  })

  it('returns false for unknown type', () => {
    expect(isExecutableBlockType('unknown')).toBe(false)
  })
})
