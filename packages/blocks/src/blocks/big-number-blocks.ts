import type { BigNumberBlock, DeepnoteBlock } from '../deserialize-file/deepnote-file-schema'
import { pythonCode } from '../python-snippets'

export function createPythonCodeForBigNumberBlock(block: BigNumberBlock): string {
  return pythonCode.executeBigNumber(
    block.metadata.deepnote_big_number_title ?? '',
    block.metadata.deepnote_big_number_value ?? '',
    block.metadata.deepnote_big_number_comparison_title,
    block.metadata.deepnote_big_number_comparison_value
  )
}

export function isBigNumberBlock(block: DeepnoteBlock): block is BigNumberBlock {
  return block.type === 'big-number'
}
