import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { createMarkdown, createPythonCode, deserializeDeepnoteFile } from '@deepnote/blocks'

interface JupyterCell {
  cell_type: 'code' | 'markdown'
  metadata: Record<string, unknown>
  source: string
  execution_count?: number | null
  // biome-ignore lint/suspicious/noExplicitAny: Jupyter outputs can have various types
  outputs?: any[]
}

interface JupyterNotebook {
  cells: JupyterCell[]
  metadata: {
    deepnote_notebook_id?: string
    deepnote_execution_queue?: unknown[]
    [key: string]: unknown
  }
  nbformat: number
  nbformat_minor: number
}

export interface ConvertDeepnoteFileToIpynbOptions {
  outputDir: string
  addCreatedInDeepnoteCell?: boolean
}

const CREATED_IN_DEEPNOTE_SOURCE = `<a style='text-decoration:none;line-height:16px;display:flex;color:#5B5B62;padding:10px;justify-content:end;' href='https://deepnote.com?utm_source=created-in-deepnote-cell&projectId={projectId}' target="_blank">
<img alt='Created in deepnote.com' style='display:inline;max-height:16px;margin:0px;margin-right:7.5px;' src='data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB3aWR0aD0iODBweCIgaGVpZ2h0PSI4MHB4IiB2aWV3Qm94PSIwIDAgODAgODAiIHZlcnNpb249IjEuMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+CiAgICA8IS0tIEdlbmVyYXRvcjogU2tldGNoIDU0LjEgKDc2NDkwKSAtIGh0dHBzOi8vc2tldGNoYXBwLmNvbSAtLT4KICAgIDx0aXRsZT5Hcm91cCAzPC90aXRsZT4KICAgIDxkZXNjPkNyZWF0ZWQgd2l0aCBTa2V0Y2guPC9kZXNjPgogICAgPGcgaWQ9IkxhbmRpbmciIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIiBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPgogICAgICAgIDxnIGlkPSJBcnRib2FyZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTEyMzUuMDAwMDAwLCAtNzkuMDAwMDAwKSI+CiAgICAgICAgICAgIDxnIGlkPSJHcm91cC0zIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMjM1LjAwMDAwMCwgNzkuMDAwMDAwKSI+CiAgICAgICAgICAgICAgICA8cG9seWdvbiBpZD0iUGF0aC0yMCIgZmlsbD0iIzAyNjVCNCIgcG9pbnRzPSIyLjM3NjIzNzYyIDgwIDM4LjA0NzY2NjcgODAgNTcuODIxNzgyMiA3My44MDU3NTkyIDU3LjgyMTc4MjIgMzIuNzU5MjczOSAzOS4xNDAyMjc4IDMxLjY4MzE2ODMiPjwvcG9seWdvbj4KICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0zNS4wMDc3MTgsODAgQzQyLjkwNjIwMDcsNzYuNDU0OTM1OCA0Ny41NjQ5MTY3LDcxLjU0MjI2NzEgNDguOTgzODY2LDY1LjI2MTk5MzkgQzUxLjExMjI4OTksNTUuODQxNTg0MiA0MS42NzcxNzk1LDQ5LjIxMjIyODQgMjUuNjIzOTg0Niw0OS4yMTIyMjg0IEMyNS40ODQ5Mjg5LDQ5LjEyNjg0NDggMjkuODI2MTI5Niw0My4yODM4MjQ4IDM4LjY0NzU4NjksMzEuNjgzMTY4MyBMNzIuODcxMjg3MSwzMi41NTQ0MjUgTDY1LjI4MDk3Myw2Ny42NzYzNDIxIEw1MS4xMTIyODk5LDc3LjM3NjE0NCBMMzUuMDA3NzE4LDgwIFoiIGlkPSJQYXRoLTIyIiBmaWxsPSIjMDAyODY4Ij48L3BhdGg+CiAgICAgICAgICAgICAgICA8cGF0aCBkPSJNMCwzNy43MzA0NDA1IEwyNy4xMTQ1MzcsMC4yNTcxMTE0MzYgQzYyLjM3MTUxMjMsLTEuOTkwNzE3MDEgODAsMTAuNTAwMzkyNyA4MCwzNy43MzA0NDA1IEM4MCw2NC45NjA0ODgyIDY0Ljc3NjUwMzgsNzkuMDUwMzQxNCAzNC4zMjk1MTEzLDgwIEM0Ny4wNTUzNDg5LDc3LjU2NzA4MDggNTMuNDE4MjY3Nyw3MC4zMTM2MTAzIDUzLjQxODI2NzcsNTguMjM5NTg4NSBDNTMuNDE4MjY3Nyw0MC4xMjg1NTU3IDM2LjMwMzk1NDQsMzcuNzMwNDQwNSAyNS4yMjc0MTcsMzcuNzMwNDQwNSBDMTcuODQzMDU4NiwzNy43MzA0NDA1IDkuNDMzOTE5NjYsMzcuNzMwNDQwNSAwLDM3LjczMDQ0MDUgWiIgaWQ9IlBhdGgtMTkiIGZpbGw9IiMzNzkzRUYiPjwvcGF0aD4KICAgICAgICAgICAgPC9nPgogICAgICAgIDwvZz4KICAgIDwvZz4KPC9zdmc+' > </img>
Created in <span style='font-weight:600;margin-left:4px;'>Deepnote</span></a>`

function convertBlockToJupyterCell(block: DeepnoteBlock): JupyterCell {
  const metadata: Record<string, unknown> = {
    ...block.metadata,
    cell_id: block.id,
    deepnote_cell_type: block.type,
  }

  // Determine if this should be a code cell or markdown cell
  const isCodeBlock = shouldConvertToCodeCell(block)

  if (isCodeBlock) {
    let source: string

    // For code blocks, use the original source
    if (block.type === 'code') {
      source = block.content ?? ''
    } else {
      // For other executable blocks (SQL, input, visualization, etc.),
      // generate the equivalent Python code
      try {
        source = createPythonCode(block)
      } catch (error) {
        // If we can't generate Python code, fall back to a comment
        const message = error instanceof Error ? error.message : String(error)
        source = `# Unable to convert ${block.type} block: ${message}`
      }
    }

    return {
      cell_type: 'code',
      metadata,
      source,
      execution_count: block.executionCount ?? null,
      outputs: block.outputs ?? [],
    }
  }

  // Convert to markdown cell
  let source: string

  if (block.type === 'markdown') {
    source = block.content ?? ''
  } else {
    // For text blocks, images, separators, etc., use createMarkdown
    try {
      source = createMarkdown(block)
    } catch (_error) {
      // If we can't generate markdown, use the content directly
      source = block.content ?? ''
    }
  }

  return {
    cell_type: 'markdown',
    metadata,
    source,
  }
}

function shouldConvertToCodeCell(block: DeepnoteBlock): boolean {
  const codeBlockTypes = [
    'code',
    'sql',
    'input-text',
    'input-textarea',
    'input-checkbox',
    'input-select',
    'input-slider',
    'input-date',
    'input-date-range',
    'input-file',
    'visualization',
    'big-number',
    'button',
  ]

  return codeBlockTypes.includes(block.type)
}

function createCreatedInDeepnoteCell(projectId: string): JupyterCell {
  return {
    cell_type: 'markdown',
    metadata: {
      created_in_deepnote_cell: true,
      deepnote_cell_type: 'markdown',
    },
    source: CREATED_IN_DEEPNOTE_SOURCE.replace('{projectId}', projectId),
  }
}

/**
 * Converts a Deepnote project file (.deepnote) to Jupyter notebook files (.ipynb).
 */
export async function convertDeepnoteFileToIpynb(
  deepnoteFilePath: string,
  options: ConvertDeepnoteFileToIpynbOptions
): Promise<void> {
  // Read and parse the .deepnote file
  const yamlContent = await fs.readFile(deepnoteFilePath, 'utf-8')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  // Create output directory
  await fs.mkdir(options.outputDir, { recursive: true })

  const addCreatedInDeepnoteCell = options.addCreatedInDeepnoteCell ?? true

  // Convert each notebook in the project
  for (const notebook of deepnoteFile.project.notebooks) {
    const jupyterNotebook: JupyterNotebook = {
      cells: [],
      metadata: {
        deepnote_notebook_id: notebook.id,
        deepnote_execution_queue: [],
      },
      nbformat: 4,
      nbformat_minor: 0,
    }

    // Convert each block to a Jupyter cell
    for (const block of notebook.blocks) {
      const cell = convertBlockToJupyterCell(block)
      jupyterNotebook.cells.push(cell)
    }

    // Optionally add "Created in Deepnote" cell
    if (addCreatedInDeepnoteCell) {
      jupyterNotebook.cells.push(createCreatedInDeepnoteCell(deepnoteFile.project.id))
    }

    // Write the Jupyter notebook file
    const outputFileName = `${notebook.name}.ipynb`
    const outputPath = join(options.outputDir, outputFileName)

    await fs.writeFile(outputPath, JSON.stringify(jupyterNotebook, null, 2), 'utf-8')
  }
}
