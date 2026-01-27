import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { type CatOptions, createCatAction } from './cat'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

/** Default options for testing */
const DEFAULT_OPTIONS: CatOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return stripVTControlCharacters(spy.mock.calls.map(call => call.join(' ')).join('\n'))
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('cat command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('createCatAction', () => {
    it('returns a function', () => {
      const action = createCatAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('basic output', () => {
    it('displays file path', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain(`File: ${filePath}`)
    })

    it('displays notebook name and id', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebook: 1. Hello World - example')
      expect(output).toContain('ID: 7061f86dec6e4e11893288f295a82017')
    })

    it('displays block count', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Blocks: 1')
    })

    it('displays block type and id', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('code')
      expect(output).toContain('15bc86a3d6684d3aa0eaad3b0c42a1eb')
    })

    it('displays block content', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('print("Hello world!")')
    })
  })

  describe('multiple notebooks', () => {
    it('displays all notebooks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebook: 1. Text blocks')
      expect(output).toContain('Notebook: 2. Input blocks')
    })

    it('displays blocks from multiple notebooks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      // Check for blocks from different notebooks
      expect(output).toContain('markdown')
      expect(output).toContain('input-text')
      expect(output).toContain('input-select')
    })
  })

  describe('--notebook filter', () => {
    it('filters to a specific notebook', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { notebook: '1. Text blocks' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebook: 1. Text blocks')
      expect(output).not.toContain('Notebook: 2. Input blocks')
    })

    it('shows error for non-existent notebook', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        await expect(action(filePath, { notebook: 'Non-existent' })).rejects.toThrow('process.exit called')

        const errorOutput = getErrorOutput(consoleErrorSpy)
        expect(errorOutput).toContain('Notebook "Non-existent" not found in project')
      } finally {
        exitSpy.mockRestore()
      }
    })
  })

  describe('--type filter', () => {
    it('filters to code blocks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'code' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('code')
      expect(output).not.toContain('markdown')
      expect(output).not.toContain('input-text')
    })

    it('filters to markdown blocks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'markdown' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('markdown')
      expect(output).not.toContain('input-text')
    })

    it('filters to input blocks with category filter', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'input' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('input-text')
      expect(output).toContain('input-select')
      expect(output).not.toContain('markdown')
    })

    it('filters to text blocks with category filter', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'text' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('markdown')
      expect(output).not.toContain('input-text')
    })

    it('handles case-insensitive type filter', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'CODE' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('code')
    })
  })

  describe('--tree mode', () => {
    it('shows structure without content', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { tree: true })

      const output = getOutput(consoleSpy)
      expect(output).toContain('code')
      expect(output).toContain('15bc86a3d6684d3aa0eaad3b0c42a1eb')
      // Content should not be shown
      expect(output).not.toContain('print("Hello world!")')
    })

    it('shows structure for multiple blocks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { tree: true })

      const output = getOutput(consoleSpy)
      // Should list block types but no content
      expect(output).toContain('markdown')
      expect(output).toContain('code')
      expect(output).toContain('input-text')
      // Content from these blocks should not appear
      expect(output).not.toContain('This is a markdown heading')
      expect(output).not.toContain('Hello World!')
    })
  })

  describe('-o json output', () => {
    it('outputs valid JSON', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })

    it('includes project information', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.project.name).toBe('Hello world')
      expect(parsed.project.id).toBe('18aaab73-3599-4bb5-b2ab-c05ac09f597d')
    })

    it('includes notebooks with blocks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.notebooks).toHaveLength(1)
      expect(parsed.notebooks[0].name).toBe('1. Hello World - example')
      expect(parsed.notebooks[0].blocks).toHaveLength(1)
      expect(parsed.notebooks[0].blocks[0].type).toBe('code')
      expect(parsed.notebooks[0].blocks[0].content).toBe('print("Hello world!")')
    })

    it('excludes content in tree mode', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json', tree: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.notebooks[0].blocks[0].content).toBeUndefined()
    })

    it('respects notebook filter', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json', notebook: '1. Text blocks' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.notebooks).toHaveLength(1)
      expect(parsed.notebooks[0].name).toBe('1. Text blocks')
    })

    it('respects type filter', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json', type: 'code' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      for (const notebook of parsed.notebooks) {
        for (const block of notebook.blocks) {
          expect(block.type).toBe('code')
        }
      }
    })
  })

  describe('input blocks', () => {
    it('shows variable name for input blocks', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { type: 'input-text' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('Variable: input_text')
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createCatAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello World')
    })

    it('accepts absolute paths', async () => {
      const action = createCatAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello World')
    })
  })

  describe('error handling', () => {
    it('shows error for non-existent file', async () => {
      const action = createCatAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        await expect(action('non-existent-file.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

        const errorOutput = getErrorOutput(consoleErrorSpy)
        expect(errorOutput).toContain('File not found')
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('outputs JSON error when -o json is used', async () => {
      const action = createCatAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        await expect(action('non-existent-file.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('File not found')
      } finally {
        exitSpy.mockRestore()
      }
    })
  })

  describe('SQL blocks', () => {
    it('displays SQL content', async () => {
      const action = createCatAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      await action(filePath, { type: 'sql' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('sql')
      expect(output).toContain('SELECT')
    })
  })
})
