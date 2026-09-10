import { dedent } from 'ts-dedent'

import type { CodeBlock, DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'
import { createDataFrameConfig } from './data-frame'

export function createPythonCodeForCodeBlock(block: CodeBlock): string {
  // IPython only recognizes a cell magic (`%%bash`, `%%time`, ...) when it is on the
  // first non-blank line of the cell, at column zero. Prepending the DataFrame config
  // would push it down and make IPython parse the cell as Python, so emit the content
  // as-is. The config would be meaningless there anyway: the cell body is not Python.
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
  // Mirrors IPython's input cleanup: leading blank lines are dropped, but indentation
  // before `%%` is not reliably stripped, so it must sit at column zero.
  const firstNonBlankLine = content?.split('\n').find(line => line.trim() !== '')

  return firstNonBlankLine?.startsWith('%%') ?? false
}
