import type { BlockMetadata, DeepnoteBlock } from '../blocks'

export interface MarkdownBlockMetadata extends BlockMetadata {
  deepnote_cell_height?: number
}

export interface MarkdownBlock extends DeepnoteBlock {
  content: string
  metadata: MarkdownBlockMetadata
  type: 'markdown'
}

export function createPythonCodeForMarkdownBlock(block: MarkdownBlock): string {
  return block.content
}

export function isMarkdownBlock(block: DeepnoteBlock): block is MarkdownBlock {
  return block.type === 'markdown'
}
