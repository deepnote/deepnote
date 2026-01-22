import fs from 'node:fs/promises'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ExitCode } from '../exit-codes'
import { resetOutputConfig } from '../output'
import { createValidateAction, type ValidateOptions } from './validate'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

async function createTempFile(content: string): Promise<string> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'deepnote-validate-test-'))
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
const DEFAULT_OPTIONS: ValidateOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('validate command', () => {
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

  describe('createValidateAction', () => {
    it('returns a function', () => {
      const action = createValidateAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('validating valid .deepnote files', () => {
    it('validates hello world example without errors', async () => {
      const action = createValidateAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()

      const output = getOutput(consoleSpy)
      expect(output).toContain('✓')
      expect(output).toContain(filePath)
      expect(output).toContain('is valid')
    })

    it('outputs JSON when --json option is used for valid file', async () => {
      const action = createValidateAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.success).toBe(true)
      expect(parsed.valid).toBe(true)
      expect(parsed.path).toBe(filePath)
      expect(parsed.issues).toEqual([])
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createValidateAction(program)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('is valid')
    })

    it('accepts absolute paths', async () => {
      const action = createValidateAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('is valid')
    })
  })

  describe('error handling', () => {
    it('outputs JSON error and exits when file not found with --json', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')

      exitSpy.mockRestore()
    })

    it('exits with error when file not found without --json', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      exitSpy.mockRestore()
    })
  })

  describe('validating invalid .deepnote files', () => {
    it('reports schema validation errors for missing required fields', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a file that's valid YAML but missing required fields
      const invalidContent = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  name: "Test"
version: "1.0.0"
`
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, { json: true })).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.valid).toBe(false)
        expect(parsed.issues).toHaveLength(2)
        expect(parsed.issues.some((i: { path: string }) => i.path === 'project.id')).toBe(true)
        expect(parsed.issues.some((i: { path: string }) => i.path === 'project.notebooks')).toBe(true)
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })

    it('reports YAML parsing errors in JSON format', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a file with invalid YAML
      const invalidContent = 'invalid: yaml: content'
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, { json: true })).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(true)
        expect(parsed.valid).toBe(false)
        expect(parsed.issues).toHaveLength(1)
        expect(parsed.issues[0].code).toBe('yaml_parse_error')
        expect(parsed.issues[0].message).toContain('Invalid YAML')
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })

    it('reports YAML parsing errors in human-readable format', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a file with invalid YAML
      const invalidContent = 'invalid: yaml: content'
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

        const errorOutput = getErrorOutput(consoleErrorSpy)
        expect(errorOutput).toContain('Invalid YAML')
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })

    it('displays validation errors in human-readable format', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a file that's valid YAML but missing required fields
      const invalidContent = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  name: "Test"
version: "1.0.0"
`
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        expect(output).toContain('✗')
        expect(output).toContain('is invalid')
        expect(output).toContain('Validation errors:')
        expect(output).toContain('project.id')
        expect(output).toContain('project.notebooks')
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })

    it('reports invalid block type errors', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a file with an invalid block type
      const invalidContent = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  id: "test-id"
  name: "Test"
  notebooks:
    - id: "notebook-1"
      name: "Test Notebook"
      blocks:
        - id: "block-1"
          type: "invalid-block-type"
          blockGroup: "group-1"
          sortingKey: "a0"
version: "1.0.0"
`
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, { json: true })).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.valid).toBe(false)
        expect(parsed.issues.length).toBeGreaterThan(0)
        // The discriminated union should fail on invalid type
        expect(parsed.issues.some((i: { message: string }) => i.message.includes('Invalid discriminator value'))).toBe(
          true
        )
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })
  })

  describe('exit codes', () => {
    it('exits with code 0 for valid files', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Valid file should not call process.exit
      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(exitSpy).not.toHaveBeenCalled()
      exitSpy.mockRestore()
    })

    it('exits with code 1 for invalid files (schema errors)', async () => {
      const action = createValidateAction(program)
      let exitCode: number | undefined
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCode = typeof code === 'number' ? code : undefined
        throw new Error('process.exit called')
      })

      const invalidContent = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  name: "Test"
version: "1.0.0"
`
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')
        expect(exitCode).toBe(ExitCode.Error)
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })

    it('exits with code 2 for file not found', async () => {
      const action = createValidateAction(program)
      let exitCode: number | undefined
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCode = typeof code === 'number' ? code : undefined
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')
      expect(exitCode).toBe(ExitCode.InvalidUsage)

      exitSpy.mockRestore()
    })
  })

  describe('validating multiple example files', () => {
    it('validates blocks example', async () => {
      const action = createValidateAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.valid).toBe(true)
      expect(parsed.issues).toEqual([])
    })

    it('validates integrations example', async () => {
      const action = createValidateAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.valid).toBe(true)
      expect(parsed.issues).toEqual([])
    })
  })

  describe('JSON output structure', () => {
    it('includes all required fields in valid response', async () => {
      const action = createValidateAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Verify structure
      expect(parsed).toHaveProperty('success')
      expect(parsed).toHaveProperty('valid')
      expect(parsed).toHaveProperty('path')
      expect(parsed).toHaveProperty('issues')
      expect(parsed.success).toBe(true)
      expect(typeof parsed.valid).toBe('boolean')
      expect(typeof parsed.path).toBe('string')
      expect(Array.isArray(parsed.issues)).toBe(true)
    })

    it('includes all required fields in invalid response', async () => {
      const action = createValidateAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      const invalidContent = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  name: "Test"
version: "1.0.0"
`
      const filePath = await createTempFile(invalidContent)

      try {
        await expect(action(filePath, { json: true })).rejects.toThrow('process.exit called')

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)

        // Verify structure
        expect(parsed).toHaveProperty('success')
        expect(parsed).toHaveProperty('valid')
        expect(parsed).toHaveProperty('path')
        expect(parsed).toHaveProperty('issues')
        expect(parsed.success).toBe(true)
        expect(parsed.valid).toBe(false)

        // Verify issue structure
        for (const issue of parsed.issues) {
          expect(issue).toHaveProperty('path')
          expect(issue).toHaveProperty('message')
          expect(issue).toHaveProperty('code')
          expect(typeof issue.path).toBe('string')
          expect(typeof issue.message).toBe('string')
          expect(typeof issue.code).toBe('string')
        }
      } finally {
        await cleanupTempFile(filePath)
        exitSpy.mockRestore()
      }
    })
  })
})
