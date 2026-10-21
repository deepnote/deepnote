import type { ChalkInstance } from 'chalk'

export function embeddedApiAccessNote(c: ChalkInstance): string {
  return [
    c.yellow(
      `${c.bold('Note:')} embedded apps call Deepnote with a viewer-scoped token that expires after 15 minutes — never your personal token.`
    ),
    c.dim(
      '  It can read notebook inputs and metadata (no source), start detached runs, and poll the viewer’s own runs.'
    ),
    c.dim('  Notebooks can be in this project or others in the same workspace where the viewer has direct access.'),
    c.dim('  Runs in other projects also require execute permission.'),
    c.dim('  Every other endpoint answers 403. Build for that surface; see `deepnote publish --help`.'),
  ].join('\n')
}
