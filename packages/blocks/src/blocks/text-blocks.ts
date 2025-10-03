import type { BlockMetadata, DeepnoteBlock } from '../blocks'

export interface FormatMarks {
  bold?: boolean
  code?: boolean
  // The color accepts any valid CSS color value ('#000000', 'red', 'rgb(2,2,2)').
  color?: string
  italic?: boolean
  strike?: boolean
  underline?: boolean
}

export interface FormattedRangeMarks extends FormatMarks {}

export type FormattedRange = FormattedRangeText | FormattedRangeLink

export interface FormattedRangeLink {
  fromCodePoint: number
  // Ranges are local to the link.
  ranges: FormattedRangeText[]
  toCodePoint: number
  type: 'link'
  url: string
}

export interface FormattedRangeText {
  fromCodePoint: number
  marks: FormattedRangeMarks
  toCodePoint: number
  type?: 'marks'
}

export interface TextBlockMetadata extends BlockMetadata {
  formattedRanges?: FormattedRange[]
  is_collapsed?: boolean
}
export interface MarkdownCellMetadata extends BlockMetadata {
  deepnote_cell_height?: number
}

export interface SeparatorBlockMetadata extends BlockMetadata {}

export interface SeparatorBlock extends DeepnoteBlock {
  metadata: SeparatorBlockMetadata
  source: ''
  type: 'separator'
}

export interface TodoTextBlockMetadata extends TextBlockMetadata {
  checked?: boolean
}

export type CalloutTextBlockColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple'

export interface CalloutTextBlockMetadata extends TextBlockMetadata {
  color?: CalloutTextBlockColor
}

export interface ParagraphTextBlock extends DeepnoteBlock {
  content: string
  metadata: TextBlockMetadata
  type: 'text-cell-p'
}

export type HeadingTextBlockType = 'text-cell-h1' | 'text-cell-h2' | 'text-cell-h3'

export interface Heading1TextBlock extends DeepnoteBlock {
  content: string
  metadata: TextBlockMetadata
  type: 'text-cell-h1'
}

export interface Heading2TextBlock extends DeepnoteBlock {
  content: string
  metadata: TextBlockMetadata
  type: 'text-cell-h2'
}

export interface Heading3TextBlock extends DeepnoteBlock {
  content: string
  metadata: TextBlockMetadata
  type: 'text-cell-h3'
}

export type HeadingTextBlock = Heading1TextBlock | Heading2TextBlock | Heading3TextBlock

export interface BulletTextBlock extends DeepnoteBlock {
  content: string
  metadata: TextBlockMetadata
  type: 'text-cell-bullet'
}

export interface TodoTextBlock extends DeepnoteBlock {
  content: string
  metadata: TodoTextBlockMetadata
  type: 'text-cell-todo'
}

export interface CalloutTextBlockMetadata extends TextBlockMetadata {
  color?: CalloutTextBlockColor
}

export interface CalloutTextBlock extends DeepnoteBlock {
  content: string
  metadata: CalloutTextBlockMetadata
  type: 'text-cell-callout'
}

export type TextBlock = ParagraphTextBlock | HeadingTextBlock | BulletTextBlock | TodoTextBlock | CalloutTextBlock

export function isTextBlock(block: DeepnoteBlock): block is TextBlock {
  const textBlockTypes = [
    'text-cell-p',
    'text-cell-h1',
    'text-cell-h2',
    'text-cell-h3',
    'text-cell-bullet',
    'text-cell-todo',
    'text-cell-callout',
  ]

  return textBlockTypes.includes(block.type.toLowerCase())
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

export function createMarkdownForTextBlock(block: TextBlock): string {
  if (block.type === 'text-cell-h1') {
    return `# ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-h2') {
    return `## ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-h3') {
    return `### ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-bullet') {
    return `- ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-todo') {
    const metadata = block.metadata as TodoTextBlockMetadata
    const checkbox = metadata.checked ? '[x]' : '[ ]'

    return `- ${checkbox} ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-callout') {
    return `> ${escapeMarkdown(block.content)}`
  }

  if (block.type === 'text-cell-p') {
    return escapeMarkdown(block.content)
  }

  throw new Error('Unhandled block type.')
}

export function stripMarkdownFromTextBlock(block: TextBlock): string {
  if (block.type === 'text-cell-h1') {
    return block.content.replace(/^#\s+/, '').trim()
  }

  if (block.type === 'text-cell-h2') {
    return block.content.replace(/^##\s+/, '').trim()
  }

  if (block.type === 'text-cell-h3') {
    // Also handle h4-h6 markdown (all map to h3 in Deepnote)
    return block.content.replace(/^#{3,6}\s+/, '').trim()
  }

  if (block.type === 'text-cell-bullet') {
    return block.content.replace(/^-+\s+/, '').trim()
  }

  if (block.type === 'text-cell-todo') {
    return block.content.replace(/^-+\s+\[.\]\s+/, '').trim()
  }

  if (block.type === 'text-cell-callout') {
    return block.content.replace(/^>\s+/, '').trim()
  }

  if (block.type === 'text-cell-p') {
    return block.content.trim()
  }

  throw new Error('Unhandled block type.')
}
