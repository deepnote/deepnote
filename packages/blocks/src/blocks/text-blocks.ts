import type {
  DeepnoteBlock,
  SeparatorBlock,
  TextCellBulletBlock,
  TextCellCalloutBlock,
  TextCellH1Block,
  TextCellH2Block,
  TextCellH3Block,
  TextCellPBlock,
  TextCellTodoBlock,
} from '../deserialize-file/deepnote-file-schema'

type TextBlock =
  | TextCellPBlock
  | TextCellH1Block
  | TextCellH2Block
  | TextCellH3Block
  | TextCellBulletBlock
  | TextCellTodoBlock
  | TextCellCalloutBlock

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

export interface TextBlockMetadata {
  formattedRanges?: FormattedRange[]
  is_collapsed?: boolean
}
export interface MarkdownCellMetadata {
  deepnote_cell_height?: number
}

export type SeparatorBlockMetadata = object

export interface TodoTextBlockMetadata extends TextBlockMetadata {
  checked?: boolean
}

export type CalloutTextBlockColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple'

export interface CalloutTextBlockMetadata extends TextBlockMetadata {
  color?: CalloutTextBlockColor
}

export type HeadingTextBlockType = 'text-cell-h1' | 'text-cell-h2' | 'text-cell-h3'

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
  const content = block.content ?? ''

  if (block.type === 'text-cell-h1') {
    return `# ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-h2') {
    return `## ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-h3') {
    return `### ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-bullet') {
    return `- ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-todo') {
    const metadata = block.metadata as TodoTextBlockMetadata
    const checkbox = metadata?.checked ? '[x]' : '[ ]'

    return `- ${checkbox} ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-callout') {
    return `> ${escapeMarkdown(content)}`
  }

  if (block.type === 'text-cell-p') {
    return escapeMarkdown(content)
  }

  throw new Error('Unhandled block type.')
}

export function stripMarkdownFromTextBlock(block: TextBlock): string {
  const content = block.content ?? ''

  if (block.type === 'text-cell-h1') {
    return content.replace(/^#\s+/, '').trim()
  }

  if (block.type === 'text-cell-h2') {
    return content.replace(/^##\s+/, '').trim()
  }

  if (block.type === 'text-cell-h3') {
    // Also handle h4-h6 markdown (all map to h3 in Deepnote)
    return content.replace(/^#{3,6}\s+/, '').trim()
  }

  if (block.type === 'text-cell-bullet') {
    return content.replace(/^-+\s+/, '').trim()
  }

  if (block.type === 'text-cell-todo') {
    return content.replace(/^-+\s+\[.\]\s+/, '').trim()
  }

  if (block.type === 'text-cell-callout') {
    return content.replace(/^>\s+/, '').trim()
  }

  if (block.type === 'text-cell-p') {
    return content.trim()
  }

  throw new Error('Unhandled block type.')
}

export function createMarkdownForSeparatorBlock(_block: SeparatorBlock): string {
  return '<hr>'
}

export function isSeparatorBlock(block: DeepnoteBlock): block is SeparatorBlock {
  return block.type === 'separator'
}
