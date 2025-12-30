import * as path from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { z } from 'zod'
import { safelyCallChildProcessWithInputOutput } from './child-process-utils'

export class AstAnalyzerInternalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AstAnalyzerInternalError'
  }
}

const AST_ANALYZER_SUPPORTED_CELL_TYPES_LIST = [
  'code',
  'sql',
  'button',
  'big-number',
  'notebook-function',
  'input-text',
  'input-textarea',
  'input-file',
  'input-select',
  'input-date',
  'input-date-range',
  'input-slider',
  'input-checkbox',
  'input-number',
  'input-dropdown',
] as const

export interface BlockContentDepsWithOrder {
  id: string
  definedVariables: string[]
  usedVariables: string[]
  importedModules?: string[]
  error?: {
    type: string
    message: string
  }
  order: number
}

const SUPPORTED_CELL_TYPES = new Set<string>(AST_ANALYZER_SUPPORTED_CELL_TYPES_LIST)

// Zod schema for the AST analyzer Python script output
const AstAnalyzerItemSchema = z.object({
  id: z.string(),
  definedVariables: z.array(z.string()),
  usedVariables: z.array(z.string()),
  importedModules: z.array(z.string()).optional(),
  error: z
    .object({
      type: z.string(),
      message: z.string(),
    })
    .optional(),
})

const AstAnalyzerSuccessSchema = z.array(AstAnalyzerItemSchema)
const AstAnalyzerErrorSchema = z.object({ errorMessage: z.string() })
const AstAnalyzerResponseSchema = z.union([AstAnalyzerSuccessSchema, AstAnalyzerErrorSchema])

/**
 * Tested within dag.test.ts integration test.
 * Intentionally mixing Python and SQL blocks here because we want to use just one local process invocation.
 */
export async function getBlockDependencies(
  blocks: DeepnoteBlock[],
  options: { pythonInterpreter?: string } = {}
): Promise<BlockContentDepsWithOrder[]> {
  const { pythonInterpreter = 'python3' } = options

  const blocksNeedingComputation = blocks
    // Process only supported cell types
    .filter(block => SUPPORTED_CELL_TYPES.has(block.type))
    // Format blocks for parser
    .map(block => ({
      ...block,
      content: block.content ?? '',
    }))

  // Early return if no blocks need computation
  if (blocksNeedingComputation.length === 0) {
    return []
  }

  try {
    const inputData = JSON.stringify({ blocks: blocksNeedingComputation })

    const scriptPath = path.join(__dirname, 'scripts', 'ast-analyzer.py')
    const outputData = await safelyCallChildProcessWithInputOutput(pythonInterpreter, [scriptPath], inputData)

    const json = JSON.parse(outputData)
    const parsed = await AstAnalyzerResponseSchema.safeParseAsync(json)
    if (!parsed.success) {
      throw new AstAnalyzerInternalError('Internal parser error: unexpected output format from AST analyzer.')
    }

    const parsedData = parsed.data

    if (Array.isArray(parsedData)) {
      const resultWithOrder = parsedData.map(block => ({
        ...block,
        order: blocks.findIndex(b => b.id === block.id),
      }))

      return resultWithOrder
    }

    if (typeof parsedData === 'object' && parsedData !== null && 'errorMessage' in parsedData) {
      const errorMessage = (parsedData as { errorMessage: string }).errorMessage
      throw new AstAnalyzerInternalError(
        `Could not build a dependency graph for this notebook due to errors in the code: ${errorMessage}`
      )
    }

    throw new AstAnalyzerInternalError('Internal parser error: malformed analyzer output.')
  } catch (error) {
    if (error instanceof AstAnalyzerInternalError) {
      throw error
    }

    throw new AstAnalyzerInternalError(
      `Failed to run AST analyzer process: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
