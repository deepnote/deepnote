/**
 * Path planning for `deepnote sync`: maps every cloud project to a deterministic local path,
 * mirroring the workspace folder tree as `<folder path>/<project name>.deepnote`.
 *
 * Names are hostile inputs here. Neither project nor folder names are unique in Deepnote, and both
 * may contain characters no filesystem accepts — so identity always comes from project ids (the
 * sync manifest maps ids to paths), and names are only material for the paths themselves:
 * sanitized per segment, compared case-insensitively (macOS/Windows filesystems are), and
 * disambiguated deterministically when two projects still land on the same file.
 */

/** Windows device names that shadow real files regardless of extension. */
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Characters no cross-platform path segment can contain (plus ASCII control characters). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

const MAX_SEGMENT_LENGTH = 120

/**
 * Make one folder or project name safe to use as a single path segment on macOS, Linux, and
 * Windows. Deterministic: the same name always yields the same segment.
 */
export function sanitizePathSegment(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(ILLEGAL_CHARACTERS, '_')
    .trim()
    // Windows silently strips trailing dots and spaces, which would desync the manifest's idea of
    // the path from what the filesystem actually created.
    .replace(/[. ]+$/, '')
    .slice(0, MAX_SEGMENT_LENGTH)
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return '_'
  }
  if (RESERVED_SEGMENT.test(cleaned)) {
    return `_${cleaned}`
  }
  return cleaned
}

/** The slice of a cloud project that path planning reads. */
export interface PlannableProject {
  id: string
  name: string
  folder?: { path: string[] } | null
}

export interface PlannedProjectPaths {
  /** Root-relative POSIX path of the project's `.deepnote` file, e.g. `Analytics/Sales.deepnote`. */
  deepnotePath: string
  /** Root-relative POSIX path of the directory for `--all-files` downloads. Derived from
   * `deepnotePath` (`.files` instead of `.deepnote`) so the pair can never diverge or collide
   * with a mirrored folder name. */
  filesDir: string
}

function buildPath(project: PlannableProject, fileName: string): string {
  const folderSegments = (project.folder?.path ?? []).map(sanitizePathSegment)
  return [...folderSegments, fileName].join('/')
}

/**
 * Plan a local path for every project, resolving collisions deterministically.
 *
 * Collisions are real: project names are not unique, folder names are not unique (two distinct
 * cloud folders with equal names merge into one local directory), and sanitizing can conflate
 * names that differed only in illegal characters. Any group of projects whose planned paths match
 * case-insensitively gets ` (<first 8 chars of id>)` appended to each file name — every member,
 * so a newly created project can never silently steal an existing project's clean path. In the
 * astronomically unlikely case that short ids collide too, the full id is used.
 *
 * The same input always produces the same plan, so repeated syncs are stable.
 */
export function planProjectPaths(projects: readonly PlannableProject[]): Map<string, PlannedProjectPaths> {
  const withSuffix = (project: PlannableProject, suffix: string | null): string =>
    buildPath(project, `${sanitizePathSegment(suffix ? `${project.name} (${suffix})` : project.name)}.deepnote`)

  const attempts: Array<(project: PlannableProject) => string> = [
    project => withSuffix(project, null),
    project => withSuffix(project, project.id.slice(0, 8)),
    project => withSuffix(project, project.id),
  ]

  const planned = new Map<string, string>()
  let remaining = [...projects].sort((a, b) => a.id.localeCompare(b.id))

  for (const attempt of attempts) {
    const byKey = new Map<string, PlannableProject[]>()
    for (const project of remaining) {
      const key = attempt(project).toLowerCase()
      byKey.set(key, [...(byKey.get(key) ?? []), project])
    }

    // Paths already fixed in an earlier round are taken; colliding with one forces the next round.
    const taken = new Set([...planned.values()].map(p => p.toLowerCase()))
    const unresolved: PlannableProject[] = []
    for (const [key, group] of byKey) {
      if (group.length === 1 && !taken.has(key)) {
        planned.set(group[0].id, attempt(group[0]))
      } else {
        unresolved.push(...group)
      }
    }
    remaining = unresolved
    if (remaining.length === 0) {
      break
    }
  }

  // Project ids are unique, so the full-id round always resolves; this is unreachable in practice.
  for (const project of remaining) {
    planned.set(project.id, withSuffix(project, project.id))
  }

  return new Map(
    [...planned.entries()].map(([id, deepnotePath]) => [
      id,
      { deepnotePath, filesDir: deepnotePath.replace(/\.deepnote$/, '.files') },
    ])
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
