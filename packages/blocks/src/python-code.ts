import { UnsupportedBlockTypeError } from './blocks'
import { createPythonCodeForAgentBlock, isAgentBlock } from './blocks/agent-blocks'
import { createPythonCodeForBigNumberBlock, isBigNumberBlock } from './blocks/big-number-blocks'
import { type ButtonExecutionContext, createPythonCodeForButtonBlock, isButtonBlock } from './blocks/button-blocks'
import { createPythonCodeForCodeBlock, isCodeBlock } from './blocks/code-blocks'
import {
  createPythonCodeForInputCheckboxBlock,
  createPythonCodeForInputDateBlock,
  createPythonCodeForInputDateRangeBlock,
  createPythonCodeForInputFileBlock,
  createPythonCodeForInputSelectBlock,
  createPythonCodeForInputSliderBlock,
  createPythonCodeForInputTextareaBlock,
  createPythonCodeForInputTextBlock,
  isInputCheckboxBlock,
  isInputDateBlock,
  isInputDateRangeBlock,
  isInputFileBlock,
  isInputSelectBlock,
  isInputSliderBlock,
  isInputTextareaBlock,
  isInputTextBlock,
} from './blocks/input-blocks'
import { createPythonCodeForNotebookFunctionBlock, isNotebookFunctionBlock } from './blocks/notebook-function-blocks'
import { createPythonCodeForPivotTableBlock, isPivotTableBlock } from './blocks/pivot-table-blocks'
import { createPythonCodeForSqlBlock, isSqlBlock } from './blocks/sql-blocks'
import { createPythonCodeForVisualizationBlock, isVisualizationBlock } from './blocks/visualization-blocks'
import type { DeepnoteBlock } from './deepnote-file/deepnote-file-schema'

export function createPythonCode(block: DeepnoteBlock, executionContext?: ButtonExecutionContext): string {
  if (isAgentBlock(block)) {
    return createPythonCodeForAgentBlock(block)
  }

  if (isCodeBlock(block)) {
    return createPythonCodeForCodeBlock(block)
  }

  if (isSqlBlock(block)) {
    return createPythonCodeForSqlBlock(block)
  }

  if (isInputTextBlock(block)) {
    return createPythonCodeForInputTextBlock(block)
  }

  if (isInputTextareaBlock(block)) {
    return createPythonCodeForInputTextareaBlock(block)
  }

  if (isInputCheckboxBlock(block)) {
    return createPythonCodeForInputCheckboxBlock(block)
  }

  if (isInputSelectBlock(block)) {
    return createPythonCodeForInputSelectBlock(block)
  }

  if (isInputSliderBlock(block)) {
    return createPythonCodeForInputSliderBlock(block)
  }

  if (isInputFileBlock(block)) {
    return createPythonCodeForInputFileBlock(block)
  }

  if (isInputDateBlock(block)) {
    return createPythonCodeForInputDateBlock(block)
  }

  if (isInputDateRangeBlock(block)) {
    return createPythonCodeForInputDateRangeBlock(block)
  }

  if (isVisualizationBlock(block)) {
    return createPythonCodeForVisualizationBlock(block)
  }

  if (isPivotTableBlock(block)) {
    return createPythonCodeForPivotTableBlock(block)
  }

  if (isButtonBlock(block)) {
    return createPythonCodeForButtonBlock(block, executionContext)
  }

  if (isBigNumberBlock(block)) {
    return createPythonCodeForBigNumberBlock(block)
  }

  if (isNotebookFunctionBlock(block)) {
    return createPythonCodeForNotebookFunctionBlock(block)
  }

  switch (block.type) {
    // Non executable blocks
    case 'markdown':
    case 'image':
    case 'separator':
    case 'text-cell-h1':
    case 'text-cell-h2':
    case 'text-cell-h3':
    case 'text-cell-p':
    case 'text-cell-bullet':
    case 'text-cell-todo':
    case 'text-cell-callout':
      throw new UnsupportedBlockTypeError(`Creating python code from block type ${block.type} is not supported yet.`)
    default:
      block satisfies never
  }

  throw new UnsupportedBlockTypeError(`Unexpected block type encountered`)
}
