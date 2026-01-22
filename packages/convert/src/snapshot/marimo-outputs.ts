import fs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { JupyterOutput } from '../types/jupyter'

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
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export interface MarimoConsoleOutput {
  channel: 'stdout' | 'stderr'
  data: string
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
  } catch (_error) {
    // Debug logging (uncomment for troubleshooting):
    // console.debug('Failed to read Marimo session cache:', sessionPath, _error)
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

  for (const consoleOutput of consoleOutputs) {
    outputs.push({
      output_type: 'stream',
      name: consoleOutput.channel,
      text: consoleOutput.data,
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
  outputs.push(...convertMarimoConsoleToJupyter(cell.console ?? []))

  // Add data outputs
  for (const output of cell.outputs) {
    outputs.push(convertMarimoOutputToJupyter(output))
  }

  return outputs
}

/**
 * Gets outputs from the Marimo session cache file.
 * This is the preferred method as it doesn't require the marimo CLI.
 * Outputs are keyed by code_hash for reliable matching even when cells are reordered.
 *
 * @param marimoFilePath - Path to the .py Marimo file
 * @returns Map of code_hash to outputs, or null if session cache is not found
 */
export async function getMarimoOutputsFromCache(marimoFilePath: string): Promise<Map<string, JupyterOutput[]> | null> {
  const sessionPath = await findMarimoSessionCache(marimoFilePath)
  if (!sessionPath) {
    return null
  }

  const cache = await readMarimoSessionCache(sessionPath)
  if (!cache) {
    return null
  }

  const outputMap = new Map<string, JupyterOutput[]>()

  for (const cell of cache.cells) {
    const outputs = convertMarimoSessionCellToOutputs(cell)
    if (outputs.length > 0) {
      // Filter out empty text/plain outputs
      const nonEmptyOutputs = outputs.filter(o => {
        if (o.output_type === 'execute_result' && o.data) {
          const data = o.data as Record<string, unknown>
          // Keep if it has non-empty content in any mime type
          return Object.values(data).some(v => {
            if (typeof v === 'string') {
              return v.trim() !== ''
            }
            return v != null
          })
        }
        return true
      })
      if (nonEmptyOutputs.length > 0) {
        outputMap.set(cell.code_hash, nonEmptyOutputs)
      }
    }
  }

  return outputMap
}
