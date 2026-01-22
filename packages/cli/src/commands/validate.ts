import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deepnoteFileSchema, parseYaml } from '@deepnote/blocks'
import type { Command } from 'commander'
import type { ZodIssue } from 'zod'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface ValidateOptions {
  json?: boolean
}

export interface ValidationIssue {
  path: string
  message: string
  code: string
}

export interface ValidationResult {
  success: true
  path: string
  valid: boolean
  issues: ValidationIssue[]
}

export interface ValidationError {
  success: false
  error: string
}

/**
 * Error thrown when validation has been handled and the process should exit.
 * This prevents the outer catch block from double-outputting errors.
 */
class ValidationHandledError extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super('Validation handled')
    this.name = 'ValidationHandledError'
    this.exitCode = exitCode
  }
}

export function createValidateAction(
  _program: Command
): (path: string | undefined, options: ValidateOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Validating file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await validateDeepnoteFile(path, options)
    } catch (error) {
      // If validation was already handled (output already produced), just exit
      if (error instanceof ValidationHandledError) {
        process.exit(error.exitCode)
      }
      const message = error instanceof Error ? error.message : String(error)
      // Use InvalidUsage for file resolution errors (user input), Error for runtime failures
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      if (options.json) {
        outputJson({ success: false, error: message } satisfies ValidationError)
      } else {
        logError(message)
      }
      process.exit(exitCode)
    }
  }
}

async function validateDeepnoteFile(path: string | undefined, options: ValidateOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing YAML...')
  let parsed: unknown
  try {
    parsed = parseYaml(yamlContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) {
      outputJson({
        success: true,
        path: absolutePath,
        valid: false,
        issues: [{ path: '', message: `Invalid YAML: ${message}`, code: 'yaml_parse_error' }],
      } satisfies ValidationResult)
    } else {
      logError(`Invalid YAML: ${message}`)
    }
    throw new ValidationHandledError(ExitCode.Error)
  }

  debug('Validating against schema...')
  const result = deepnoteFileSchema.safeParse(parsed)

  if (result.success) {
    if (options.json) {
      outputJson({
        success: true,
        path: absolutePath,
        valid: true,
        issues: [],
      } satisfies ValidationResult)
    } else {
      const chalk = getChalk()
      output(`${chalk.green('✓')} ${absolutePath} is valid`)
    }
    return
  }

  // Validation failed - format the errors
  const issues = formatZodErrors(result.error)

  if (options.json) {
    outputJson({
      success: true,
      path: absolutePath,
      valid: false,
      issues,
    } satisfies ValidationResult)
  } else {
    const chalk = getChalk()
    output(`${chalk.red('✗')} ${absolutePath} is invalid`)
    output('')
    output(`${chalk.bold('Validation errors:')}`)
    for (const issue of issues) {
      const pathStr = issue.path ? chalk.dim(`${issue.path}: `) : ''
      output(`  ${chalk.red('•')} ${pathStr}${issue.message}`)
    }
  }

  throw new ValidationHandledError(ExitCode.Error)
}

/**
 * Format Zod validation errors into a more readable structure.
 */
function formatZodErrors(error: { issues: ZodIssue[] }): ValidationIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}
