import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { getBlockLabel } from './block-label'

// Example files relative to project root
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')

function loadDeepnoteFile(relativePath: string) {
  const content = readFileSync(relativePath, 'utf-8')
  return deserializeDeepnoteFile(content)
}

function findBlockByType(blocks: DeepnoteBlock[], type: string): DeepnoteBlock {
  const block = blocks.find(b => b.type === type)
  if (!block) {
    throw new Error(`Block of type ${type} not found`)
  }
  return block
}

describe('getBlockLabel', () => {
  describe('code blocks', () => {
    it('returns first comment line for code block with comment', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'code',
        content: '# This is my comment\nprint("hello")',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('# This is my comment')
    })

    it('returns first line of code when no comment', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'code',
        content: 'import pandas as pd\ndf = pd.DataFrame()',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('import pandas as pd')
    })

    it('truncates long lines', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'code',
        content: '# This is a very long comment that should be truncated because it exceeds fifty characters',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      const label = getBlockLabel(block)
      expect(label.length).toBe(50)
      expect(label.endsWith('…')).toBe(true)
    })

    it('returns "code (empty)" for empty block', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'code',
        content: '',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('code (empty)')
    })

    it('skips shebang lines', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'code',
        content: '#!/usr/bin/env python\n# Actual comment\ncode()',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('# Actual comment')
    })
  })

  describe('sql blocks', () => {
    it('returns first line of SQL', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'sql',
        content: 'SELECT * FROM users\nWHERE active = true',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('SELECT * FROM users')
    })

    it('returns SQL comment if present', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'sql',
        content: '-- Get all active users\nSELECT * FROM users',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('-- Get all active users')
    })
  })

  describe('markdown blocks', () => {
    it('returns first line of markdown', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'markdown',
        content: '## Section Title\nSome content here',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('## Section Title')
    })
  })

  describe('text cell blocks', () => {
    it('returns content for h1 block', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'text-cell-h1',
        content: 'Main Title',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('Main Title')
    })

    it('returns content for paragraph block', () => {
      const block: DeepnoteBlock = {
        id: 'test-id',
        type: 'text-cell-p',
        content: 'This is a paragraph of text.',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      }
      expect(getBlockLabel(block)).toBe('This is a paragraph of text.')
    })
  })

  describe('input blocks', () => {
    it('returns variable name for input block', () => {
      // Use type assertion since we're testing a subset of the full input block type
      const block = {
        id: 'test-id',
        type: 'input-text',
        content: '',
        metadata: { deepnote_variable_name: 'user_name' },
        sortingKey: 'a',
        blockGroup: 'group',
      } as DeepnoteBlock
      expect(getBlockLabel(block)).toBe('user_name')
    })

    it('returns fallback for input block without variable name', () => {
      // Use type assertion to test edge case where metadata is incomplete
      const block = {
        id: 'abcd1234efgh',
        type: 'input-text',
        content: '',
        metadata: {},
        sortingKey: 'a',
        blockGroup: 'group',
      } as DeepnoteBlock
      expect(getBlockLabel(block)).toBe('input (abcd1234)')
    })
  })

  describe('using real files', () => {
    describe('hello_world.deepnote', () => {
      const file = loadDeepnoteFile(HELLO_WORLD_FILE)
      const notebook = file.project.notebooks[0]
      const codeBlock = notebook.blocks[0]

      it('returns content preview for code block', () => {
        expect(codeBlock.type).toBe('code')
        // The hello world file has print("Hello, world!") as content
        expect(getBlockLabel(codeBlock)).toMatch(/print|Hello/)
      })
    })

    describe('blocks.deepnote', () => {
      const file = loadDeepnoteFile(BLOCKS_FILE)
      const inputBlocksNotebook = file.project.notebooks[1]

      it('returns variable name for input-text block', () => {
        const inputTextBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-text')
        expect(getBlockLabel(inputTextBlock)).toBe('input_text')
      })

      it('returns variable name for input-slider block', () => {
        const inputSliderBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-slider')
        expect(getBlockLabel(inputSliderBlock)).toBe('input_slider')
      })

      it('handles all input block types in the notebook', () => {
        const inputTypes = [
          'input-text',
          'input-textarea',
          'input-select',
          'input-slider',
          'input-checkbox',
          'input-date',
          'input-date-range',
        ]

        for (const inputType of inputTypes) {
          const block = inputBlocksNotebook.blocks.find(b => b.type === inputType)
          expect(block, `Expected to find block of type ${inputType}`).toBeDefined()
        }
      })
    })
  })
})
