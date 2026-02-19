import fs from 'node:fs/promises'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ExitCode } from '../exit-codes'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createInspectAction, type InspectOptions } from './inspect'

// Test file path relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')

async function createTempFile(content: string): Promise<string> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'deepnote-inspect-test-'))
  const filePath = join(tempDir, 'test.deepnote')
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
    await fs.rmdir(join(filePath, '..'))
  } catch {
    // Ignore cleanup errors
  }
}

/** Default options for testing */
const DEFAULT_OPTIONS: InspectOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('inspect command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('createInspectAction', () => {
    it('returns a function', () => {
      const action = createInspectAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('inspecting valid .deepnote files', () => {
    it('inspects hello world example without errors', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()

      const output = getOutput(consoleSpy)
      expect(output).toContain(`Path: ${filePath}`)
      expect(output).toContain('Name: Hello world')
      expect(output).toContain('Project ID: 18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('Version: 1.0.0')
      expect(output).toContain('Created: 2025-11-04T00:31:57.544Z')
      expect(output).toContain('Notebooks count: 1')
      expect(output).toContain('Blocks: 1')
    })

    it('displays correct project metadata', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
      expect(output).toContain('18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('1.0.0')
    })

    it('displays notebook information', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebooks:')
      expect(output).toContain('1. Hello World - example')
      expect(output).toContain('1 blocks')
    })

    it('outputs JSON when -o json option is used', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.project.name).toBe('Hello world')
      expect(parsed.project.id).toBe('18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(parsed.version).toBe('1.0.0')
      expect(parsed.statistics.notebookCount).toBe(1)
      expect(parsed.statistics.totalBlocks).toBe(1)
    })

    it('outputs TOON when -o toon option is used', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { output: 'toon' })

      const output = getOutput(consoleSpy)
      // TOON format uses key: value syntax without JSON quotes
      expect(output).toContain('success: true')
      expect(output).toContain('name: Hello world')
      expect(output).toContain('id: 18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('version: 1.0.0')
      // TOON uses tabular format for arrays
      expect(output).toContain('notebooks[1]')
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createInspectAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })

    it('accepts absolute paths', async () => {
      const action = createInspectAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })
  })

  describe('error handling', () => {
    it('outputs JSON error and exits when -o json option is used', async () => {
      const action = createInspectAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('outputs TOON error and exits when -o toon option is used', async () => {
      const action = createInspectAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', { output: 'toon' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      // TOON format for error response
      expect(output).toContain('success: false')
      expect(output).toContain('error:')
      expect(output).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('exits with code 2 for file not found', async () => {
      const action = createInspectAction(program)
      let exitCode: number | undefined
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCode = typeof code === 'number' ? code : undefined
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')
      expect(exitCode).toBe(ExitCode.InvalidUsage)

      exitSpy.mockRestore()
    })

    it('exits with code 2 for invalid YAML (parse error)', async () => {
      const action = createInspectAction(program)
      let exitCode: number | undefined
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCode = typeof code === 'number' ? code : undefined
        throw new Error('process.exit called')
      })

      const filePath = await createTempFile('invalid: [yaml')

      try {
        await expect(action(filePath, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')
        expect(exitCode).toBe(ExitCode.InvalidUsage)
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })
  })
})
