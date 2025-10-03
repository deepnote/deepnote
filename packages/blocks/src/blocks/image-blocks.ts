import type { BlockMetadata, DeepnoteBlock } from '../blocks'

export interface ImageBlockMetadata extends BlockMetadata {
  deepnote_img_src?: string
  deepnote_img_width?: string
  deepnote_img_alignment?: string
}

export interface ImageBlock extends DeepnoteBlock {
  content: ''
  metadata: ImageBlockMetadata
  type: 'image'
}

export function createMarkdownForImageBlock(block: ImageBlock): string {
  const src = block.metadata.deepnote_img_src ?? ''
  const width = block.metadata.deepnote_img_width ?? ''
  const alignment = block.metadata.deepnote_img_alignment ?? ''

  return `<img src="${src}" width="${width}" align="${alignment}" />`
}

export function isImageBlock(block: DeepnoteBlock): block is ImageBlock {
  return block.type === 'image'
}
