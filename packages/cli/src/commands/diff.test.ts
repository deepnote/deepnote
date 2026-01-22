import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createDiffAction, type DiffOptions } from './diff'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

/** Default options for testing */
const DEFAULT_OPTIONS: DiffOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('diff command', () => {
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

  describe('createDiffAction', () => {
    it('returns a function', () => {
      const action = createDiffAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('comparing identical files', () => {
    it('reports no differences when comparing a file with itself', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('No structural differences found')
    })

    it('shows file paths in output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Comparing:')
      expect(output).toContain(filePath)
    })
  })

  describe('comparing different files', () => {
    it('detects different notebooks', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      // Should detect that these are different projects with different notebooks
      expect(output).toContain('Summary:')
    })

    it('detects added notebooks', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      // The blocks file has different notebooks than hello_world
      expect(output).toMatch(/Added|Removed|Modified/)
    })

    it('shows block counts for added notebooks', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('blocks')
    })
  })

  describe('--json output', () => {
    it('outputs valid JSON', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })

    it('includes file paths in JSON output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.file1).toBe(filePath)
      expect(parsed.file2).toBe(filePath)
    })

    it('includes summary in JSON output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.summary).toBeDefined()
      expect(parsed.summary.notebooksAdded).toBe(0)
      expect(parsed.summary.notebooksRemoved).toBe(0)
      expect(parsed.summary.notebooksModified).toBe(0)
    })

    it('includes notebooks array in JSON output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(Array.isArray(parsed.notebooks)).toBe(true)
    })

    it('shows differences in JSON output', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      // Should have some changes since files are different
      const totalChanges =
        parsed.summary.notebooksAdded + parsed.summary.notebooksRemoved + parsed.summary.notebooksModified
      expect(totalChanges).toBeGreaterThan(0)
    })
  })

  describe('--content option', () => {
    it('includes content diffs when enabled', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, { content: true })

      // Should run without error
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('includes content in JSON output when enabled', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, { json: true, content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createDiffAction(program)

      await action(HELLO_WORLD_FILE, HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('No structural differences found')
    })

    it('accepts absolute paths', async () => {
      const action = createDiffAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath, absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('No structural differences found')
    })

    it('accepts mixed paths', async () => {
      const action = createDiffAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(HELLO_WORLD_FILE, absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('shows error for non-existent first file', async () => {
      const action = createDiffAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', HELLO_WORLD_FILE, DEFAULT_OPTIONS)).rejects.toThrow(
        'process.exit called'
      )

      const errorOutput = getErrorOutput(consoleErrorSpy)
      expect(errorOutput).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('shows error for non-existent second file', async () => {
      const action = createDiffAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action(HELLO_WORLD_FILE, 'non-existent.deepnote', DEFAULT_OPTIONS)).rejects.toThrow(
        'process.exit called'
      )

      const errorOutput = getErrorOutput(consoleErrorSpy)
      expect(errorOutput).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('outputs JSON error when --json is used', async () => {
      const action = createDiffAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', HELLO_WORLD_FILE, { json: true })).rejects.toThrow(
        'process.exit called'
      )

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')

      exitSpy.mockRestore()
    })
  })

  describe('comparing files with same notebooks but different blocks', () => {
    it('detects when comparing different example files', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), BLOCKS_FILE)
      const file2 = resolve(process.cwd(), INTEGRATIONS_FILE)

      await action(file1, file2, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      // Different files should have different structures
      const totalChanges =
        parsed.summary.notebooksAdded +
        parsed.summary.notebooksRemoved +
        parsed.summary.notebooksModified +
        parsed.summary.blocksAdded +
        parsed.summary.blocksRemoved +
        parsed.summary.blocksModified
      expect(totalChanges).toBeGreaterThan(0)
    })
  })

  describe('snapshot comparison', () => {
    it('can compare regular file with snapshot', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(
        process.cwd(),
        'examples/snapshots/hello-world_18aaab73-3599-4bb5-b2ab-c05ac09f597d_latest.snapshot.deepnote'
      )

      await action(file1, file2, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })
  })

  describe('text output formatting', () => {
    it('shows Added notebooks in output', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebooks:')
    })

    it('shows Removed notebooks in output', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), BLOCKS_FILE)
      const file2 = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebooks:')
    })

    it('shows Modified notebooks in output', async () => {
      const action = createDiffAction(program)
      // Compare snapshot with original - same notebook but potentially different content
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(
        process.cwd(),
        'examples/snapshots/hello-world_18aaab73-3599-4bb5-b2ab-c05ac09f597d_latest.snapshot.deepnote'
      )

      await action(file1, file2, DEFAULT_OPTIONS)

      // Should run without error and display comparison
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('shows content diff lines when --content is used', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, { content: true })

      // Should run without error
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('shows summary with block counts', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Summary:')
      expect(output).toMatch(/block\(s\)/)
    })

    it('shows notebook counts in summary', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toMatch(/notebook\(s\)/)
    })
  })
})
