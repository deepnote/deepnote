import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { detectDefaultPython, isBareSystemPython, resolvePythonExecutable } from './python-env'

const execFileAsync = promisify(execFile)

/** Environment variable a host (editor, agent harness) can set to publish the interpreter it wants tools to use. */
export const DEEPNOTE_PYTHON_ENV_VAR = 'DEEPNOTE_PYTHON'

/** Name of the sidecar file the Deepnote editor extension writes next to its settings. */
export const IDE_SIDECAR_FILENAME = 'deepnote.json'

/**
 * Editor settings folders the Deepnote extension writes its sidecar into, in lookup order.
 * `.agent` is kept for older skill guidance that named it for Antigravity.
 */
export const IDE_SIDECAR_DIRS = ['.vscode', '.cursor', '.antigravity', '.agent'] as const

/** Virtual environment directory names looked for next to (and above) the notebook. */
export const LOCAL_VENV_DIRS = ['.venv', 'venv'] as const

/** Where a resolved Python came from, in precedence order. */
export type ProjectPythonSource = 'explicit' | 'env' | 'ide' | 'venv' | 'default'

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
  /** Set when `source` is `'venv'`: the virtual environment directory that was picked. */
  venvPath?: string
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
   * Whether to consider a `.venv` / `venv` found from `searchDirs` upward that has deepnote-toolkit
   * installed. Defaults to true.
   */
  localVenv?: boolean
  /** Probe used to check a candidate venv for deepnote-toolkit. Defaults to importing it. */
  hasToolkit?: (pythonPath: string) => Promise<boolean>
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
  'No Deepnote extension environment, DEEPNOTE_PYTHON, or project .venv with deepnote-toolkit was found, so the ' +
  'system Python was used. If deepnote-toolkit is not installed there, either select an environment for this ' +
  'project in the Deepnote extension (it records the venv in .vscode/deepnote.json or .cursor/deepnote.json), ' +
  `set ${DEEPNOTE_PYTHON_ENV_VAR}, create a .venv with deepnote-toolkit next to the notebook, or pass a venv ` +
  'explicitly (--python / pythonPath).'

/**
 * Resolves which Python a project should run with. Precedence:
 *
 * 1. `explicit` (`--python` / `pythonPath`)
 * 2. `DEEPNOTE_PYTHON` env var
 * 3. The Deepnote editor extension's sidecar (`.vscode/deepnote.json` etc.) matched by `projectId`
 * 4. A `.venv` / `venv` found from `searchDirs` upward that has deepnote-toolkit installed
 * 5. `fallback()` (system Python by default)
 *
 * The returned `pythonPath` is a spec, not yet passed through `resolvePythonExecutable`, so
 * callers keep their existing error handling for bad paths.
 */
export async function resolveProjectPython(options: ResolveProjectPythonOptions = {}): Promise<ResolvedProjectPython> {
  const {
    explicit,
    projectId,
    searchDirs = [],
    env = process.env,
    fallback = detectDefaultPython,
    localVenv = true,
    hasToolkit = hasDeepnoteToolkit,
  } = options
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

  if (localVenv && searchDirs.length > 0) {
    const venv = await findLocalVenvPython(searchDirs, warnings, hasToolkit)
    if (venv) {
      return { pythonPath: venv.pythonPath, source: 'venv', venvPath: venv.venvPath, warnings }
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

/**
 * Finds a virtual environment (`.venv` or `venv`) from each of `searchDirs` up to the filesystem
 * root whose interpreter can import deepnote-toolkit. A venv without the toolkit is skipped with a
 * warning, so an unrelated project venv never shadows a system Python that does have it.
 */
export async function findLocalVenvPython(
  searchDirs: string[],
  warnings: string[] = [],
  hasToolkit: (pythonPath: string) => Promise<boolean> = hasDeepnoteToolkit
): Promise<{ pythonPath: string; venvPath: string } | null> {
  for (const dir of directoriesUpward(searchDirs)) {
    for (const venvDir of LOCAL_VENV_DIRS) {
      const venvPath = join(dir, venvDir)
      if (!(await isFile(join(venvPath, 'pyvenv.cfg')))) continue

      let pythonPath: string
      try {
        pythonPath = await resolvePythonExecutable(venvPath)
      } catch {
        continue
      }

      if (await hasToolkit(pythonPath)) {
        return { pythonPath, venvPath }
      }
      warnings.push(
        `Ignoring the virtual environment at ${venvPath}: deepnote-toolkit is not installed there. ` +
          'Install it with pip install "deepnote-toolkit[server]" to run notebooks in that environment.'
      )
    }
  }

  return null
}

/** True when `pythonPath` can import deepnote_toolkit. */
export async function hasDeepnoteToolkit(pythonPath: string): Promise<boolean> {
  try {
    await execFileAsync(pythonPath, ['-c', 'import deepnote_toolkit'], { timeout: 20_000 })
    return true
  } catch {
    return false
  }
}

/** Every `<dir>/<settings-folder>/deepnote.json` from each search dir up to the root, de-duplicated, in order. */
function candidateSidecarPaths(searchDirs: string[]): string[] {
  const candidates: string[] = []
  for (const dir of directoriesUpward(searchDirs)) {
    for (const settingsDir of IDE_SIDECAR_DIRS) {
      candidates.push(join(dir, settingsDir, IDE_SIDECAR_FILENAME))
    }
  }
  return candidates
}

/** Each search dir and its ancestors up to the filesystem root, de-duplicated, in order. */
function directoriesUpward(searchDirs: string[]): string[] {
  const seen = new Set<string>()
  const dirs: string[] = []

  for (const start of searchDirs) {
    let dir = resolve(start)
    while (true) {
      if (!seen.has(dir)) {
        seen.add(dir)
        dirs.push(dir)
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  return dirs
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
