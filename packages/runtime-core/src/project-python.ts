import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { detectDefaultPython, isBareSystemPython, resolvePythonExecutable } from './python-env'

/** Environment variable a host (editor, agent harness) can set to publish the interpreter it wants tools to use. */
export const DEEPNOTE_PYTHON_ENV_VAR = 'DEEPNOTE_PYTHON'

/** Name of the sidecar file the Deepnote editor extension writes next to its settings. */
export const IDE_SIDECAR_FILENAME = 'deepnote.json'

/**
 * Editor settings folders the Deepnote extension writes its sidecar into, in lookup order.
 * `.agent` is kept for older skill guidance that named it for Antigravity.
 */
export const IDE_SIDECAR_DIRS = ['.vscode', '.cursor', '.antigravity', '.agent'] as const

/** Where a resolved Python came from, in precedence order. */
export type ProjectPythonSource = 'explicit' | 'env' | 'ide' | 'default'

export interface IdePythonEnvironment {
  /** Python spec to run with: the venv's interpreter when it exists, otherwise the venv root. */
  pythonPath: string
  /** Sidecar file the mapping was read from. */
  sidecarPath: string
  /** Deepnote extension environment id. */
  environmentId: string
  venvPath: string
}

export interface ResolvedProjectPython {
  /** Python spec accepted by `resolvePythonExecutable` and `RuntimeConfig.pythonEnv`. */
  pythonPath: string
  source: ProjectPythonSource
  /** Set when `source` is `'ide'`. */
  ide?: IdePythonEnvironment
  /** Non-fatal problems found on the way (e.g. a stale sidecar entry). */
  warnings: string[]
  /** Guidance to show when execution fails and the interpreter was only a system default. */
  hint?: string
}

export interface ResolveProjectPythonOptions {
  /** Explicit interpreter from `--python` / `pythonPath`. Always wins. */
  explicit?: string
  /** `project.id` of the `.deepnote` file, used to look up the IDE sidecar mapping. */
  projectId?: string
  /**
   * Directories to search for an IDE sidecar, each walked up to the filesystem root.
   * Usually the `.deepnote` file's directory, plus the working directory or `DEEPNOTE_WORKSPACE`.
   */
  searchDirs?: string[]
  /** Environment to read `DEEPNOTE_PYTHON` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Called when nothing else matched. Defaults to `detectDefaultPython`.
   * Return `undefined` to signal "no opinion" (callers that have their own default).
   */
  fallback?: () => string | undefined
}

interface SidecarEntry {
  environmentId?: unknown
  venvPath?: unknown
  pythonInterpreter?: unknown
}

interface SidecarFile {
  mappings?: Record<string, SidecarEntry>
}

export const BARE_PYTHON_HINT =
  'No Deepnote extension environment or DEEPNOTE_PYTHON was found, so the system Python was used. ' +
  'If deepnote-toolkit is not installed there, either select an environment for this project in the ' +
  'Deepnote extension (it records the venv in .vscode/deepnote.json or .cursor/deepnote.json), ' +
  `set ${DEEPNOTE_PYTHON_ENV_VAR}, or pass a venv explicitly (--python / pythonPath).`

/**
 * Resolves which Python a project should run with. Precedence:
 *
 * 1. `explicit` (`--python` / `pythonPath`)
 * 2. `DEEPNOTE_PYTHON` env var
 * 3. The Deepnote editor extension's sidecar (`.vscode/deepnote.json` etc.) matched by `projectId`
 * 4. `fallback()` (system Python by default)
 *
 * The returned `pythonPath` is a spec, not yet passed through `resolvePythonExecutable`, so
 * callers keep their existing error handling for bad paths.
 */
export async function resolveProjectPython(options: ResolveProjectPythonOptions = {}): Promise<ResolvedProjectPython> {
  const { explicit, projectId, searchDirs = [], env = process.env, fallback = detectDefaultPython } = options
  const warnings: string[] = []

  if (explicit && explicit.trim().length > 0) {
    return { pythonPath: explicit, source: 'explicit', warnings }
  }

  const fromEnv = env[DEEPNOTE_PYTHON_ENV_VAR]
  if (fromEnv && fromEnv.trim().length > 0) {
    return { pythonPath: fromEnv, source: 'env', warnings }
  }

  if (projectId && searchDirs.length > 0) {
    const ide = await findIdePythonEnvironment(projectId, searchDirs, warnings)
    if (ide) {
      return { pythonPath: ide.pythonPath, source: 'ide', ide, warnings }
    }
  }

  const pythonPath = fallback() ?? ''
  const hint = pythonPath === '' || isBareSystemPython(pythonPath) ? BARE_PYTHON_HINT : undefined
  return { pythonPath, source: 'default', warnings, hint }
}

/**
 * Finds the Deepnote extension environment mapped to `projectId` by searching for sidecar files
 * from each of `searchDirs` up to the filesystem root. Returns null when no usable mapping exists;
 * stale mappings (venv deleted) are reported through `warnings` and skipped.
 */
export async function findIdePythonEnvironment(
  projectId: string,
  searchDirs: string[],
  warnings: string[] = []
): Promise<IdePythonEnvironment | null> {
  for (const sidecarPath of candidateSidecarPaths(searchDirs)) {
    const sidecar = await readSidecar(sidecarPath)
    if (!sidecar) continue

    const entry = sidecar.mappings?.[projectId]
    if (!entry || typeof entry !== 'object') continue

    const environmentId = typeof entry.environmentId === 'string' ? entry.environmentId : ''
    const venvPath = typeof entry.venvPath === 'string' ? entry.venvPath : ''
    const interpreter = typeof entry.pythonInterpreter === 'string' ? entry.pythonInterpreter : ''

    if (interpreter && (await isFile(interpreter))) {
      return { pythonPath: interpreter, sidecarPath, environmentId, venvPath }
    }

    if (venvPath) {
      try {
        const resolved = await resolvePythonExecutable(venvPath)
        return { pythonPath: resolved, sidecarPath, environmentId, venvPath }
      } catch {
        // fall through to the warning below
      }
    }

    warnings.push(
      `Ignoring the Deepnote extension environment recorded in ${sidecarPath} for project ${projectId}: ` +
        `no Python found at ${interpreter || venvPath || '(no path recorded)'}. ` +
        'Re-select an environment in the extension to refresh it.'
    )
  }

  return null
}

/** Every `<dir>/<settings-folder>/deepnote.json` from each search dir up to the root, de-duplicated, in order. */
function candidateSidecarPaths(searchDirs: string[]): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const start of searchDirs) {
    let dir = resolve(start)
    while (true) {
      for (const settingsDir of IDE_SIDECAR_DIRS) {
        const candidate = join(dir, settingsDir, IDE_SIDECAR_FILENAME)
        if (!seen.has(candidate)) {
          seen.add(candidate)
          candidates.push(candidate)
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  return candidates
}

async function readSidecar(sidecarPath: string): Promise<SidecarFile | null> {
  let raw: string
  try {
    raw = await readFile(sidecarPath, 'utf-8')
  } catch {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const mappings = Reflect.get(parsed, 'mappings')
    if (typeof mappings !== 'object' || mappings === null) return null
    return { mappings: mappings as Record<string, SidecarEntry> }
  } catch {
    return null
  }
}

async function isFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null)
  return fileStat?.isFile() ?? false
}
