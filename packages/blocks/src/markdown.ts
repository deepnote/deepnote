import { UnsupportedBlockTypeError } from './blocks'
import { createMarkdownForImageBlock, isImageBlock } from './blocks/image-blocks'
import {
  createMarkdownForSeparatorBlock,
  createMarkdownForTextBlock,
  isSeparatorBlock,
  isTextBlock,
  stripMarkdownFromTextBlock,
} from './blocks/text-blocks'
import type { DeepnoteBlock } from './deepnote-file/deepnote-file-schema'

export function createMarkdown(block: DeepnoteBlock): string {
  if (block.type === 'markdown') {
    return block.content ?? ''
  }

  if (isTextBlock(block)) {
    return createMarkdownForTextBlock(block)
  }

  if (isSeparatorBlock(block)) {
    return createMarkdownForSeparatorBlock(block)
  }

  if (isImageBlock(block)) {
    return createMarkdownForImageBlock(block)
  }

  throw new UnsupportedBlockTypeError(`Creating markdown from block type ${block.type} is not supported yet.`)
}

export function stripMarkdown(block: DeepnoteBlock): string {
  if (isTextBlock(block)) {
    return stripMarkdownFromTextBlock(block)
  }

  throw new UnsupportedBlockTypeError(`Stripping markdown from block type ${block.type} is not supported yet.`)
}
