import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const _dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : // @ts-expect-error: Safe ESM fallback; import.meta.url is only evaluated in ESM where __dirname is undefined.
      path.dirname(fileURLToPath(import.meta.url))

/**
 * Returns the absolute path to the skill directory.
 *
 * In built mode, skills are at `dist/skills/deepnote/` (copied by tsdown onSuccess).
 * In dev/test mode, skills are at `skills/deepnote/` at the repo root.
 * We resolve by walking up from the current directory until we find the skill files.
 */
export function getSkillDir(): string {
  // Try bundled path first (dist/skills/deepnote)
  const bundledPath = path.join(_dirname, 'skills', 'deepnote')
  if (existsSync(path.join(bundledPath, 'SKILL.md'))) {
    return bundledPath
  }

  // Walk up to find skills/deepnote at repo root (dev/test mode)
  let dir = _dirname

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

  // Fallback to bundled path (will fail with a clear error in the caller)
  return bundledPath
}
