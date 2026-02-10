import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { stringify as yamlStringify } from 'yaml'

export async function loadDeepnoteFile(filePath: string): Promise<DeepnoteFile> {
  const absolutePath = path.resolve(filePath)
  const content = await fs.readFile(absolutePath, 'utf-8')
  return deserializeDeepnoteFile(content)
}

export async function saveDeepnoteFile(filePath: string, file: DeepnoteFile): Promise<void> {
  const absolutePath = path.resolve(filePath)
  const content = yamlStringify(file, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  })
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

/**
 * Python builtins set for detecting undefined variables in notebook code.
 * Only includes actual Python builtins, not common library aliases.
 */
export const PYTHON_BUILTINS = new Set([
  'print',
  'len',
  'range',
  'str',
  'int',
  'float',
  'list',
  'dict',
  'set',
  'tuple',
  'bool',
  'None',
  'True',
  'False',
  'type',
  'isinstance',
  'hasattr',
  'getattr',
  'setattr',
  'open',
  'input',
  'sum',
  'min',
  'max',
  'abs',
  'round',
  'sorted',
  'reversed',
  'enumerate',
  'zip',
  'map',
  'filter',
  'any',
  'all',
  'ord',
  'chr',
  'hex',
  'bin',
  'oct',
  'format',
  'repr',
  'id',
  'dir',
  'vars',
  'globals',
  'locals',
  'exec',
  'eval',
  'compile',
  '__name__',
  '__file__',
  '__doc__',
  'Exception',
  'ValueError',
  'TypeError',
  'KeyError',
  'IndexError',
  'AttributeError',
  'ImportError',
  'RuntimeError',
  'StopIteration',
  'object',
  'super',
  'classmethod',
  'staticmethod',
  'property',
])

export function isPythonBuiltin(name: string): boolean {
  return PYTHON_BUILTINS.has(name)
}
