import { PYTHON_BUILTINS } from '@deepnote/reactivity'

const DATA_SCIENCE_GLOBALS = new Set([
  // Common data science globals/aliases
  'pd',
  'np',
  'plt',
  'sns',
  'tf',
  'torch',
  'sk',
  'scipy',
  'display',
  'HTML',
  'Image',
  'DataFrame',
  'Series',
])

/**
 * Check if a variable name is a Python builtin or common global.
 */
export function isBuiltinOrGlobal(name: string): boolean {
  return PYTHON_BUILTINS.has(name) || DATA_SCIENCE_GLOBALS.has(name)
}
