import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '@deepnote/blocks'
import { PYTHON_BUILTINS } from '@deepnote/reactivity'

export async function loadDeepnoteFile(filePath: string): Promise<DeepnoteFile> {
  const absolutePath = path.resolve(filePath)
  const content = await fs.readFile(absolutePath, 'utf-8')
  return deserializeDeepnoteFile(content)
}

export async function saveDeepnoteFile(filePath: string, file: DeepnoteFile): Promise<void> {
  const absolutePath = path.resolve(filePath)
  const content = serializeDeepnoteFile(file)
  await fs.writeFile(absolutePath, content, 'utf-8')
}

/**
 * Format output based on compact mode - omit null/empty, use single-line JSON
 */
export function formatOutput(data: Record<string, unknown>, compact: boolean): string {
  if (compact) {
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([_, v]: [string, unknown]) => {
        if (v == null) return false
        if (Array.isArray(v) && v.length === 0) return false
        if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) return false
        return true
      })
    )
    return JSON.stringify(filtered)
  }
  return JSON.stringify(data, null, 2)
}

export function generateSortingKey(index: number): string {
  return String(index).padStart(6, '0')
}

export function isPythonBuiltin(name: string): boolean {
  return PYTHON_BUILTINS.has(name)
}
