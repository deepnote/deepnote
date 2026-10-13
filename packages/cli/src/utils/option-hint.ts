import type { OptionHint } from '@deepnote/cloud-sync'

/** The command-line flag that sets the library option a hint names. */
export function cliFlagFor(hint: OptionHint): string {
  switch (hint.option) {
    case 'syncRoot':
      return '--no-sync-root'
    case 'prune':
      return '--prune'
    default:
      return hint satisfies never
  }
}
