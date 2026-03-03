import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

/**
 * Resolves the skill directory from the given module directory and executable path.
 *
 * Resolution order:
 * 1. `skills/deepnote/` relative to `dirname` (npm install — skills sit in dist/)
 * 2. `../skills/deepnote/` relative to `execPath` (Bun compiled binary in pypi package)
 * 3. Walk up from `dirname` to find `skills/deepnote/` at repo root (dev/test mode)
 */
export function resolveSkillDir(dirname: string, execPath: string): string {
  const bundledPath = path.join(dirname, 'skills', 'deepnote')
  if (existsSync(path.join(bundledPath, 'SKILL.md'))) {
    return bundledPath
  }

  // In a Bun compiled binary, import.meta.url is frozen at build time, but
  // process.execPath points to the actual binary on disk. The pypi package
  // ships skills at ../skills/deepnote/ relative to the bin/ directory.
  const execBundledPath = path.join(path.dirname(execPath), '..', 'skills', 'deepnote')
  if (existsSync(path.join(execBundledPath, 'SKILL.md'))) {
    return execBundledPath
  }

  let dir = dirname
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'skills', 'deepnote')

    if (existsSync(path.join(candidate, 'SKILL.md'))) {
      return candidate
    }

    const parent = path.dirname(dir)

    if (parent === dir) {
      break
    }

    dir = parent
  }

  return bundledPath
}

/** Returns the absolute path to the bundled skill directory. */
export function getSkillDir(): string {
  return resolveSkillDir(_dirname, process.execPath)
}
