import { describe, expect, it } from 'vitest'
import { UnsupportedBlockTypeError } from './blocks'
import type {
  CodeBlock,
  ImageBlock,
  SeparatorBlock,
  TextCellBulletBlock,
  TextCellCalloutBlock,
  TextCellH1Block,
  TextCellH2Block,
  TextCellH3Block,
  TextCellPBlock,
  TextCellTodoBlock,
} from './deepnote-file/deepnote-file-schema'
import { createMarkdown, stripMarkdown } from './markdown'

describe('createMarkdown', () => {
  it('returns markdown content as-is for markdown block type', () => {
    const block = {
      id: '123',
      type: 'markdown' as const,
      blockGroup: 'abc',
      content: '# Already Markdown',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('# Already Markdown')
  })

  it('returns empty string when markdown block has undefined content', () => {
    const block = {
      id: '456',
      type: 'markdown' as const,
      blockGroup: 'abc',
      content: undefined,
      metadata: {},
      sortingKey: 'a1',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('')
  })

  it('creates markdown for heading 1 text block', () => {
    const block: TextCellH1Block = {
      id: '123',
      type: 'text-cell-h1',
      content: 'Main Title',
      blockGroup: 'abc',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('# Main Title')
  })

  it('creates markdown for heading 2 text block', () => {
    const block: TextCellH2Block = {
      id: '123',
      type: 'text-cell-h2',
      blockGroup: 'abc',
      content: 'Subtitle',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('## Subtitle')
  })

  it('creates markdown for heading 3 text block', () => {
    const block: TextCellH3Block = {
      id: '123',
      type: 'text-cell-h3',
      blockGroup: 'abc',
      content: 'Section',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('### Section')
  })

  it('creates markdown for bullet text block', () => {
    const block: TextCellBulletBlock = {
      id: '123',
      type: 'text-cell-bullet',
      blockGroup: 'abc',
      content: 'List item',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('- List item')
  })

  it('creates markdown for unchecked todo text block', () => {
    const block: TextCellTodoBlock = {
      id: '123',
      type: 'text-cell-todo',
      blockGroup: 'abc',
      content: 'Task to do',
      metadata: {
        checked: false,
      },
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('- [ ] Task to do')
  })

  it('creates markdown for checked todo text block', () => {
    const block: TextCellTodoBlock = {
      id: '123',
      type: 'text-cell-todo',
      blockGroup: 'abc',
      content: 'Completed task',
      metadata: {
        checked: true,
      },
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('- [x] Completed task')
  })

  it('creates markdown for callout text block', () => {
    const block: TextCellCalloutBlock = {
      id: '123',
      type: 'text-cell-callout',
      blockGroup: 'abc',
      content: 'Important note',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('> Important note')
  })

  it('creates markdown for paragraph text block', () => {
    const block: TextCellPBlock = {
      id: '123',
      type: 'text-cell-p',
      blockGroup: 'abc',
      content: 'Regular paragraph',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = createMarkdown(block)

    expect(result).toEqual('Regular paragraph')
  })

  it('creates markdown for separator block', () => {
    const block: SeparatorBlock = {
      id: '123',
      type: 'separator',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {},
    }

    const result = createMarkdown(block)

    expect(result).toEqual('<hr>')
  })

  it('creates markdown for image block', () => {
    // Using type assertion since the test checks sanitization of arbitrary width values
    const block = {
      id: '123',
      type: 'image' as const,
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_img_src: 'https://example.com/image.png',
        deepnote_img_width: '500',
        deepnote_img_alignment: 'center',
      },
    } as unknown as ImageBlock

    const result = createMarkdown(block)

    expect(result).toEqual('<img src="https://example.com/image.png" width="500" align="center" />')
  })
})

describe('stripMarkdown', () => {
  it('strips markdown from heading 1 text block', () => {
    const block: TextCellH1Block = {
      id: '123',
      type: 'text-cell-h1',
      content: '# Main Title',
      blockGroup: 'abc',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Main Title')
  })

  it('strips markdown from heading 2 text block', () => {
    const block: TextCellH2Block = {
      id: '123',
      type: 'text-cell-h2',
      blockGroup: 'abc',
      content: '## Subtitle',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Subtitle')
  })

  it('strips markdown from heading 3 text block', () => {
    const block: TextCellH3Block = {
      id: '123',
      type: 'text-cell-h3',
      blockGroup: 'abc',
      content: '### Section',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Section')
  })

  it('strips markdown from bullet text block', () => {
    const block: TextCellBulletBlock = {
      id: '123',
      type: 'text-cell-bullet',
      blockGroup: 'abc',
      content: '- List item',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('List item')
  })

  it('strips markdown from todo text block', () => {
    const block: TextCellTodoBlock = {
      id: '123',
      type: 'text-cell-todo',
      blockGroup: 'abc',
      content: '- [x] Task to do',
      metadata: {
        checked: true,
      },
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Task to do')
  })

  it('strips markdown from callout text block', () => {
    const block: TextCellCalloutBlock = {
      id: '123',
      type: 'text-cell-callout',
      blockGroup: 'abc',
      content: '> Important note',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Important note')
  })

  it('strips markdown from paragraph text block', () => {
    const block: TextCellPBlock = {
      id: '123',
      type: 'text-cell-p',
      blockGroup: 'abc',
      content: 'Regular paragraph',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Regular paragraph')
  })

  it('throws UnsupportedBlockTypeError when stripping markdown from unsupported block type', () => {
    const block: SeparatorBlock = {
      id: '123',
      type: 'separator',
      content: '',
      blockGroup: 'abc',
      metadata: {},
      sortingKey: 'a0',
    }

    expect(() => stripMarkdown(block)).toThrow(UnsupportedBlockTypeError)
    expect(() => stripMarkdown(block)).toThrow('Stripping markdown from block type separator is not supported yet.')
  })
})

describe('createMarkdown error handling', () => {
  it('throws UnsupportedBlockTypeError when creating markdown from unsupported block type', () => {
    const block: CodeBlock = {
      id: '123',
      type: 'code',
      content: 'print("hello")',
      blockGroup: 'abc',
      metadata: {},
      sortingKey: 'a0',
      executionCount: 1,
    }

    expect(() => createMarkdown(block)).toThrow(UnsupportedBlockTypeError)
    expect(() => createMarkdown(block)).toThrow('Creating markdown from block type code is not supported yet.')
  })
})
