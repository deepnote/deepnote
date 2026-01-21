import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { JupyterNotebook, JupyterOutput } from '../types/jupyter'

/**
 * Marimo session cache file format.
 * Found at __marimo__/session/{filename}.json
 */
export interface MarimoSessionCache {
  version: string
  metadata: {
    marimo_version: string
  }
  cells: MarimoSessionCell[]
}

export interface MarimoSessionCell {
  id: string
  code_hash: string
  outputs: MarimoSessionOutput[]
  console: MarimoConsoleOutput[]
}

export interface MarimoSessionOutput {
  type: 'data' | 'error'
  data?: Record<string, string>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export interface MarimoConsoleOutput {
  channel: 'stdout' | 'stderr'
  data: string
}

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

/**
 * Finds the Marimo session cache file for a given .py file.
 * Looks in __marimo__/session/{filename}.json relative to the file's directory.
 *
 * @param marimoFilePath - Path to the .py Marimo file
 * @returns Path to the session cache file, or null if not found
 */
export async function findMarimoSessionCache(marimoFilePath: string): Promise<string | null> {
  const dir = dirname(marimoFilePath)
  const filename = basename(marimoFilePath)
  const sessionPath = join(dir, '__marimo__', 'session', `${filename}.json`)

  try {
    await fs.access(sessionPath)
    return sessionPath
  } catch {
    return null
  }
}

/**
 * Reads and parses a Marimo session cache file.
 *
 * @param sessionPath - Path to the session cache JSON file
 * @returns The parsed session cache, or null if reading fails
 */
export async function readMarimoSessionCache(sessionPath: string): Promise<MarimoSessionCache | null> {
  try {
    const content = await fs.readFile(sessionPath, 'utf-8')
    return JSON.parse(content) as MarimoSessionCache
  } catch {
    return null
  }
}

/**
 * Converts a Marimo session output to Jupyter/Deepnote output format.
 *
 * @param output - The Marimo session output
 * @returns A Jupyter-compatible output object
 */
export function convertMarimoOutputToJupyter(output: MarimoSessionOutput): JupyterOutput {
  if (output.type === 'error') {
    return {
      output_type: 'error',
      ename: output.ename || 'Error',
      evalue: output.evalue || '',
      traceback: output.traceback || [],
    }
  }

  // Data output - convert to execute_result or display_data
  if (output.data) {
    return {
      output_type: 'execute_result',
      data: output.data,
      metadata: {},
      execution_count: null,
    }
  }

  // Empty output
  return {
    output_type: 'execute_result',
    data: { 'text/plain': '' },
    metadata: {},
    execution_count: null,
  }
}

/**
 * Converts Marimo console outputs to Jupyter stream outputs.
 *
 * @param consoleOutputs - Array of Marimo console outputs
 * @returns Array of Jupyter stream outputs
 */
export function convertMarimoConsoleToJupyter(consoleOutputs: MarimoConsoleOutput[]): JupyterOutput[] {
  const outputs: JupyterOutput[] = []

  for (const console of consoleOutputs) {
    outputs.push({
      output_type: 'stream',
      name: console.channel,
      text: console.data,
    })
  }

  return outputs
}

/**
 * Converts a full Marimo session cell to Jupyter outputs.
 *
 * @param cell - The Marimo session cell
 * @returns Array of Jupyter-compatible outputs
 */
export function convertMarimoSessionCellToOutputs(cell: MarimoSessionCell): JupyterOutput[] {
  const outputs: JupyterOutput[] = []

  // Add console outputs first (stdout/stderr)
  outputs.push(...convertMarimoConsoleToJupyter(cell.console))

  // Add data outputs
  for (const output of cell.outputs) {
    outputs.push(convertMarimoOutputToJupyter(output))
  }

  return outputs
}

/**
 * Gets outputs from the Marimo session cache file.
 * This is the preferred method as it doesn't require the marimo CLI.
 *
 * @param marimoFilePath - Path to the .py Marimo file
 * @returns Map of cell index to outputs, or null if session cache is not found
 */
export async function getMarimoOutputsFromCache(marimoFilePath: string): Promise<Map<number, JupyterOutput[]> | null> {
  const sessionPath = await findMarimoSessionCache(marimoFilePath)
  if (!sessionPath) {
    return null
  }

  const cache = await readMarimoSessionCache(sessionPath)
  if (!cache) {
    return null
  }

  const outputMap = new Map<number, JupyterOutput[]>()

  cache.cells.forEach((cell, index) => {
    const outputs = convertMarimoSessionCellToOutputs(cell)
    if (outputs.length > 0) {
      // Filter out empty text/plain outputs
      const nonEmptyOutputs = outputs.filter(o => {
        if (o.output_type === 'execute_result' && o.data) {
          const data = o.data as Record<string, string>
          // Keep if it has non-empty content in any mime type
          return Object.values(data).some(v => v && v.trim() !== '')
        }
        return true
      })
      if (nonEmptyOutputs.length > 0) {
        outputMap.set(index, nonEmptyOutputs)
      }
    }
  })

  return outputMap
}
