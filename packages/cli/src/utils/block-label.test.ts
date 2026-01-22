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
  describe('using hello_world.deepnote', () => {
    const file = loadDeepnoteFile(HELLO_WORLD_FILE)
    const notebook = file.project.notebooks[0]
    const codeBlock = notebook.blocks[0]

    it('returns type and id for code block', () => {
      expect(codeBlock.type).toBe('code')
      expect(getBlockLabel(codeBlock)).toBe(`code (${codeBlock.id})`)
    })
  })

  describe('using blocks.deepnote', () => {
    const file = loadDeepnoteFile(BLOCKS_FILE)
    const textBlocksNotebook = file.project.notebooks[0]
    const inputBlocksNotebook = file.project.notebooks[1]

    describe('text blocks notebook', () => {
      it('returns type and id for markdown block', () => {
        const markdownBlock = findBlockByType(textBlocksNotebook.blocks, 'markdown')
        expect(getBlockLabel(markdownBlock)).toBe(`markdown (${markdownBlock.id})`)
      })

      it('returns type and id for code block', () => {
        const codeBlock = findBlockByType(textBlocksNotebook.blocks, 'code')
        expect(getBlockLabel(codeBlock)).toBe(`code (${codeBlock.id})`)
      })
    })

    describe('input blocks notebook', () => {
      it('returns type, id, and variable name for input-text block', () => {
        const inputTextBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-text')
        expect(getBlockLabel(inputTextBlock)).toBe(`input-text ${inputTextBlock.id} (input_text)`)
      })

      it('returns type, id, and variable name for input-textarea block', () => {
        const inputTextareaBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-textarea')
        expect(getBlockLabel(inputTextareaBlock)).toBe(`input-textarea ${inputTextareaBlock.id} (input_textarea)`)
      })

      it('returns type, id, and variable name for input-select block', () => {
        const inputSelectBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-select')
        expect(getBlockLabel(inputSelectBlock)).toBe(`input-select ${inputSelectBlock.id} (input_select)`)
      })

      it('returns type, id, and variable name for input-slider block', () => {
        const inputSliderBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-slider')
        expect(getBlockLabel(inputSliderBlock)).toBe(`input-slider ${inputSliderBlock.id} (input_slider)`)
      })

      it('returns type, id, and variable name for input-checkbox block', () => {
        const inputCheckboxBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-checkbox')
        expect(getBlockLabel(inputCheckboxBlock)).toBe(`input-checkbox ${inputCheckboxBlock.id} (input_checkbox)`)
      })

      it('returns type, id, and variable name for input-date block', () => {
        const inputDateBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-date')
        expect(getBlockLabel(inputDateBlock)).toBe(`input-date ${inputDateBlock.id} (input_date)`)
      })

      it('returns type, id, and variable name for input-date-range block', () => {
        const inputDateRangeBlock = findBlockByType(inputBlocksNotebook.blocks, 'input-date-range')
        expect(getBlockLabel(inputDateRangeBlock)).toBe(`input-date-range ${inputDateRangeBlock.id} (input_date_range)`)
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
