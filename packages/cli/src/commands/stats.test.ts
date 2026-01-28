import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createStatsAction, type StatsOptions } from './stats'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

/** Default options for testing */
const DEFAULT_OPTIONS: StatsOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('stats command', () => {
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

  describe('createStatsAction', () => {
    it('returns a function', () => {
      const action = createStatsAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('basic output', () => {
    it('displays project name', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })

    it('displays summary section', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Summary')
      expect(output).toContain('Notebooks:')
      expect(output).toContain('Total Blocks:')
      expect(output).toContain('Lines of Code:')
    })

    it('displays block types', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Block Types')
      expect(output).toContain('code')
    })

    it('displays imports when present', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      // Integrations file should have some imports (pandas, matplotlib, urllib)
      const output = getOutput(consoleSpy)
      expect(output).toContain('Imports')
      expect(output).toContain('pandas')
    })
  })

  describe('-o json output', () => {
    it('outputs valid JSON', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.projectName).toBe('Hello world')
    })

    it('includes all expected fields', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.path).toBeDefined()
      expect(parsed.projectName).toBeDefined()
      expect(parsed.projectId).toBeDefined()
      expect(parsed.notebookCount).toBeDefined()
      expect(parsed.totalBlocks).toBeDefined()
      expect(parsed.totalLinesOfCode).toBeDefined()
      expect(parsed.blockTypesSummary).toBeDefined()
      expect(parsed.notebooks).toBeDefined()
      expect(parsed.imports).toBeDefined()
    })

    it('includes notebook details', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.notebooks.length).toBeGreaterThan(0)
      expect(parsed.notebooks[0].name).toBeDefined()
      expect(parsed.notebooks[0].id).toBeDefined()
      expect(parsed.notebooks[0].blockCount).toBeDefined()
      expect(parsed.notebooks[0].linesOfCode).toBeDefined()
      expect(parsed.notebooks[0].blockTypes).toBeDefined()
    })

    it('includes block type summary', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.blockTypesSummary.length).toBeGreaterThan(0)
      expect(parsed.blockTypesSummary[0].type).toBeDefined()
      expect(parsed.blockTypesSummary[0].count).toBeDefined()
      expect(parsed.blockTypesSummary[0].linesOfCode).toBeDefined()
    })
  })

  describe('--notebook filter', () => {
    it('filters to a specific notebook', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json', notebook: '1. Text blocks' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.notebooks.length).toBe(1)
      expect(parsed.notebooks[0].name).toBe('1. Text blocks')
    })

    it('shows correct totals for filtered notebook', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json', notebook: '1. Text blocks' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.notebookCount).toBe(1)
      expect(parsed.totalBlocks).toBe(parsed.notebooks[0].blockCount)
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createStatsAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })

    it('accepts absolute paths', async () => {
      const action = createStatsAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })
  })

  describe('error handling', () => {
    it('shows error for non-existent file', async () => {
      const action = createStatsAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const errorOutput = getErrorOutput(consoleErrorSpy)
      expect(errorOutput).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('outputs JSON error when -o json is used', async () => {
      const action = createStatsAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')

      exitSpy.mockRestore()
    })
  })

  describe('lines of code counting', () => {
    it('counts lines correctly for code blocks', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Hello world has one code block with "print("Hello world!")"
      expect(parsed.totalLinesOfCode).toBeGreaterThan(0)
    })

    it('includes LOC in block type summary', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      const codeType = parsed.blockTypesSummary.find((bt: { type: string }) => bt.type === 'code')
      expect(codeType).toBeDefined()
      expect(codeType.linesOfCode).toBeGreaterThanOrEqual(0)
    })
  })

  describe('imports extraction', () => {
    it('extracts imports from code blocks', async () => {
      const action = createStatsAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // imports should be an array (may be empty depending on file content)
      expect(Array.isArray(parsed.imports)).toBe(true)
    })
  })

  describe('global options', () => {
    describe('--no-color', () => {
      it('produces output without ANSI escape codes when color is disabled', async () => {
        setOutputConfig({ color: false })
        const action = createStatsAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, DEFAULT_OPTIONS)

        const output = getOutput(consoleSpy)
        // ANSI escape codes start with \x1b[ (ESC[)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Testing for ANSI codes
        expect(output).not.toMatch(/\x1b\[/)
        // Should still have content
        expect(output).toContain('Summary')
      })
    })

    describe('--quiet', () => {
      it('still outputs essential content in quiet mode (text output is essential)', async () => {
        setOutputConfig({ quiet: true })
        const action = createStatsAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, DEFAULT_OPTIONS)

        // Essential output should still appear - stats results are the command's primary output
        const output = getOutput(consoleSpy)
        expect(output).toContain('Summary')
        expect(output).toContain('Notebooks:')
      })

      it('still outputs JSON in quiet mode', async () => {
        setOutputConfig({ quiet: true })
        const action = createStatsAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, { output: 'json' })

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.projectName).toBe('Hello world')
      })
    })
  })
})
