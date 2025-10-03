import type { DeepnoteBlock, ExecutableBlockMetadata } from '../blocks'
import { pythonCode } from '../python-snippets'

export interface VisualizationBlockMetadata extends ExecutableBlockMetadata {
  deepnote_variable_name?: string
  deepnote_visualization_spec?: unknown
  deepnote_chart_filter?: {
    advancedFilters?: unknown[]
  }
}

export interface VisualizationBlock extends DeepnoteBlock {
  content: ''
  metadata: VisualizationBlockMetadata
  type: 'visualization'
}

export function createPythonCodeForVisualizationBlock(block: VisualizationBlock): string {
  const variableName = block.metadata.deepnote_variable_name
  const spec = block.metadata.deepnote_visualization_spec
  const filters = block.metadata.deepnote_chart_filter?.advancedFilters ?? []

  if (!variableName || !spec) {
    return ''
  }

  const BACKSLASH = `\\`
  const escapedVegaLiteSpec = JSON.stringify(spec).replaceAll(`${BACKSLASH}`, `${BACKSLASH}${BACKSLASH}`)

  return pythonCode.executeVisualization(variableName, escapedVegaLiteSpec, JSON.stringify(filters))
}

export function isVisualizationBlock(block: DeepnoteBlock): block is VisualizationBlock {
  return block.type === 'visualization'
}
