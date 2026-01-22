import type { DeepnoteBlock } from '@deepnote/runtime-core'

/**
 * Get a human-readable label for a block.
 */
export function getBlockLabel(block: DeepnoteBlock): string {
  // For input blocks, show variable name if available
  if (block.type.startsWith('input-')) {
    const metadata = block.metadata as { deepnote_variable_name?: string } | undefined
    if (metadata?.deepnote_variable_name) {
      return `${block.type} ${block.id} (${metadata.deepnote_variable_name})`
    }
  }

  return `${block.type} (${block.id})`
}
