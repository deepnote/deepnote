import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { resolvePythonExecutable } from '@deepnote/runtime-core'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { checkForIssues, type LintIssue, type LintResult } from '../utils/analysis'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface LintOptions {
  output?: 'json'
  notebook?: string
  python?: string
}

/** Full lint result including file path */
interface LintFileResult extends LintResult {
  path: string
}

/**
 * Creates the lint action - checks for issues in a .deepnote file.
 */
export function createLintAction(_program: Command): (path: string | undefined, options: LintOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Linting: ${path}`)
      const result = await lintFile(path, options)
      outputLintResult(result, options)

      // Exit with error code if there are errors
      if (result.issueCount.errors > 0) {
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

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  debug(`Analyzing blocks...`)
  const pythonInterpreter = options.python ? await resolvePythonExecutable(options.python) : undefined
  const { lint } = await checkForIssues(deepnoteFile, {
    notebook: options.notebook,
    pythonInterpreter,
  })

  return {
    path: absolutePath,
    ...lint,
  }
}

function outputLintResult(result: LintFileResult, options: LintOptions): void {
  if (options.output === 'json') {
    outputJson(result)
    return
  }

  const c = getChalk()

  // Text output
  if (result.issues.length === 0) {
    output(c.green('✓ No issues found'))
    return
  }

  // Group issues by notebook
  const issuesByNotebook = new Map<string, LintIssue[]>()
  for (const issue of result.issues) {
    const existing = issuesByNotebook.get(issue.notebookName) ?? []
    existing.push(issue)
    issuesByNotebook.set(issue.notebookName, existing)
  }

  // Output issues
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

  // Summary
  const parts: string[] = []
  if (result.issueCount.errors > 0) {
    parts.push(c.red(`${result.issueCount.errors} error${result.issueCount.errors === 1 ? '' : 's'}`))
  }
  if (result.issueCount.warnings > 0) {
    parts.push(c.yellow(`${result.issueCount.warnings} warning${result.issueCount.warnings === 1 ? '' : 's'}`))
  }

  output(`${c.bold('Summary:')} ${parts.join(', ')}`)
}
