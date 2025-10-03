import type { BlockMetadata, DeepnoteBlock } from '../blocks'

export interface SeparatorBlockMetadata extends BlockMetadata {}

export interface SeparatorBlock extends DeepnoteBlock {
  content: ''
  metadata: SeparatorBlockMetadata
  type: 'separator'
}

export function createMarkdownForSeparatorBlock(_block: SeparatorBlock): string {
  return '<hr>'
}

export function isSeparatorBlock(block: DeepnoteBlock): block is SeparatorBlock {
  return block.type === 'separator'
}
