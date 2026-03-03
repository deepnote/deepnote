import type { DeepnoteBlock, LlmBlock } from '../deepnote-file/deepnote-file-schema'

export function isLlmBlock(block: DeepnoteBlock): block is LlmBlock {
  return block.type === 'llm'
}
