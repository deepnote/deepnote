import { dedent } from 'ts-dedent'

import type { ExecutableBlockMetadata } from '../blocks'
import type { CodeBlock, DeepnoteBlock } from '../deserialize-file/deepnote-file-schema'
import { createDataFrameConfig } from './data-frame'
import type { TableState } from './table-state'

export interface CodeBlockMetadata extends ExecutableBlockMetadata {
  deepnote_table_state?: TableState
}

export function createPythonCodeForCodeBlock(block: CodeBlock): string {
  const dataFrameConfig = createDataFrameConfig(block)

  return dedent`
    ${dataFrameConfig}

    ${block.content}
  `
}

export function isCodeBlock(block: DeepnoteBlock): block is CodeBlock {
  return block.type === 'code'
}
