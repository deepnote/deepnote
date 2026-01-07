import type { ExecutableBlockMetadata } from '../blocks'
import type { DeepnoteBlock, VisualizationBlock } from '../deserialize-file/deepnote-file-schema'
import { pythonCode } from '../python-snippets'
import { sanitizePythonVariableName } from './python-utils'

export interface VisualizationBlockMetadata extends ExecutableBlockMetadata {
  deepnote_variable_name?: string
  deepnote_visualization_spec?: unknown
  deepnote_chart_filter?: {
    advancedFilters?: unknown[]
  }
}

export function createPythonCodeForVisualizationBlock(block: VisualizationBlock): string {
  const variableName = block.metadata?.deepnote_variable_name
  const spec = block.metadata?.deepnote_visualization_spec
  const filters = block.metadata?.deepnote_chart_filter?.advancedFilters ?? []

  if (!variableName || !spec) {
    return ''
  }

  const sanitizedVariableName = sanitizePythonVariableName(variableName)
  return pythonCode.executeVisualization(sanitizedVariableName, JSON.stringify(spec), JSON.stringify(filters))
}

export function isVisualizationBlock(block: DeepnoteBlock): block is VisualizationBlock {
  return block.type === 'visualization'
}
