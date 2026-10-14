import type { OptionHint } from '@deepnote/cloud-sync'

const CLI_FLAGS = {
  syncRoot: '--no-sync-root',
  prune: '--prune',
} as const satisfies Record<OptionHint['option'], string>

export type CliFlag<O extends OptionHint['option']> = (typeof CLI_FLAGS)[O]

/** The command-line flag that sets the library option a hint names. */
export function cliFlagFor<O extends OptionHint['option']>(hint: OptionHint & { option: O }): CliFlag<O> {
  return CLI_FLAGS[hint.option]
}
