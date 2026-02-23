import fs from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { getEnvironmentVariablesForIntegrations } from '@deepnote/database-integrations'
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
  debug(`Loading integrations from: ${integrationsFilePath}`)
  const parsedIntegrations = await parseIntegrationsFile(integrationsFilePath)

  debug(`Parsed ${parsedIntegrations.integrations.length} integrations, ${parsedIntegrations.issues.length} issues`)

  // Inject integration env vars into process.env so checkMissingIntegrations works correctly
  if (parsedIntegrations.integrations.length > 0) {
    const { envVars, errors } = getEnvironmentVariablesForIntegrations(parsedIntegrations.integrations, {
      projectRootDirectory: fileDir,
    })
    for (const err of errors) {
      debug(`Integration env var error: ${err.message}`)
    }
    for (const { name, value } of envVars) {
      process.env[name] = value
    }
    debug(`Injected ${envVars.length} environment variables for ${parsedIntegrations.integrations.length} integrations`)
  }

  debug(`Analyzing blocks...`)
  const { lint } = await checkForIssues(deepnoteFile, {
    notebook: options.notebook,
    pythonInterpreter: options.python,
  })

  return {
    path: absolutePath,
    ...lint,
    integrationsFile: {
      path: integrationsFilePath,
      integrationCount: parsedIntegrations.integrations.length,
      issues: parsedIntegrations.issues,
    },
  }
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

  // Load .env file so env: references in integrations can be resolved
  dotenv.config({ path: join(fileDir, DEFAULT_ENV_FILE), quiet: true })

  debug(`Linting integrations file: ${absolutePath}`)
  const parsedIntegrations = await parseIntegrationsFile(absolutePath)

  debug(`Parsed ${parsedIntegrations.integrations.length} integrations, ${parsedIntegrations.issues.length} issues`)

  const hasErrors = parsedIntegrations.issues.length > 0

  return {
    path: absolutePath,
    success: !hasErrors,
    issueCount: { errors: 0, warnings: 0, total: 0 },
    issues: [],
    integrationsFile: {
      path: absolutePath,
      integrationCount: parsedIntegrations.integrations.length,
      issues: parsedIntegrations.issues,
    },
  }
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

  // Summary
  const parts: string[] = []
  if (result.issueCount.errors > 0) {
    parts.push(c.red(`${result.issueCount.errors} error${result.issueCount.errors === 1 ? '' : 's'}`))
  }
  if (result.issueCount.warnings > 0) {
    parts.push(c.yellow(`${result.issueCount.warnings} warning${result.issueCount.warnings === 1 ? '' : 's'}`))
  }
  if (configIssues.length > 0) {
    parts.push(c.red(`${configIssues.length} configuration error${configIssues.length === 1 ? '' : 's'}`))
  }

  output(`${c.bold('Summary:')} ${parts.join(', ')}`)
}
