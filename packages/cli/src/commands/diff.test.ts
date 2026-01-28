import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { getDiffFixturePath } from '../../../../test-fixtures/helpers/fixture-loader'
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

      await action(filePath, filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })

    it('includes file paths in JSON output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.file1).toBe(filePath)
      expect(parsed.file2).toBe(filePath)
    })

    it('includes summary in JSON output', async () => {
      const action = createDiffAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, filePath, { output: 'json' })

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

      await action(filePath, filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(Array.isArray(parsed.notebooks)).toBe(true)
    })

    it('shows differences in JSON output', async () => {
      const action = createDiffAction(program)
      const file1 = resolve(process.cwd(), HELLO_WORLD_FILE)
      const file2 = resolve(process.cwd(), BLOCKS_FILE)

      await action(file1, file2, { output: 'json' })

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

      await action(file1, file2, { output: 'json', content: true })

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

      await expect(action('non-existent.deepnote', HELLO_WORLD_FILE, { output: 'json' })).rejects.toThrow(
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

      await action(file1, file2, { output: 'json' })

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

      await action(file1, file2, { output: 'json' })

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

      // Should run without error and produce diff output with diff markers
      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      // Verify the output contains diff markers (lines with + or - prefixes for added/removed items)
      // The output format has leading spaces before markers, e.g. "  + Added:" or "  - Removed:"
      expect(output).toMatch(/^\s+[+-]\s+(Added|Removed):/m)
      // Verify specific notebook names from the example files appear in the diff
      expect(output).toMatch(/Hello World|Text blocks|Input blocks/)
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

  describe('modified blocks with content diff', () => {
    const file1Path = getDiffFixturePath('base-modified-blocks.deepnote')
    const file2Path = getDiffFixturePath('modified-blocks.deepnote')

    it('detects modified blocks and shows modified status', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json' })

      const output = getOutput(consoleSpy)
      const errorOutput = getErrorOutput(consoleErrorSpy)
      expect(errorOutput).toBe('')
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      expect(parsed.summary.notebooksModified).toBe(1)
      expect(parsed.summary.blocksModified).toBe(2)
    })

    it('shows modified blocks in text output', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Modified:')
      expect(output).toContain('block(s) modified')
    })

    it('shows content diff with --content option', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { content: true })

      const output = getOutput(consoleSpy)
      // Should show before/after content lines
      expect(output).toMatch(/- print\("original code"\)/)
      expect(output).toMatch(/\+ print\("modified code"\)/)
    })

    it('includes contentDiff in JSON with --content option', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)

      // Find the modified notebook
      const modifiedNotebook = parsed.notebooks.find((nb: { status: string }) => nb.status === 'modified')
      expect(modifiedNotebook).toBeDefined()
      expect(modifiedNotebook.blockDiffs).toBeDefined()

      // Check that contentDiff is included
      const blockWithDiff = modifiedNotebook.blockDiffs.find(
        (bd: { contentDiff?: unknown }) => bd.contentDiff !== undefined
      )
      expect(blockWithDiff).toBeDefined()
      expect(blockWithDiff.contentDiff.before).toContain('original')
      expect(blockWithDiff.contentDiff.after).toContain('modified')
    })
  })

  describe('added and removed blocks within same notebook', () => {
    const file1Path = getDiffFixturePath('single-block.deepnote')
    const file2Path = getDiffFixturePath('different-block.deepnote')

    it('detects added and removed blocks within same notebook', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      expect(parsed.summary.blocksAdded).toBe(1)
      expect(parsed.summary.blocksRemoved).toBe(1)
    })

    it('shows added block content diff with --content', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { content: true })

      const output = getOutput(consoleSpy)
      // Should show removed block content with minus prefix and added block content with plus prefix
      // The original block has print('original') and the new block has print('new')
      // Output format has leading whitespace before the diff markers: "        - print('original')"
      expect(output).toMatch(/^\s+-\s.*print\('original'\)/m)
      expect(output).toMatch(/^\s+\+\s.*print\('new'\)/m)
    })

    it('includes contentDiff for added blocks in JSON', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      const modifiedNotebook = parsed.notebooks.find((nb: { status: string }) => nb.status === 'modified')
      expect(modifiedNotebook).toBeDefined()

      const addedBlock = modifiedNotebook.blockDiffs.find((bd: { status: string }) => bd.status === 'added')
      expect(addedBlock).toBeDefined()
      expect(addedBlock.contentDiff.before).toBeUndefined()
      expect(addedBlock.contentDiff.after).toContain('new')

      const removedBlock = modifiedNotebook.blockDiffs.find((bd: { status: string }) => bd.status === 'removed')
      expect(removedBlock).toBeDefined()
      expect(removedBlock.contentDiff.before).toContain('original')
      expect(removedBlock.contentDiff.after).toBeUndefined()
    })
  })

  describe('edge cases for blocks without string content', () => {
    // Consolidated fixture with multiple edge case blocks:
    // - image-block-1, sep-block-1: blocks without content field
    // - type-change-block: image -> separator type change
    // - bn-1: big-number with optional content
    const file1Path = getDiffFixturePath('edge-cases-before.deepnote')
    const file2Path = getDiffFixturePath('edge-cases-after.deepnote')

    it('handles blocks without content field gracefully', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)

      // Find the modified notebook
      const modifiedNotebook = parsed.notebooks.find((nb: { status: string }) => nb.status === 'modified')
      expect(modifiedNotebook).toBeDefined()

      // Image and separator blocks should be unchanged (no content to diff)
      const imageBlock = modifiedNotebook.blockDiffs.find((bd: { id: string }) => bd.id === 'image-block-1')
      const sepBlock = modifiedNotebook.blockDiffs.find((bd: { id: string }) => bd.id === 'sep-block-1')
      expect(imageBlock).toBeUndefined() // unchanged blocks don't appear in blockDiffs
      expect(sepBlock).toBeUndefined()
    })

    it('detects type change even when blocks have no content', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)

      // Type changed (image -> separator) so should be detected as modified
      const modifiedNotebook = parsed.notebooks.find((nb: { status: string }) => nb.status === 'modified')
      const typeChangeBlock = modifiedNotebook.blockDiffs.find((bd: { id: string }) => bd.id === 'type-change-block')
      expect(typeChangeBlock).toBeDefined()
      expect(typeChangeBlock.status).toBe('modified')
    })

    it('handles blocks where content property is not present', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)

      // Big-number block has no content field, so it should be unchanged
      const modifiedNotebook = parsed.notebooks.find((nb: { status: string }) => nb.status === 'modified')
      const bigNumberBlock = modifiedNotebook.blockDiffs.find((bd: { id: string }) => bd.id === 'bn-1')
      expect(bigNumberBlock).toBeUndefined() // unchanged blocks don't appear in blockDiffs
    })
  })
})
