import fs from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  type DatabaseIntegrationConfig,
  type EnvVar,
  getEnvironmentVariablesForIntegrations,
} from '@deepnote/database-integrations'
import { resolvePythonExecutable } from '@deepnote/runtime-core'
import type { Command } from 'commander'
import dotenv from 'dotenv'
import { DEFAULT_ENV_FILE } from '../constants'
import { ExitCode } from '../exit-codes'
import { getDefaultIntegrationsFilePath, parseIntegrationsFile } from '../integrations/parse-integrations'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { checkForIssues, type LintIssue, type LintResult } from '../utils/analysis'
import { FileResolutionError, isErrnoENOENT, resolvePathToDeepnoteFile } from '../utils/file-resolver'
import type { ValidationIssue } from './validate'

export interface LintOptions {
  output?: 'json'
  notebook?: string
  python?: string
  integrationsFile?: string
}

export interface IntegrationsFileResult {
  path: string
  integrationCount: number
  issues: ValidationIssue[]
}

/** Full lint result including file path */
interface LintFileResult extends LintResult {
  path: string
  integrationsFile: IntegrationsFileResult
}

/**
 * Returns true if the given path points to a YAML file (integrations env file).
 */
function isYamlPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.yaml' || ext === '.yml'
}

/**
 * Run `fn` with a snapshot of `process.env` taken beforehand, restoring the original environment
 * afterwards (even if `fn` throws). Linting loads `.env` via `dotenv.config` and injects generated
 * integration env vars into `process.env`; without this a lint run would permanently mutate the
 * process environment, making subsequent in-process runs non-idempotent (e.g. an integration that
 * was reported missing would silently start passing) and clobbering caller-provided env values.
 */
async function withRestoredEnv<T>(fn: () => Promise<T>): Promise<T> {
  const originalEnv = { ...process.env }
  try {
    return await fn()
  } finally {
    // Reset to the snapshot: delete keys added during the run, then restore originals. Assigning
    // `process.env = originalEnv` would replace the live env object some libraries hold a reference
    // to, so mutate the existing object in place instead.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, originalEnv)
  }
}

/**
 * Derive a stable, snake_case issue code from an error's class name.
 * e.g. `BigQueryServiceAccountParseError` -> `big_query_service_account_parse_error`,
 * `SpannerServiceAccountParseError` -> `spanner_service_account_parse_error`.
 */
function errorCodeFromName(errorName: string): string {
  const code = errorName
    // Insert separators between case transitions (e.g. "ServiceAccount" -> "Service_Account").
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
  return code || 'integration_env_var_error'
}

/**
 * Generate the SQL/connection environment variables for the given integrations and surface any
 * generation failures as validation issues.
 *
 * The integrations have already passed schema validation, but some fields (e.g. BigQuery / Spanner
 * `service_account`) only fail when the env vars are generated (invalid JSON). Those failures are
 * hard errors and must not lint green, so we run generation per-integration to associate each error
 * with the integration that produced it (for a useful `path`/`code`).
 *
 * @returns the successfully generated env vars (to inject into `process.env`) and any issues.
 */
function generateIntegrationEnvVars(
  integrations: DatabaseIntegrationConfig[],
  projectRootDirectory: string
): { envVars: EnvVar[]; issues: ValidationIssue[] } {
  const envVars: EnvVar[] = []
  const issues: ValidationIssue[] = []

  for (let i = 0; i < integrations.length; i++) {
    const integration = integrations[i]
    const { envVars: generated, errors } = getEnvironmentVariablesForIntegrations([integration], {
      projectRootDirectory,
    })
    envVars.push(...generated)

    const integrationLabel = integration.name || integration.id
    for (const err of errors) {
      debug(`Integration env var error: ${err.message}`)
      const context = integrationLabel ? `Integration "${integrationLabel}": ` : ''
      issues.push({
        path: `integrations[${i}].metadata`,
        message: `${context}${err.message}`,
        code: errorCodeFromName(err.name),
      })
    }
  }

  return { envVars, issues }
}

/**
 * Creates the lint action - checks for issues in a .deepnote file or integrations yaml file.
 */
export function createLintAction(_program: Command): (path: string | undefined, options: LintOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Linting: ${path}`)
      const result = path && isYamlPath(path) ? await lintIntegrationsFile(path) : await lintFile(path, options)
      outputLintResult(result, options)

      // Exit with error code if there are notebook errors or configuration errors
      const hasErrors = result.issueCount.errors > 0 || result.integrationsFile.issues.length > 0
      if (hasErrors) {
        process.exit(ExitCode.Error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error

      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(exitCode)
    }
  }
}

async function lintFile(path: string | undefined, options: LintOptions): Promise<LintFileResult> {
  // Loading `.env` and injecting integration env vars mutates `process.env`; restore it afterwards
  // so a lint run is idempotent and doesn't clobber caller-provided env values (see withRestoredEnv).
  return withRestoredEnv(async () => {
    const { absolutePath } = await resolvePathToDeepnoteFile(path)
    const fileDir = dirname(absolutePath)

    debug('Reading file contents...')
    const rawBytes = await fs.readFile(absolutePath)
    const yamlContent = decodeUtf8NoBom(rawBytes)

    debug('Parsing .deepnote file...')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    // Load .env file so env: references in integrations can be resolved
    dotenv.config({ path: join(fileDir, DEFAULT_ENV_FILE), quiet: true })

    // Load and parse integrations file
    const integrationsFilePath = options.integrationsFile ?? getDefaultIntegrationsFilePath(fileDir)

    // If the user explicitly specified an integrations file, fail loudly when it's missing
    // (an absent implicit default file is fine — integrations are optional in that case).
    if (options.integrationsFile) {
      try {
        await fs.stat(integrationsFilePath)
      } catch (error) {
        if (isErrnoENOENT(error)) {
          throw new FileResolutionError(`File not found: ${integrationsFilePath}`)
        }
        throw error
      }
    }

    debug(`Loading integrations from: ${integrationsFilePath}`)
    const parsedIntegrations = await parseIntegrationsFile(integrationsFilePath)

    debug(`Parsed ${parsedIntegrations.integrations.length} integrations, ${parsedIntegrations.issues.length} issues`)

    // Generate integration env vars and inject them into process.env so checkMissingIntegrations
    // works correctly. Generation failures (e.g. invalid BigQuery/Spanner service_account JSON) are
    // surfaced as configuration issues so a schema-valid-but-impossible to generate integration doesn't lint green.
    const integrationsIssues = [...parsedIntegrations.issues]
    if (parsedIntegrations.integrations.length > 0) {
      const { envVars, issues } = generateIntegrationEnvVars(parsedIntegrations.integrations, fileDir)
      integrationsIssues.push(...issues)
      for (const { name, value } of envVars) {
        process.env[name] = value
      }
      debug(
        `Injected ${envVars.length} environment variables for ${parsedIntegrations.integrations.length} integrations`
      )
    }

    debug(`Analyzing blocks...`)
    const pythonInterpreter = options.python ? await resolvePythonExecutable(options.python) : undefined
    const { lint } = await checkForIssues(deepnoteFile, {
      notebook: options.notebook,
      pythonInterpreter,
    })

    // Integration/config issues are hard errors (no severity field), so fold their count into
    // both `errors` and `total` to keep `issueCount` consistent with `success` and the reported
    // `integrationsFile.issues` (warnings are unaffected).
    return {
      path: absolutePath,
      ...lint,
      success: lint.success && integrationsIssues.length === 0,
      issueCount: {
        errors: lint.issueCount.errors + integrationsIssues.length,
        warnings: lint.issueCount.warnings,
        total: lint.issueCount.total + integrationsIssues.length,
      },
      integrationsFile: {
        path: integrationsFilePath,
        integrationCount: parsedIntegrations.integrations.length,
        issues: integrationsIssues,
      },
    }
  })
}

/**
 * Lint an integrations env yaml file directly (without a .deepnote notebook).
 * Validates the file structure, integration schemas, and env var references.
 */
async function lintIntegrationsFile(filePath: string): Promise<LintFileResult> {
  const absolutePath = resolve(process.cwd(), filePath)

  // Verify the file exists
  try {
    await fs.stat(absolutePath)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      throw new FileResolutionError(`File not found: ${absolutePath}`)
    }
    throw error
  }

  const fileDir = dirname(absolutePath)

  // Loading `.env` mutates `process.env`; restore it afterwards so a lint run is idempotent and
  // doesn't clobber caller-provided env values (see withRestoredEnv).
  return withRestoredEnv(async () => {
    // Load .env file so env: references in integrations can be resolved
    dotenv.config({ path: join(fileDir, DEFAULT_ENV_FILE), quiet: true })

    debug(`Linting integrations file: ${absolutePath}`)
    const parsedIntegrations = await parseIntegrationsFile(absolutePath)

    debug(`Parsed ${parsedIntegrations.integrations.length} integrations, ${parsedIntegrations.issues.length} issues`)

    // Also run env var generation so schema-valid-but-impossible to generate integrations (e.g. invalid
    // BigQuery/Spanner service_account JSON) are caught here too, not just on the .deepnote path.
    const integrationsIssues = [...parsedIntegrations.issues]
    if (parsedIntegrations.integrations.length > 0) {
      const { issues } = generateIntegrationEnvVars(parsedIntegrations.integrations, fileDir)
      integrationsIssues.push(...issues)
    }

    const hasErrors = integrationsIssues.length > 0

    // Integration/config issues are hard errors (no severity field), so report them as errors in
    // `issueCount` (there are no notebook issues on this path) to keep it consistent with `success`
    // and `integrationsFile.issues`.
    return {
      path: absolutePath,
      success: !hasErrors,
      issueCount: { errors: integrationsIssues.length, warnings: 0, total: integrationsIssues.length },
      issues: [],
      integrationsFile: {
        path: absolutePath,
        integrationCount: parsedIntegrations.integrations.length,
        issues: integrationsIssues,
      },
    }
  })
}

function outputLintResult(result: LintFileResult, options: LintOptions): void {
  if (options.output === 'json') {
    outputJson(result)
    return
  }

  const c = getChalk()
  const configIssues = result.integrationsFile.issues
  const hasAnyIssues = result.issues.length > 0 || configIssues.length > 0

  // Show success message if no issues at all
  if (!hasAnyIssues) {
    output(c.green('✓ No issues found'))
    return
  }

  // Show configuration issues from integrations file
  if (configIssues.length > 0) {
    const relPath = relative(process.cwd(), result.integrationsFile.path) || result.integrationsFile.path
    output(c.bold(`Configuration issues in ${c.dim(relPath)}`))
    output('')
    for (const issue of configIssues) {
      output(`  ${c.red('✖')} ${c.red(issue.code)}: ${issue.message}`)
      if (issue.path) {
        output(`    ${c.dim(`at ${issue.path}`)}`)
      }
    }
    output('')
  }

  // Show notebook issues grouped by notebook
  if (result.issues.length > 0) {
    const issuesByNotebook = new Map<string, LintIssue[]>()
    for (const issue of result.issues) {
      const existing = issuesByNotebook.get(issue.notebookName) ?? []
      existing.push(issue)
      issuesByNotebook.set(issue.notebookName, existing)
    }

    for (const [notebookName, issues] of issuesByNotebook) {
      output(c.bold(notebookName))
      output('')
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? c.red('✖') : c.yellow('⚠')
        const color = issue.severity === 'error' ? c.red : c.yellow
        output(`  ${icon} ${color(issue.code)}: ${issue.message}`)
        output(`    ${c.dim(`in ${issue.blockLabel}`)}`)
      }
      output('')
    }
  }

  // Summary. `issueCount.errors` includes configuration issues (they are hard errors), but the text
  // summary reports them separately as "configuration error(s)", so subtract them from the notebook
  // "error(s)" part to avoid double-counting.
  const parts: string[] = []
  const notebookErrors = result.issueCount.errors - configIssues.length
  if (notebookErrors > 0) {
    parts.push(c.red(`${notebookErrors} error${notebookErrors === 1 ? '' : 's'}`))
  }
  if (result.issueCount.warnings > 0) {
    parts.push(c.yellow(`${result.issueCount.warnings} warning${result.issueCount.warnings === 1 ? '' : 's'}`))
  }
  if (configIssues.length > 0) {
    parts.push(c.red(`${configIssues.length} configuration error${configIssues.length === 1 ? '' : 's'}`))
  }

  output(`${c.bold('Summary:')} ${parts.join(', ')}`)
}
