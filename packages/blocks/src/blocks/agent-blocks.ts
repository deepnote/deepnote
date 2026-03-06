import type { AgentBlock, DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'

export function isAgentBlock(block: DeepnoteBlock): block is AgentBlock {
  return block.type === 'agent'
}
