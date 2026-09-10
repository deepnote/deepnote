import { dedent } from 'ts-dedent'

import type { CodeBlock, DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'
import { createDataFrameConfig } from './data-frame'

export function createPythonCodeForCodeBlock(block: CodeBlock): string {
  // IPython only recognizes a cell magic (`%%bash`, `%%time`, ...) when it is on the
  // first line of the cell, so the DataFrame config cannot be prepended in that case.
  // The config would be meaningless there anyway: the cell body is not Python.
  if (startsWithCellMagic(block.content)) {
    return block.content
  }

  const dataFrameConfig = createDataFrameConfig(block)

  return dedent`
    ${dataFrameConfig}

    ${block.content}
  `
}

export function isCodeBlock(block: DeepnoteBlock): block is CodeBlock {
  return block.type === 'code'
}

function startsWithCellMagic(content: string | undefined): content is string {
  return content?.trimStart().startsWith('%%') ?? false
}
