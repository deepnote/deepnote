import { describe, expect, it } from 'vitest'
import { getPrompt, prompts } from './prompts'

describe('prompts', () => {
  describe('prompts array', () => {
    it('has all expected prompts', () => {
      const promptNames = prompts.map(p => p.name)
      expect(promptNames).toContain('create_notebook')
      expect(promptNames).toContain('convert_and_enhance')
      expect(promptNames).toContain('fix_and_document')
      expect(promptNames).toContain('block_types_reference')
      expect(promptNames).toContain('best_practices')
    })

    it('all prompts have required fields', () => {
      for (const prompt of prompts) {
        expect(prompt.name).toBeDefined()
        expect(prompt.name.length).toBeGreaterThan(0)
        expect(prompt.description).toBeDefined()
        expect(prompt.description?.length).toBeGreaterThan(0)
        expect(Array.isArray(prompt.arguments)).toBe(true)
      }
    })

    it('prompts with arguments have valid argument definitions', () => {
      for (const prompt of prompts) {
        for (const arg of prompt.arguments || []) {
          expect(arg.name).toBeDefined()
          expect(arg.description).toBeDefined()
          expect(typeof arg.required).toBe('boolean')
        }
      }
    })
  })

  describe('getPrompt', () => {
    it('returns create_notebook prompt with default values', () => {
      const result = getPrompt('create_notebook', undefined)
      expect(result.description).toContain('data analysis')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].content).toMatchObject({ type: 'text' })
    })

    it('returns create_notebook prompt with custom arguments', () => {
      const result = getPrompt('create_notebook', {
        purpose: 'machine learning pipeline',
        data_source: 'PostgreSQL database',
      })
      expect(result.description).toContain('machine learning pipeline')
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('machine learning pipeline')
      expect(content.text).toContain('PostgreSQL database')
    })

    it('returns convert_and_enhance prompt', () => {
      const result = getPrompt('convert_and_enhance', { source_path: 'my_notebook.ipynb' })
      expect(result.messages[0].content).toMatchObject({ type: 'text' })
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('my_notebook.ipynb')
      expect(content.text).toContain('deepnote_convert_to')
      expect(content.text).toContain('deepnote_enhance')
    })

    it('returns fix_and_document prompt', () => {
      const result = getPrompt('fix_and_document', { notebook_path: 'analysis.deepnote' })
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('analysis.deepnote')
      expect(content.text).toContain('deepnote_lint')
      expect(content.text).toContain('deepnote_fix')
    })

    it('returns block_types_reference prompt', () => {
      const result = getPrompt('block_types_reference', undefined)
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('code')
      expect(content.text).toContain('sql')
      expect(content.text).toContain('input-slider')
      expect(content.text).toContain('markdown')
      expect(content.text).toContain('deepnote_variable_name')
    })

    it('returns best_practices prompt', () => {
      const result = getPrompt('best_practices', undefined)
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('Structure')
      expect(content.text).toContain('Interactivity')
      expect(content.text).toContain('deepnote_scaffold')
      expect(content.text).toContain('deepnote_enhance')
    })

    it('throws for unknown prompt', () => {
      expect(() => getPrompt('nonexistent_prompt', undefined)).toThrow('Unknown prompt: nonexistent_prompt')
    })
  })
})
