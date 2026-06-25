import fs from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { BUILTIN_INTEGRATIONS } from '@deepnote/database-integrations'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createLintAction, type LintOptions } from './lint'
import { createSplitWithSiblingInitFixture } from './test-helpers'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

/** Default options for testing */
const DEFAULT_OPTIONS: LintOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

/** Minimal multi-notebook fixture; no initNotebookId so every notebook counts as non-init. */
function multiNotebookFile(names: string[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: 'proj-lint',
      name: 'Lint Fixture',
      notebooks: names.map((name, i) => ({ id: `nb-${i}`, name, blocks: [] })),
    },
  }
}

describe('lint command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  describe('createLintAction', () => {
    it('returns a function', () => {
      const action = createLintAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('linting clean files', () => {
    it('reports no issues for hello world file', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      // This file has no issues so should not call process.exit
      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('No issues found')
      expect(exitSpy).not.toHaveBeenCalled()
    })
  })

  describe('-o json output', () => {
    it('outputs valid JSON', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      // This file has no issues
      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
    })

    it('includes all expected fields', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      expect(parsed.path).toBeDefined()
      expect(parsed.success).toBeDefined()
      expect(parsed.issueCount).toBeDefined()
      expect(parsed.issueCount.errors).toBeDefined()
      expect(parsed.issueCount.warnings).toBeDefined()
      expect(parsed.issueCount.total).toBeDefined()
      expect(parsed.issues).toBeDefined()
    })

    it('includes issue details when issues exist', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // The structure should be correct even if issues array is empty
      expect(Array.isArray(parsed.issues)).toBe(true)
    })
  })

  describe('--notebook filter', () => {
    it('filters to a specific notebook', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', notebook: '1. Text blocks' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // All issues (if any) should be from the filtered notebook
      for (const issue of parsed.issues) {
        expect(issue.notebookName).toBe('1. Text blocks')
      }
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createLintAction(program)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(HELLO_WORLD_FILE, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
    })

    it('accepts absolute paths', async () => {
      const action = createLintAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(absolutePath, DEFAULT_OPTIONS)

      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('shows error for non-existent file', async () => {
      const action = createLintAction(program)

      await expect(action('non-existent.deepnote', DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

      const errorOutput = getErrorOutput(consoleErrorSpy)
      expect(errorOutput).toContain('File not found')
    })

    it('outputs JSON error when -o json is used', async () => {
      const action = createLintAction(program)

      await expect(action('non-existent.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('File not found')
    })
  })

  describe('issue detection', () => {
    it('detects issues in blocks file', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // The blocks file may have undefined variables (input_ vars used before defined)
      // or unused variables
      expect(parsed.issueCount).toBeDefined()
      expect(typeof parsed.issueCount.total).toBe('number')
    })

    it('categorizes issues by severity', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Issue counts should be numbers
      expect(typeof parsed.issueCount.errors).toBe('number')
      expect(typeof parsed.issueCount.warnings).toBe('number')

      // Total should equal sum
      expect(parsed.issueCount.total).toBe(parsed.issueCount.errors + parsed.issueCount.warnings)
    })
  })

  describe('lint integrations file', () => {
    it('lints integrations file without crashing', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Should produce valid result
      expect(parsed.path).toBeDefined()
      expect(parsed.issueCount).toBeDefined()
    })
  })

  describe('exit codes', () => {
    it('exits with error code when errors exist', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      let exitCode: number | undefined
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : undefined
        return undefined as never
      })

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // If there are errors, exit code should be 1
      if (parsed.issueCount.errors > 0) {
        expect(exitCode).toBe(1)
      }
    })

    it('does not exit with error when no errors', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      exitSpy.mockRestore()
      let exitCalled = false
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        exitCalled = true
        return undefined as never
      })

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // If success and no errors, should not call exit
      if (parsed.success) {
        expect(exitCalled).toBe(false)
      }
    })
  })

  describe('issue codes', () => {
    it('uses standard issue codes', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      const validCodes = [
        'undefined-variable',
        'circular-dependency',
        'unused-variable',
        'shadowed-variable',
        'parse-error',
        'missing-integration',
        'missing-input',
        'multi-notebook',
      ]

      for (const issue of parsed.issues) {
        expect(validCodes).toContain(issue.code)
        expect(issue.message).toBeDefined()
        expect(issue.blockId).toBeDefined()
        expect(issue.blockLabel).toBeDefined()
        expect(issue.notebookName).toBeDefined()
      }
    })
  })

  describe('multi-notebook warning', () => {
    const tempDirs: string[] = []

    afterEach(() => {
      for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    function writeFixture(names: string[]): string {
      const dir = fs.mkdtempSync(join(os.tmpdir(), 'lint-multi-nb-'))
      tempDirs.push(dir)
      const filePath = join(dir, 'multi.deepnote')
      fs.writeFileSync(filePath, serializeDeepnoteFile(multiNotebookFile(names)))
      return filePath
    }

    it('emits multi-notebook for files with more than one non-init notebook', async () => {
      const action = createLintAction(program)
      const filePath = writeFixture(['Alpha', 'Beta', 'Gamma'])

      await action(filePath, { output: 'json' })

      const codes = (JSON.parse(getOutput(consoleSpy)).issues as Array<{ code: string }>).map(i => i.code)
      expect(codes).toContain('multi-notebook')
    })

    it('suppresses the multi-notebook warning when filtering to a single notebook', async () => {
      const action = createLintAction(program)
      const filePath = writeFixture(['Alpha', 'Beta', 'Gamma'])

      await action(filePath, { output: 'json', notebook: 'Alpha' })

      const codes = (JSON.parse(getOutput(consoleSpy)).issues as Array<{ code: string }>).map(i => i.code)
      expect(codes).not.toContain('multi-notebook')
    })
  })

  describe('sibling init resolution', () => {
    let fixture: Awaited<ReturnType<typeof createSplitWithSiblingInitFixture>> | undefined

    beforeEach(() => {
      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    })

    afterEach(async () => {
      await fixture?.cleanup()
      fixture = undefined
    })

    it('analyzes the composed init notebook (init symbols resolve; init-only issues surface)', async () => {
      fixture = await createSplitWithSiblingInitFixture()
      const action = createLintAction(program)

      await action(fixture.mainPath, { output: 'json' })

      const issues = JSON.parse(getOutput(consoleSpy)).issues as Array<{
        code: string
        notebookName: string
        details?: { variable?: string }
      }>

      // `init_value` is defined only in the sibling init notebook and used by the main notebook;
      // with the init composed it resolves, so there is no false undefined-variable error.
      expect(issues.filter(i => i.code === 'undefined-variable')).toHaveLength(0)

      // `init_only_unused` lives in the init notebook and is used nowhere. It can only be flagged if
      // the sibling init was actually resolved and analyzed — proving the init notebook is in scope.
      const initUnused = issues.find(i => i.code === 'unused-variable' && i.details?.variable === 'init_only_unused')
      expect(initUnused).toBeDefined()
      expect(initUnused?.notebookName).toBe('Init')
    })
  })

  describe('text output format', () => {
    it('shows issues grouped by notebook in text mode', async () => {
      const action = createLintAction(program)
      // Use integrations file which has warnings
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, DEFAULT_OPTIONS)

      const textOutput = getOutput(consoleSpy)
      // Should contain notebook name
      expect(textOutput).toContain('Integrations')
      // Should contain summary
      expect(textOutput).toContain('Summary:')
      // Should contain warning count
      expect(textOutput).toContain('warning')
    })

    it('shows severity icons and issue codes in text output', async () => {
      const action = createLintAction(program)
      // Use integrations file which has warnings
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, DEFAULT_OPTIONS)

      const textOutput = getOutput(consoleSpy)
      // Should contain issue codes
      expect(textOutput).toContain('unused-variable')
    })

    it('shows block labels in issue output', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, DEFAULT_OPTIONS)

      const textOutput = getOutput(consoleSpy)
      // Should contain block label with "in" prefix
      expect(textOutput).toContain('in ')
    })
  })

  describe('integration with DAG', () => {
    it('analyzes variable flow using DAG', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Should have analyzed the file successfully
      expect(parsed.path).toBeDefined()
      expect(parsed.issueCount).toBeDefined()
    })

    it('detects unused variables when present', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Check if unused-variable issues were detected (may or may not be present)
      const unusedVarIssues = parsed.issues.filter((i: { code: string }) => i.code === 'unused-variable')
      expect(Array.isArray(unusedVarIssues)).toBe(true)
    })

    it('detects shadowed variables when present', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Check if shadowed-variable issues were detected (may or may not be present)
      const shadowedIssues = parsed.issues.filter((i: { code: string }) => i.code === 'shadowed-variable')
      expect(Array.isArray(shadowedIssues)).toBe(true)
    })
  })

  describe('integration checks', () => {
    it('includes integrations summary in JSON output', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Should include integrations summary
      expect(parsed.integrations).toBeDefined()
      expect(Array.isArray(parsed.integrations.configured)).toBe(true)
      expect(Array.isArray(parsed.integrations.missing)).toBe(true)
    })

    it('detects missing integrations when env vars not set', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      // Ensure no SQL env vars are set
      const originalEnv = { ...process.env }
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('SQL_')) {
          delete process.env[key]
        }
      }

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      try {
        await action(filePath, { output: 'json' })

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)

        // The integrations file has SQL blocks with non-builtin integrations
        // Without env vars, they should be missing
        const missingIntegrationIssues = parsed.issues.filter((i: { code: string }) => i.code === 'missing-integration')
        expect(Array.isArray(missingIntegrationIssues)).toBe(true)
        // If integrations file uses external integrations, there should be issues
        if (parsed.integrations.missing.length > 0) {
          expect(missingIntegrationIssues.length).toBeGreaterThan(0)
        }
      } finally {
        // Restore env
        process.env = originalEnv
      }
    })

    it('does not flag builtin integrations as missing', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Builtin integrations should not appear in missing
      for (const builtin of BUILTIN_INTEGRATIONS) {
        expect(parsed.integrations.missing).not.toContain(builtin)
      }
    })
  })

  describe('input checks', () => {
    it('includes inputs summary in JSON output', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Should include inputs summary
      expect(parsed.inputs).toBeDefined()
      expect(typeof parsed.inputs.total).toBe('number')
      expect(typeof parsed.inputs.withValues).toBe('number')
      expect(Array.isArray(parsed.inputs.needingValues)).toBe(true)
    })

    it('detects inputs without default values', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      // Check for missing-input issues (warning level)
      const missingInputIssues = parsed.issues.filter((i: { code: string }) => i.code === 'missing-input')
      expect(Array.isArray(missingInputIssues)).toBe(true)

      // All missing-input issues should be warnings
      for (const issue of missingInputIssues) {
        expect(issue.severity).toBe('warning')
      }
    })

    it('missing-input issues include variable name in details', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const parsed = JSON.parse(output)

      const missingInputIssues = parsed.issues.filter((i: { code: string }) => i.code === 'missing-input')
      for (const issue of missingInputIssues) {
        expect(issue.details).toBeDefined()
        expect(issue.details.variableName).toBeDefined()
        expect(issue.details.inputType).toBeDefined()
      }
    })
  })

  describe('global options', () => {
    describe('--no-color', () => {
      it('produces output without ANSI escape codes when color is disabled', async () => {
        setOutputConfig({ color: false })
        const action = createLintAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, DEFAULT_OPTIONS)

        const output = getOutput(consoleSpy)
        // ANSI escape codes start with \x1b[ (ESC[)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Testing for ANSI codes
        expect(output).not.toMatch(/\x1b\[/)
        // Should still have content (no issues found message)
        expect(output).toContain('No issues found')
      })
    })

    describe('--quiet', () => {
      it('still outputs essential content in quiet mode', async () => {
        setOutputConfig({ quiet: true })
        const action = createLintAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, DEFAULT_OPTIONS)

        // Essential output should still appear
        const output = getOutput(consoleSpy)
        expect(output).toContain('No issues found')
      })

      it('still outputs JSON in quiet mode', async () => {
        setOutputConfig({ quiet: true })
        const action = createLintAction(program)
        const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

        await action(filePath, { output: 'json' })

        const output = getOutput(consoleSpy)
        const parsed = JSON.parse(output)
        expect(parsed.success).toBe(true)
      })
    })
  })
})
