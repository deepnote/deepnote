import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JupyterNotebook } from '../types/jupyter'

/**
 * Checks if the marimo CLI is available in the system PATH.
 *
 * @returns True if marimo CLI is available
 */
export function isMarimoCliAvailable(): boolean {
  try {
    execSync('which marimo', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Exports a Marimo notebook to Jupyter format using the marimo CLI.
 * This includes outputs if they are available in the marimo cache.
 *
 * @param marimoFilePath - Path to the .py Marimo file
 * @returns The exported Jupyter notebook content, or null if export fails
 */
export async function exportMarimoToJupyter(marimoFilePath: string): Promise<JupyterNotebook | null> {
  if (!isMarimoCliAvailable()) {
    return null
  }

  // Create a temp file for the output
  const tempDir = tmpdir()
  const tempFile = join(tempDir, `marimo-export-${Date.now()}.ipynb`)

  try {
    // Run marimo export with --include-outputs flag
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('marimo', ['export', 'ipynb', marimoFilePath, '-o', tempFile, '--include-outputs'], {
        stdio: 'pipe',
      })

      let stderr = ''
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`marimo export failed with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err: Error) => {
        reject(err)
      })
    })

    // Read and parse the exported notebook
    const content = await fs.readFile(tempFile, 'utf-8')
    return JSON.parse(content) as JupyterNotebook
  } catch {
    // Export failed, return null
    return null
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tempFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extracts outputs from an exported Marimo Jupyter notebook.
 * Maps outputs by cell index for merging back into Deepnote blocks.
 *
 * @param notebook - The exported Jupyter notebook
 * @returns Map of cell index to outputs
 */
export function extractOutputsFromMarimoExport(notebook: JupyterNotebook): Map<number, unknown[]> {
  const outputMap = new Map<number, unknown[]>()

  notebook.cells.forEach((cell, index) => {
    if (cell.cell_type === 'code' && cell.outputs && cell.outputs.length > 0) {
      outputMap.set(index, cell.outputs)
    }
  })

  return outputMap
}

/**
 * Gets Marimo outputs for a file if the CLI is available.
 * This is a convenience function that combines the export and extraction steps.
 *
 * @param marimoFilePath - Path to the .py Marimo file
 * @returns Map of cell index to outputs, or null if marimo CLI is not available
 */
export async function getMarimoOutputs(marimoFilePath: string): Promise<Map<number, unknown[]> | null> {
  const notebook = await exportMarimoToJupyter(marimoFilePath)
  if (!notebook) {
    return null
  }
  return extractOutputsFromMarimoExport(notebook)
}
