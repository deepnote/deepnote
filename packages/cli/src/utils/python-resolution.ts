import { dirname } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import {
  detectDefaultPython,
  type ResolvedProjectPython,
  resolveProjectPython,
  resolvePythonExecutable,
} from '@deepnote/runtime-core'
import { debug, getChalk, log } from '../output'

/**
 * Directories the CLI searches for the Deepnote extension's `deepnote.json` sidecar:
 * the notebook file's directory first, then any extra roots (working directory, `DEEPNOTE_WORKSPACE`).
 * Each is walked up to the filesystem root by the resolver.
 */
export function projectPythonSearchDirs(filePath: string, ...extraRoots: Array<string | undefined>): string[] {
  const dirs = [dirname(filePath), process.env.DEEPNOTE_WORKSPACE, ...extraRoots]
  return dirs.filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
}

/** Prints resolver warnings and, in human mode, tells the user which non-default interpreter was picked. */
export function reportPythonResolution(resolution: ResolvedProjectPython, isMachineOutput: boolean): void {
  for (const warning of resolution.warnings) {
    if (isMachineOutput) {
      debug(warning)
    } else {
      log(getChalk().yellow(`Warning: ${warning}`))
    }
  }

  debug(`Python: ${resolution.pythonPath || '(analyzer default)'} (source: ${resolution.source})`)

  if (isMachineOutput) {
    return
  }
  if (resolution.source === 'ide' && resolution.ide) {
    const label = resolution.ide.environmentId ? ` ${resolution.ide.environmentId}` : ''
    log(getChalk().dim(`Using the Deepnote extension environment${label}: ${resolution.pythonPath}`))
  } else if (resolution.source === 'env') {
    log(getChalk().dim(`Using Python from DEEPNOTE_PYTHON: ${resolution.pythonPath}`))
  } else if (resolution.source === 'explicit') {
    log(getChalk().dim(`Using Python from --python: ${resolution.pythonPath}`))
  }
}

export interface RunPython {
  /** Resolved Python executable to start the toolkit server with. */
  pythonEnv: string
  /** Guidance to append to a server start failure when only the system default was available. */
  hint?: string
}

/**
 * Resolves the interpreter for `deepnote run`: `--python`, then `DEEPNOTE_PYTHON`, then the
 * Deepnote extension environment mapped to this project, then the system Python.
 */
export async function resolveRunPython(
  file: DeepnoteFile,
  filePath: string,
  explicit: string | undefined,
  options: { workingDirectory?: string; isMachineOutput: boolean }
): Promise<RunPython> {
  const resolution = await resolveProjectPython({
    explicit,
    projectId: file.project.id,
    searchDirs: projectPythonSearchDirs(filePath, options.workingDirectory),
    fallback: detectDefaultPython,
  })
  reportPythonResolution(resolution, options.isMachineOutput)

  return { pythonEnv: await resolvePythonExecutable(resolution.pythonPath), hint: resolution.hint }
}

/**
 * Resolves the interpreter for analysis commands (`analyze`, `lint`, `dag`). Returns `undefined`
 * when nothing is configured so the analyzer keeps using its own default.
 */
export async function resolveAnalysisPython(
  file: DeepnoteFile,
  filePath: string,
  explicit: string | undefined,
  options: { isMachineOutput: boolean }
): Promise<string | undefined> {
  const resolution = await resolveProjectPython({
    explicit,
    projectId: file.project.id,
    searchDirs: projectPythonSearchDirs(filePath),
    fallback: () => undefined,
  })
  reportPythonResolution(resolution, options.isMachineOutput)

  if (resolution.source === 'default') {
    return undefined
  }
  return resolvePythonExecutable(resolution.pythonPath)
}
