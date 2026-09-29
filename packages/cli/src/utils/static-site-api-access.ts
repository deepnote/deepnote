import type { ChalkInstance } from 'chalk'

export function embeddedApiAccessNote(c: ChalkInstance): string {
  return [
    c.yellow(
      `${c.bold('Note:')} embedded apps call Deepnote with a viewer-scoped token that expires after 15 minutes — never your personal token.`
    ),
    c.dim(
      '  It covers one run loop: read the configured notebook (no block source), start a detached run, poll that run.'
    ),
    c.dim('  Every other endpoint answers 403. Build for that surface; see `deepnote publish --help`.'),
  ].join('\n')
}
