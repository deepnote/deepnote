import type { DeepnoteBlock, ImageBlock } from '../deepnote-file/deepnote-file-schema'

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeWidth(width: string): string {
  // Extract only numeric characters
  const numericWidth = width.replace(/[^0-9]/g, '')
  return numericWidth || ''
}

function sanitizeAlignment(alignment: string): string {
  // Only allow specific alignment values
  const validAlignments = ['left', 'center', 'right']
  return validAlignments.includes(alignment.toLowerCase()) ? alignment.toLowerCase() : ''
}

export function createMarkdownForImageBlock(block: ImageBlock): string {
  const src = escapeHtmlAttribute(block.metadata?.deepnote_img_src ?? '')
  const width = sanitizeWidth(block.metadata?.deepnote_img_width ?? '')
  const alignment = sanitizeAlignment(block.metadata?.deepnote_img_alignment ?? '')

  return `<img src="${src}" width="${width}" align="${alignment}" />`
}

export function isImageBlock(block: DeepnoteBlock): block is ImageBlock {
  return block.type === 'image'
}
