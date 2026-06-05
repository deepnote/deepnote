import type { ButtonBlock, DeepnoteBlock } from '../deepnote-file/deepnote-file-schema'
import { pythonCode } from '../python-snippets'
import { sanitizePythonVariableName } from './python-utils'

export interface ButtonExecutionContext {
  /**
   * If set, button blocks with this variable name that are being executed
   * will resolve their source code to set the variable to True, False otherwise.
   */
  variableContext?: string[]
}

export function createPythonCodeForButtonBlock(block: ButtonBlock, executionContext?: ButtonExecutionContext): string {
  if (block.metadata?.deepnote_button_behavior === 'set_variable' && block.metadata?.deepnote_variable_name) {
    const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
    // The button resolve the code to True if the code is executed after that button was clicked
    if (executionContext?.variableContext?.includes(sanitizedPythonVariableName)) {
      return pythonCode.setVariableContextValue(sanitizedPythonVariableName, true)
    }
    return pythonCode.setVariableContextValue(sanitizedPythonVariableName, false)
  }
  // Fallback for older button blocks, which did not have the variable name metadata field,
  // or have the button behavior set to 'run'
  return ''
}

export function isButtonBlock(block: DeepnoteBlock): block is ButtonBlock {
  return block.type === 'button'
}
