import { describe, expect, it } from 'vitest'
import type { ImageBlock } from './blocks/image-blocks'
import type { SeparatorBlock } from './blocks/separator-blocks'
import type {
  BulletTextBlock,
  CalloutTextBlock,
  Heading1TextBlock,
  Heading2TextBlock,
  Heading3TextBlock,
  ParagraphTextBlock,
  TodoTextBlock,
} from './blocks/text-blocks'
import { createMarkdown, stripMarkdown } from './markdown'

describe('createMarkdown', () => {
  it('creates markdown for heading 1 text block', () => {
    const block: Heading1TextBlock = {
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
    const block: Heading2TextBlock = {
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
    const block: Heading3TextBlock = {
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
    const block: BulletTextBlock = {
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
    const block: TodoTextBlock = {
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
    const block: TodoTextBlock = {
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
    const block: CalloutTextBlock = {
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
    const block: ParagraphTextBlock = {
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
    const block: ImageBlock = {
      id: '123',
      type: 'image',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        deepnote_img_src: 'https://example.com/image.png',
        deepnote_img_width: '500',
        deepnote_img_alignment: 'center',
      },
    }

    const result = createMarkdown(block)

    expect(result).toEqual('<img src="https://example.com/image.png" width="500" align="center" />')
  })
})

describe('stripMarkdown', () => {
  it('strips markdown from heading 1 text block', () => {
    const block: Heading1TextBlock = {
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
    const block: Heading2TextBlock = {
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
    const block: Heading3TextBlock = {
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
    const block: BulletTextBlock = {
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
    const block: TodoTextBlock = {
      id: '123',
      type: 'text-cell-todo',
      blockGroup: 'abc',
      content: '- [x] Task to do',
      metadata: {},
      sortingKey: 'a0',
    }

    const result = stripMarkdown(block)

    expect(result).toEqual('Task to do')
  })

  it('strips markdown from callout text block', () => {
    const block: CalloutTextBlock = {
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
    const block: ParagraphTextBlock = {
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
})
