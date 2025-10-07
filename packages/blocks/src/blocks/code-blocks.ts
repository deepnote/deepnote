import type { DeepnoteBlock, ExecutableBlockMetadata } from '../blocks'

export interface CodeBlockMetadata extends ExecutableBlockMetadata {}

export interface CodeBlock extends DeepnoteBlock {
  content: string
  metadata: CodeBlockMetadata
  type: 'code'
}

export function createPythonCodeForCodeBlock(block: CodeBlock): string {
  return block.content
}

export function isCodeBlock(block: DeepnoteBlock): block is CodeBlock {
  return block.type === 'code'
}
