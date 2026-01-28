import fs from 'node:fs/promises'
import os from 'node:os'
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

  describe('modified blocks with content diff', () => {
    let tempDir: string
    let file1Path: string
    let file2Path: string

    const baseFile = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-01T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-1
          id: block-1
          type: code
          content: |
            print("original code")
            x = 1
            y = 2
          sortingKey: a0
        - blockGroup: block-2
          id: block-2
          type: markdown
          content: "# Original Title"
          sortingKey: a1
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    const modifiedFile = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-02T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-1
          id: block-1
          type: code
          content: |
            print("modified code")
            x = 10
            y = 20
            z = 30
          sortingKey: a0
        - blockGroup: block-2
          id: block-2
          type: markdown
          content: "# Modified Title"
          sortingKey: a1
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'diff-test-'))
      file1Path = join(tempDir, 'original.deepnote')
      file2Path = join(tempDir, 'modified.deepnote')
      await fs.writeFile(file1Path, baseFile)
      await fs.writeFile(file2Path, modifiedFile)
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

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
    let tempDir: string
    let file1Path: string
    let file2Path: string

    const fileWithBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-01T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-original
          id: block-original
          type: code
          content: "print('original')"
          sortingKey: a0
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    const fileWithDifferentBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-02T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-new
          id: block-new
          type: code
          content: "print('new')"
          sortingKey: a0
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'diff-test-'))
      file1Path = join(tempDir, 'file1.deepnote')
      file2Path = join(tempDir, 'file2.deepnote')
      await fs.writeFile(file1Path, fileWithBlock)
      await fs.writeFile(file2Path, fileWithDifferentBlock)
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

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
      // Should show removed block with minus and added block with plus
      expect(output).toContain('-')
      expect(output).toContain('+')
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

  describe('blocks without string content', () => {
    let tempDir: string
    let file1Path: string
    let file2Path: string

    // File with blocks that have no content field (image and separator blocks)
    const fileWithImageBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-01T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: image-block-1
          id: image-block-1
          type: image
          url: https://example.com/image1.png
          sortingKey: a0
        - blockGroup: sep-block-1
          id: sep-block-1
          type: separator
          sortingKey: a1
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    const fileWithModifiedImageBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-02T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: image-block-1
          id: image-block-1
          type: image
          url: https://example.com/image2.png
          sortingKey: a0
        - blockGroup: sep-block-1
          id: sep-block-1
          type: separator
          sortingKey: a1
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'diff-test-'))
      file1Path = join(tempDir, 'file1.deepnote')
      file2Path = join(tempDir, 'file2.deepnote')
      await fs.writeFile(file1Path, fileWithImageBlock)
      await fs.writeFile(file2Path, fileWithModifiedImageBlock)
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('handles blocks without content field gracefully', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      // Blocks without content field are treated as having undefined content
      // Image blocks have different URLs but getBlockContent returns undefined for both
      expect(parsed.summary.notebooksUnchanged).toBe(1)
    })
  })

  describe('blocks with type change but no content', () => {
    let tempDir: string
    let file1Path: string
    let file2Path: string

    // File with an image block (no content field)
    const fileWithImageBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-01T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-1
          id: block-1
          type: image
          url: https://example.com/image.png
          sortingKey: a0
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    // Same block ID but different type (separator has no content either)
    const fileWithSeparatorBlock = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-02T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: block-1
          id: block-1
          type: separator
          sortingKey: a0
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'diff-test-'))
      file1Path = join(tempDir, 'file1.deepnote')
      file2Path = join(tempDir, 'file2.deepnote')
      await fs.writeFile(file1Path, fileWithImageBlock)
      await fs.writeFile(file2Path, fileWithSeparatorBlock)
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('detects type change even when blocks have no content', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      // Type changed (image -> separator) so should be detected as modified
      expect(parsed.summary.blocksModified).toBe(1)
      expect(parsed.summary.notebooksModified).toBe(1)
    })
  })

  describe('blocks with optional content not provided', () => {
    let tempDir: string
    let file1Path: string
    let file2Path: string

    // Big-number block without content field (content is optional in schema)
    const fileWithBigNumber1 = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-01T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: bn-1
          id: bn-1
          type: big-number
          sortingKey: a0
          metadata:
            deepnote_big_number_title: "Title 1"
            deepnote_big_number_value: "100"
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    // Same ID but different metadata (triggers modified detection)
    const fileWithBigNumber2 = `metadata:
  createdAt: 2025-01-01T00:00:00.000Z
  modifiedAt: '2025-01-02T00:00:00.000Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - blocks:
        - blockGroup: bn-1
          id: bn-1
          type: big-number
          sortingKey: a0
          metadata:
            deepnote_big_number_title: "Title 2"
            deepnote_big_number_value: "200"
      executionMode: block
      id: notebook-1
      isModule: false
      name: Test Notebook
  settings: {}
version: 1.0.0
`

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'diff-test-'))
      file1Path = join(tempDir, 'file1.deepnote')
      file2Path = join(tempDir, 'file2.deepnote')
      await fs.writeFile(file1Path, fileWithBigNumber1)
      await fs.writeFile(file2Path, fileWithBigNumber2)
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('handles blocks where content property is not present', async () => {
      const action = createDiffAction(program)

      await action(file1Path, file2Path, { output: 'json', content: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      // Both blocks have same ID and neither has content, so contentDiff should have undefined values
      // The blocks should be detected as unchanged since getBlockContent returns undefined for both
      expect(parsed.summary.notebooksUnchanged).toBe(1)
    })
  })
})
