import { dedent } from 'ts-dedent'

import type { DeepnoteBlock, NotebookFunctionBlock } from '../deserialize-file/deepnote-file-schema'

export function isNotebookFunctionBlock(block: DeepnoteBlock): block is NotebookFunctionBlock {
  return block.type === 'notebook-function'
}

interface ExportMapping {
  enabled: boolean
  variable_name: string
}

export function createPythonCodeForNotebookFunctionBlock(block: NotebookFunctionBlock): string {
  const notebookId = block.metadata?.function_notebook_id
  const inputs = block.metadata?.function_notebook_inputs ?? {}
  const exportMappings = (block.metadata?.function_notebook_export_mappings ?? {}) as Record<string, ExportMapping>

  // Handle unconfigured blocks (no notebook_id set)
  if (!notebookId) {
    return dedent`
      # Notebook Function: Not configured
      pass
    `
  }

  // Filter to only enabled exports
  const enabledExports = Object.entries(exportMappings).filter(([, mapping]) => mapping.enabled)

  // Build the inputs dictionary string
  const inputsStr = JSON.stringify(inputs)

  // Build the export_mappings dictionary string
  const exportMappingsDict: Record<string, string> = {}
  for (const [exportName, mapping] of enabledExports) {
    exportMappingsDict[exportName] = mapping.variable_name
  }
  const exportMappingsStr = JSON.stringify(exportMappingsDict)

  // Build comments showing inputs and exports
  const inputsComment = `Inputs: ${inputsStr}`
  const exportsComment =
    enabledExports.length > 0
      ? `Exports: ${enabledExports.map(([name, mapping]) => `${name} -> ${mapping.variable_name}`).join(', ')}`
      : 'Exports: (none)'

  const functionCall = dedent`
    _dntk.run_notebook_function(
        '${notebookId}',
        inputs=${inputsStr},
        export_mappings=${exportMappingsStr}
    )
  `

  // Determine variable assignment based on number of exports
  if (enabledExports.length === 0) {
    return dedent`
      # Notebook Function: ${notebookId}
      # ${inputsComment}
      # ${exportsComment}
      ${functionCall}
    `
  }

  if (enabledExports.length === 1) {
    const variableName = enabledExports[0][1].variable_name
    return dedent`
      # Notebook Function: ${notebookId}
      # ${inputsComment}
      # ${exportsComment}
      ${variableName} = ${functionCall}
    `
  }

  // Multiple exports: use tuple unpacking
  const variableNames = enabledExports.map(([, mapping]) => mapping.variable_name).join(', ')
  return dedent`
    # Notebook Function: ${notebookId}
    # ${inputsComment}
    # ${exportsComment}
    ${variableNames} = ${functionCall}
  `
}
