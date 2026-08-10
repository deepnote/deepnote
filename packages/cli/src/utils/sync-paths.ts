/**
 * Path planning for `deepnote sync`: maps every cloud project to a deterministic local directory,
 * mirroring the workspace folder tree as `<folder path>/<project name>/`. The project export is a
 * ZIP of one `.deepnote` document per notebook, so a project is a directory of notebook files (the
 * filenames come from the export), not a single file.
 *
 * Names are hostile inputs here. Neither project nor folder names are unique in Deepnote, and both
 * may contain characters no filesystem accepts — so identity always comes from project ids (the
 * sync manifest maps ids to directories), and names are only material for the paths themselves:
 * sanitized per segment, compared case-insensitively (macOS/Windows filesystems are), and
 * disambiguated deterministically when project directories overlap.
 */

/** Windows device names that shadow real files regardless of extension. */
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Characters no cross-platform path segment can contain (plus ASCII control characters). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

const MAX_SEGMENT_LENGTH = 120

/** User-provided names cannot sanitize to this leading-dot segment. */
const INCOMPLETE_FOLDER_NAMESPACE = '.deepnote-incomplete'

/**
 * Make one folder or project name safe to use as a single path segment on macOS, Linux, and
 * Windows. Deterministic: the same name always yields the same segment.
 */
export function sanitizePathSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(ILLEGAL_CHARACTERS, '_')
    .trim()
    // Truncate first, then strip: slicing last could re-expose a trailing dot or space, which
    // Windows silently drops — desyncing the manifest's idea of the path from what was created.
    .slice(0, MAX_SEGMENT_LENGTH)
    .replace(/[. ]+$/, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return '_'
  }
  if (cleaned.startsWith('.')) {
    return `_${cleaned.slice(0, MAX_SEGMENT_LENGTH - 1)}`
  }
  if (RESERVED_SEGMENT.test(cleaned)) {
    return `_${cleaned}`
  }
  return cleaned
}

/** One segment of a folder's root-to-leaf path, as the projects API reports it. Only `name` is used
 * for paths; `id` is the folder's stable identity (names are not unique). */
export interface FolderPathSegment {
  name: string
}

/** The slice of a cloud project that path planning reads. */
export interface PlannableProject {
  id: string
  name: string
  folder?: { id: string; path: FolderPathSegment[]; isPathComplete?: boolean } | null
}

export interface PlannedProjectPaths {
  /** Root-relative POSIX path of the project's directory, e.g. `Analytics/Sales report`. Holds one
   * `.deepnote` file per notebook (filenames come from the export) plus the `.files` directory. */
  projectDir: string
  /** Root-relative POSIX path of the directory for `--all-files` downloads — always
   * `<projectDir>/.files`, so it lives beside the notebook files and moves with the project. */
  filesDir: string
}

function buildDir(project: PlannableProject, dirName: string): string {
  const folderSegments = (project.folder?.path ?? []).map(segment => sanitizePathSegment(segment.name))
  const incompletePrefix =
    project.folder?.isPathComplete === false
      ? [INCOMPLETE_FOLDER_NAMESPACE, sanitizePathSegment(project.folder.id)]
      : []
  return [...incompletePrefix, ...folderSegments, dirName].join('/')
}

function pathsOverlap(left: string, right: string): boolean {
  const leftKey = left.toLowerCase()
  const rightKey = right.toLowerCase()
  return leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`)
}

function appendPathSuffix(name: string, suffix: string): string {
  const safeSuffix = sanitizePathSegment(suffix).slice(0, MAX_SEGMENT_LENGTH - 4)
  const suffixText = ` (${safeSuffix})`
  const base = sanitizePathSegment(name)
    .slice(0, MAX_SEGMENT_LENGTH - suffixText.length)
    .replace(/[. ]+$/, '')
  return `${base || '_'}${suffixText}`
}

/**
 * Plan a local directory for every project, resolving collisions deterministically.
 *
 * Collisions are real: project names are not unique, folder names are not unique (two distinct
 * cloud folders with equal names merge into one local directory), and sanitizing can conflate
 * names that differed only in illegal characters. Any group of projects whose planned directories
 * match or contain one another case-insensitively gets ` (<first 8 chars of id>)` appended to each
 * directory name — every member, so recursive moves and deletes can never affect another project.
 * In the astronomically unlikely case that short ids collide too, the full id is used.
 *
 * The same input always produces the same plan, so repeated syncs are stable.
 */
export function planProjectPaths(projects: readonly PlannableProject[]): Map<string, PlannedProjectPaths> {
  const withSuffix = (project: PlannableProject, suffix: string | null): string =>
    buildDir(project, suffix ? appendPathSuffix(project.name, suffix) : sanitizePathSegment(project.name))

  const attempts: Array<(project: PlannableProject) => string> = [
    project => withSuffix(project, null),
    project => withSuffix(project, project.id.slice(0, 8)),
    project => withSuffix(project, project.id),
  ]

  const planned = new Map<string, string>()
  let remaining = [...projects].sort((a, b) => a.id.localeCompare(b.id))

  for (const attempt of attempts) {
    const candidates = remaining.map(project => ({ project, path: attempt(project) }))
    const conflicting = new Set<string>()
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]
      if ([...planned.values()].some(existing => pathsOverlap(candidate.path, existing))) {
        conflicting.add(candidate.project.id)
      }
      for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex++) {
        const other = candidates[otherIndex]
        if (pathsOverlap(candidate.path, other.path)) {
          conflicting.add(candidate.project.id)
          conflicting.add(other.project.id)
        }
      }
    }

    remaining = []
    for (const candidate of candidates) {
      if (conflicting.has(candidate.project.id)) {
        remaining.push(candidate.project)
      } else {
        planned.set(candidate.project.id, candidate.path)
      }
    }
    if (remaining.length === 0) {
      break
    }
  }

  // Project ids are unique, so the full-id round always resolves; this is unreachable in practice.
  for (const project of remaining) {
    planned.set(project.id, withSuffix(project, project.id))
  }

  // Fail safely if hostile names somehow exhaust every suffix round.
  const plannedEntries = [...planned.entries()]
  for (let index = 0; index < plannedEntries.length; index++) {
    for (let otherIndex = index + 1; otherIndex < plannedEntries.length; otherIndex++) {
      if (pathsOverlap(plannedEntries[index][1], plannedEntries[otherIndex][1])) {
        throw new Error('Unable to plan disjoint local directories for every project')
      }
    }
  }

  return new Map(
    [...planned.entries()].map(([id, projectDir]) => [id, { projectDir, filesDir: `${projectDir}/.files` }])
  )
}

/**
 * True when an inventory path from the cloud is safe to join under a local directory: relative,
 * with no empty, `.`, or `..` segments. Cloud file paths are used verbatim (they must round-trip),
 * so this is a safety check, not a sanitizer — an unsafe path is skipped and reported, never
 * rewritten.
 */
export function isSafeRelativeFilePath(filePath: string): boolean {
  if (filePath.startsWith('/') || filePath.includes('\\')) {
    return false
  }
  const segments = filePath.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}
