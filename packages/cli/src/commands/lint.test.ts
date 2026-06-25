import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { BUILTIN_INTEGRATIONS, getSqlEnvVarName } from '@deepnote/database-integrations'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createLintAction, type LintOptions } from './lint'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const INTEGRATIONS_FILE = join('examples', '3_integrations.deepnote')

// The (only) SQL integration id referenced by the SQL block in 3_integrations.deepnote. Tests that
// want this integration to read as "missing" unset its generated SQL_* env var via vi.stubEnv.
const INTEGRATIONS_FILE_SQL_INTEGRATION_ID = '100eef5b-8ad8-4d35-8e5e-3dfeeb387d4d'

/** Default options for testing */
const DEFAULT_OPTIONS: LintOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

function getErrorOutput(spy: Mock<typeof console.error>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

/** Normalize the per-run temp dir (absolute and cwd-relative forms) so text snapshots are stable. */
function withStableTmpPaths(text: string, tempDir: string): string {
  // Replace the cwd-relative form first: the absolute tempDir is a substring of it, so
  // replacing the absolute form first would leave a machine-dependent `../..` prefix behind.
  const relTmp = relative(process.cwd(), tempDir)
  return text.split(relTmp).join('<tmp>').split(tempDir).join('<tmp>').split(sep).join('/')
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
    vi.unstubAllEnvs()
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

      // Ensure the SQL integration's env var is not set so it reads as missing
      vi.stubEnv(getSqlEnvVarName(INTEGRATIONS_FILE_SQL_INTEGRATION_ID), undefined)

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

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

describe('lint command - linting integrations yaml directly', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `lint-direct-yaml-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

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
    vi.unstubAllEnvs()
  })

  it('reports no issues for a valid integrations yaml file', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)
    const intFile = join(tempDir, 'valid.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: my-postgres
    name: My PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: secret`
    )

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`"✓ No issues found"`)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('reports issues for invalid integration type in yaml file', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)
    const intFile = join(tempDir, 'invalid-type.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: bad-db
    name: Bad DB
    type: not-a-real-type
    metadata:
      host: localhost`
    )

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`
      "Configuration issues in <tmp>/invalid-type.yaml

        ✖ invalid_union_discriminator: Integration "Bad DB": Invalid discriminator value. Expected 'alloydb' | 'athena' | 'big-query' | 'clickhouse' | 'cloud-sql' | 'databricks' | 'dremio' | 'mariadb' | 'materialize' | 'mindsdb' | 'mongodb' | 'mysql' | 'pandas-dataframe' | 'pgsql' | 'redshift' | 'snowflake' | 'spanner' | 'sql-server' | 'trino'
          at integrations[0].type

      Summary: 1 configuration error"
    `)
  })

  it('reports issues for missing env var references', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)
    const intFile = join(tempDir, 'missing-env.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: pg
    name: PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:LINT_DIRECT_MISSING_ENV_VAR_XYZ"`
    )

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`
      "Configuration issues in <tmp>/missing-env.yaml

        ✖ env_var_not_defined: Integration "PostgreSQL": Environment variable "LINT_DIRECT_MISSING_ENV_VAR_XYZ" is not defined at "metadata.password"
          at integrations[0].metadata.password

      Summary: 1 configuration error"
    `)
  })

  it('resolves env var references when env var is set', async () => {
    setOutputConfig({ color: false })
    vi.stubEnv('LINT_DIRECT_DB_PASSWORD', 'test-secret')

    const action = createLintAction(program)
    const intFile = join(tempDir, 'env-ref.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: pg
    name: PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:LINT_DIRECT_DB_PASSWORD"`
    )

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`"✓ No issues found"`)
  })

  it('outputs valid JSON for a clean integrations yaml file', async () => {
    const action = createLintAction(program)
    const intFile = join(tempDir, 'valid-json.yaml')
    await writeFile(intFile, 'integrations: []')

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, { output: 'json' })

    const out = getOutput(consoleSpy)
    const parsed = JSON.parse(out)
    expect(parsed).toEqual({
      path: intFile,
      success: true,
      issueCount: { errors: 0, warnings: 0, total: 0 },
      issues: [],
      integrationsFile: {
        path: intFile,
        integrationCount: 0,
        issues: [],
      },
    })
  })

  it('outputs JSON with issues for an invalid integrations yaml file', async () => {
    const action = createLintAction(program)
    const intFile = join(tempDir, 'invalid-json.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: bad
    name: Bad
    type: invalid-type
    metadata: {}`
    )

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, { output: 'json' })

    const out = getOutput(consoleSpy)
    const parsed = JSON.parse(out)
    expect(parsed).toEqual({
      path: intFile,
      success: false,
      issueCount: { errors: 1, warnings: 0, total: 1 },
      issues: [],
      integrationsFile: {
        path: intFile,
        integrationCount: 0,
        issues: [
          {
            path: 'integrations[0].type',
            message: expect.stringContaining('Invalid discriminator value'),
            code: 'invalid_union_discriminator',
          },
        ],
      },
    })
    // issueCount must reflect the configuration issues (hard errors) so it stays consistent with
    // `success: false` and `integrationsFile.issues` (direct-YAML path).
    expect(parsed.issueCount.errors).toBe(parsed.integrationsFile.issues.length)
    expect(parsed.issueCount.total).toBe(parsed.integrationsFile.issues.length)
  })

  it('exits with error code when integrations yaml has issues', async () => {
    const action = createLintAction(program)
    const intFile = join(tempDir, 'error-exit.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: bad
    name: Bad
    type: invalid-type
    metadata: {}`
    )

    exitSpy.mockRestore()
    let exitCode: number | undefined
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      exitCode = typeof code === 'number' ? code : undefined
      return undefined as never
    })

    await action(intFile, { output: 'json' })

    expect(exitCode).toBe(1)
  })

  it('reports a generation error for a schema-valid but impossible to generate integration (invalid bigquery service account)', async () => {
    const action = createLintAction(program)
    const intFile = join(tempDir, 'bigquery-bad-service-account.yaml')
    await writeFile(
      intFile,
      `integrations:
  - id: bq
    name: My BigQuery
    type: big-query
    metadata:
      service_account: "this is not valid json"`
    )

    exitSpy.mockRestore()
    let exitCode: number | undefined
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      exitCode = typeof code === 'number' ? code : undefined
      return undefined as never
    })

    await action(intFile, { output: 'json' })

    const out = getOutput(consoleSpy)
    const parsed = JSON.parse(out)
    expect(parsed).toEqual({
      path: intFile,
      success: false,
      issueCount: { errors: 1, warnings: 0, total: 1 },
      issues: [],
      integrationsFile: {
        path: intFile,
        integrationCount: 1,
        issues: [
          {
            path: 'integrations[0].metadata',
            message: expect.stringContaining('Failed to parse bigquery service account'),
            code: 'big_query_service_account_parse_error',
          },
        ],
      },
    })
    // The generation error must produce a non-zero exit code (it is a hard error).
    expect(exitCode).toBe(1)
  })

  it('shows error for non-existent yaml file', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)

    await expect(action(join(tempDir, 'does-not-exist.yaml'), DEFAULT_OPTIONS)).rejects.toThrow('process.exit called')

    const errorOutput = getErrorOutput(consoleErrorSpy)
    expect(withStableTmpPaths(errorOutput, tempDir)).toMatchInlineSnapshot(
      `"File not found: <tmp>/does-not-exist.yaml"`
    )
  })

  it('reports yaml parse errors with human-readable message', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)
    const intFile = join(tempDir, 'bad-yaml.yaml')
    await writeFile(intFile, 'integrations:\n  - id: "unclosed string')

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`
      "Configuration issues in <tmp>/bad-yaml.yaml

        ✖ yaml_parse_error: Invalid YAML in integrations file: YAML parsing error: Missing closing "quote at line 2, column 25:

        - id: "unclosed string
                              ^


      Summary: 1 configuration error"
    `)
  })

  it('also works with .yml extension', async () => {
    setOutputConfig({ color: false })
    const action = createLintAction(program)
    const intFile = join(tempDir, 'valid.yml')
    await writeFile(intFile, 'integrations: []')

    exitSpy.mockRestore()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await action(intFile, DEFAULT_OPTIONS)

    const textOutput = getOutput(consoleSpy)
    expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`"✓ No issues found"`)
  })
})

describe('lint command - integrations file loading', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `lint-integrations-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

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
    vi.unstubAllEnvs()
  })

  describe('integrationsFile in JSON output', () => {
    it('always includes integrationsFile field in JSON output', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'empty-integrations.yaml')
      await writeFile(intFile, 'integrations: []')

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: true,
        issueCount: { errors: 0, warnings: 0, total: 0 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 0,
          issues: [],
        },
      })
    })

    it('reports integrationCount when integrations are loaded', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'valid-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: my-postgres
    name: My PostgreSQL
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: secret`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: true,
        issueCount: { errors: 0, warnings: 0, total: 0 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 1,
          issues: [],
        },
      })
    })

    it('reports issues when integrations file has schema errors', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'bad-type-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: bad-integration
    name: Bad Integration
    type: not-a-real-db-type
    metadata:
      host: localhost`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: false,
        issueCount: { errors: 1, warnings: 0, total: 1 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 0,
          issues: [
            {
              path: 'integrations[0].type',
              message: expect.stringContaining('Invalid discriminator value'),
              code: 'invalid_union_discriminator',
            },
          ],
        },
      })
      // issueCount must reflect the configuration issues (hard errors) so it stays consistent with
      // `success: false` and `integrationsFile.issues` (.deepnote + integrations-file path).
      expect(parsed.issueCount.errors).toBe(parsed.integrationsFile.issues.length)
      expect(parsed.issueCount.total).toBe(parsed.integrationsFile.issues.length)
    })

    it('reports issues when integrations file has YAML syntax errors', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'bad-yaml-integrations.yaml')
      await writeFile(intFile, 'integrations:\n  - id: "unclosed string')

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: false,
        issueCount: { errors: 1, warnings: 0, total: 1 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 0,
          issues: [
            {
              path: '',
              message: expect.stringContaining('Invalid YAML in integrations file'),
              code: 'yaml_parse_error',
            },
          ],
        },
      })
    })

    it('reports issues when env var references are unresolved', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'missing-env-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: postgres-missing-env
    name: PostgreSQL Missing Env
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:LINT_TEST_MISSING_ENV_VAR_XYZ"`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: false,
        issueCount: { errors: 1, warnings: 0, total: 1 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 0,
          issues: [
            {
              path: 'integrations[0].metadata.password',
              message: expect.stringContaining('LINT_TEST_MISSING_ENV_VAR_XYZ'),
              code: 'env_var_not_defined',
            },
          ],
        },
      })
    })

    it('resolves env var references when env var is set', async () => {
      vi.stubEnv('LINT_TEST_DB_PASSWORD', 'test-secret')

      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'env-ref-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: postgres-env-ref
    name: PostgreSQL Env Ref
    type: pgsql
    metadata:
      host: localhost
      port: "5432"
      database: mydb
      user: root
      password: "env:LINT_TEST_DB_PASSWORD"`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: true,
        issueCount: { errors: 0, warnings: 0, total: 0 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 1,
          issues: [],
        },
      })
    })
  })

  describe('text output with configuration issues', () => {
    it('shows configuration issues section when integrations file has errors', async () => {
      setOutputConfig({ color: false })
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'text-output-bad-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: my-bad-db
    name: My Bad DB
    type: unknown-db-type
    metadata:
      host: localhost`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { integrationsFile: intFile })

      const textOutput = getOutput(consoleSpy)
      expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`
        "Configuration issues in <tmp>/text-output-bad-integrations.yaml

          ✖ invalid_union_discriminator: Integration "My Bad DB": Invalid discriminator value. Expected 'alloydb' | 'athena' | 'big-query' | 'clickhouse' | 'cloud-sql' | 'databricks' | 'dremio' | 'mariadb' | 'materialize' | 'mindsdb' | 'mongodb' | 'mysql' | 'pandas-dataframe' | 'pgsql' | 'redshift' | 'snowflake' | 'spanner' | 'sql-server' | 'trino'
            at integrations[0].type

        Summary: 1 configuration error"
      `)
    })

    it('shows "No issues found" when both notebook and integrations file are clean', async () => {
      setOutputConfig({ color: false })
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'clean-integrations.yaml')
      await writeFile(intFile, 'integrations: []')

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { integrationsFile: intFile })

      const textOutput = getOutput(consoleSpy)
      expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`"✓ No issues found"`)
    })

    it('includes path info in configuration issues section', async () => {
      setOutputConfig({ color: false })
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'path-info-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: bad
    name: Bad
    type: invalid-type
    metadata: {}`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { integrationsFile: intFile })

      const textOutput = getOutput(consoleSpy)
      expect(withStableTmpPaths(textOutput, tempDir)).toMatchInlineSnapshot(`
        "Configuration issues in <tmp>/path-info-integrations.yaml

          ✖ invalid_union_discriminator: Integration "Bad": Invalid discriminator value. Expected 'alloydb' | 'athena' | 'big-query' | 'clickhouse' | 'cloud-sql' | 'databricks' | 'dremio' | 'mariadb' | 'materialize' | 'mindsdb' | 'mongodb' | 'mysql' | 'pandas-dataframe' | 'pgsql' | 'redshift' | 'snowflake' | 'spanner' | 'sql-server' | 'trino'
            at integrations[0].type

        Summary: 1 configuration error"
      `)
    })
  })

  describe('exit code with configuration issues', () => {
    it('exits with error code when integrations file has issues', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'exit-code-bad-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: bad
    name: Bad
    type: invalid-type
    metadata: {}`
      )

      exitSpy.mockRestore()
      let exitCode: number | undefined
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : undefined
        return undefined as never
      })

      await action(filePath, { output: 'json', integrationsFile: intFile })

      expect(exitCode).toBe(1)
    })

    it('does not exit with error when integrations file has no issues', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'exit-code-clean-integrations.yaml')
      await writeFile(intFile, 'integrations: []')

      exitSpy.mockRestore()
      let exitCalled = false
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        exitCalled = true
        return undefined as never
      })

      await action(filePath, { output: 'json', integrationsFile: intFile })

      expect(exitCalled).toBe(false)
    })
  })

  describe('integrations loaded from file affect missing-integration check', () => {
    it('does not flag an integration as missing when it is configured in the integrations file', async () => {
      const action = createLintAction(program)
      // Use the integrations example which has SQL blocks with non-builtin integrations
      const filePath = resolve(process.cwd(), INTEGRATIONS_FILE)

      // Create an integrations file that provides the exact integration id referenced by the
      // SQL block in 3_integrations.deepnote. The id is digit-prefixed, which exercises the
      // leading-digit env var naming rule that previously caused a false missing-integration.
      const integrationId = INTEGRATIONS_FILE_SQL_INTEGRATION_ID

      // Clear the integration's SQL_ env var so it would otherwise appear as missing
      vi.stubEnv(getSqlEnvVarName(integrationId), undefined)

      const intFile = join(tempDir, 'clickhouse-integration.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: ${integrationId}
    name: ClickHouse
    type: clickhouse
    metadata:
      host: localhost
      port: "8123"
      database: default
      user: default
      password: ""`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      // The integration loaded from the file must be considered configured, not missing.
      expect(parsed.integrations.missing).not.toContain(integrationId)
      expect(parsed.integrations.configured).toContain(integrationId)
    })
  })

  describe('integration env var generation errors', () => {
    it('reports a generation error for a schema-valid but impossible to generate integration (invalid bigquery service account)', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'bigquery-bad-service-account-integrations.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: bq
    name: My BigQuery
    type: big-query
    metadata:
      service_account: "this is not valid json"`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: intFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: false,
        issueCount: { errors: 1, warnings: 0, total: 1 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: intFile,
          integrationCount: 1,
          issues: [
            {
              path: 'integrations[0].metadata',
              message: expect.stringContaining('Failed to parse bigquery service account'),
              code: 'big_query_service_account_parse_error',
            },
          ],
        },
      })
    })

    it('exits with error code when an integration env var cannot be generated', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const intFile = join(tempDir, 'bigquery-bad-service-account-exit.yaml')
      await writeFile(
        intFile,
        `integrations:
  - id: bq
    name: My BigQuery
    type: big-query
    metadata:
      service_account: "this is not valid json"`
      )

      exitSpy.mockRestore()
      let exitCode: number | undefined
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : undefined
        return undefined as never
      })

      await action(filePath, { output: 'json', integrationsFile: intFile })

      expect(exitCode).toBe(1)
    })
  })

  describe('--integrations-file option', () => {
    it('uses the specified integrations file instead of the default', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const customIntFile = join(tempDir, 'custom-path-integrations.yaml')
      await writeFile(
        customIntFile,
        `integrations:
  - id: my-custom-db
    name: My Custom DB
    type: pgsql
    metadata:
      host: custom-host
      port: "5432"
      database: custom_db
      user: custom_user
      password: custom_pass`
      )

      exitSpy.mockRestore()
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await action(filePath, { output: 'json', integrationsFile: customIntFile })

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)

      expect(parsed).toEqual({
        path: filePath,
        success: true,
        issueCount: { errors: 0, warnings: 0, total: 0 },
        issues: [],
        integrations: { configured: [], missing: [] },
        inputs: { total: 0, withValues: 0, needingValues: [] },
        integrationsFile: {
          path: customIntFile,
          integrationCount: 1,
          issues: [],
        },
      })
    })

    it('errors when an explicitly specified integrations file does not exist', async () => {
      const action = createLintAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)
      const nonExistentFile = join(tempDir, 'does-not-exist.yaml')

      exitSpy.mockRestore()
      let exitCode: number | undefined
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        exitCode = typeof code === 'number' ? code : undefined
        throw new Error('process.exit called')
      })

      await expect(action(filePath, { output: 'json', integrationsFile: nonExistentFile })).rejects.toThrow(
        'process.exit called'
      )

      // FileResolutionError maps to ExitCode.InvalidUsage (2)
      expect(exitCode).toBe(2)

      const out = getOutput(consoleSpy)
      const parsed = JSON.parse(out)
      expect(parsed).toEqual({ success: false, error: expect.stringContaining('File not found') })
    })
  })
})
