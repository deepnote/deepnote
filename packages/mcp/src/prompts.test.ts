import { describe, expect, it } from 'vitest'
import { serverInstructions } from './instructions'
import { getPrompt, isPromptName, prompts } from './prompts'
import { ALL_TOOL_NAMES, TOOL_NAMES } from './tool-names'

describe('prompts', () => {
  describe('prompts array', () => {
    it('has all expected prompts', () => {
      const promptNames = prompts.map(p => p.name)
      expect(promptNames).toContain('debug_execution')
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
    it('returns debug_execution prompt and preserves special characters', () => {
      const result = getPrompt('debug_execution', {
        execution_id: 'exec-äöü!@#$',
        error_message: 'NullPointer¶',
      })
      expect(result.description).toContain('Debug notebook execution')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].content).toMatchObject({ type: 'text' })
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('exec-äöü!@#$')
      expect(content.text).toContain('NullPointer¶')
      expect(content.text).toContain('deepnote_run')
      expect(content.text).toContain('deepnote_snapshot_load')
    })

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
      expect(content.text).toContain(TOOL_NAMES.convertTo)
      expect(content.text).toContain(TOOL_NAMES.addBlock)
    })

    it('returns fix_and_document prompt', () => {
      const result = getPrompt('fix_and_document', { notebook_path: 'analysis.deepnote' })
      const content = result.messages[0].content as { type: string; text: string }
      expect(content.text).toContain('analysis.deepnote')
      expect(content.text).toContain(TOOL_NAMES.read)
      expect(content.text).toContain(TOOL_NAMES.editBlock)
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
      expect(content.text).toContain(TOOL_NAMES.create)
      expect(content.text).toContain(TOOL_NAMES.addBlock)
    })

    it('validates known prompt names', () => {
      expect(isPromptName('create_notebook')).toBe(true)
      expect(isPromptName('nonexistent_prompt')).toBe(false)
    })

    it('does not reference unknown deepnote_* tool names in instructions or prompts', () => {
      const allowedTokens = new Set([
        ...ALL_TOOL_NAMES,
        // Metadata keys intentionally documented in prose examples.
        'deepnote_variable_name',
        'deepnote_input_label',
        'deepnote_input_default',
        'deepnote_input_min',
        'deepnote_input_max',
        'deepnote_input_step',
        'deepnote_input_options',
        'deepnote_input_presets',
        'deepnote_button_label',
        'deepnote_big_number_template',
      ])
      const tokenPattern = /\bdeepnote_[a-z_]+\b/g
      const unknownTokens: string[] = []

      const promptTexts = prompts.map(prompt => {
        const result = getPrompt(prompt.name, undefined)
        const firstMessage = result.messages[0]
        if (!firstMessage || firstMessage.content.type !== 'text') {
          return ''
        }
        return firstMessage.content.text
      })

      const allTexts = [serverInstructions, ...promptTexts]
      for (const text of allTexts) {
        for (const token of text.match(tokenPattern) ?? []) {
          if (!allowedTokens.has(token)) {
            unknownTokens.push(token)
          }
        }
      }

      expect(new Set(unknownTokens)).toEqual(new Set())
    })
  })
})
