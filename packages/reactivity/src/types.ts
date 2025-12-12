import { z } from 'zod'

const BlockErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
})

export type BlockError = z.infer<typeof BlockErrorSchema>

export const BlockContentDepsSchema = z.object({
  blockId: z.string(),
  definedVariables: z.array(z.string()),
  usedVariables: z.array(z.string()),
  importedModules: z.array(z.string()).optional(),
  usedImportedModules: z.array(z.string()).optional(),
  error: BlockErrorSchema.optional(),
})

export type BlockContentDeps = z.infer<typeof BlockContentDepsSchema>

export interface BlockContentDepsWithOrder extends BlockContentDeps {
  order: number
}

export interface DAGNode {
  blockId: string
  inputVariables: string[]
  importedModules: string[]
  order: number
  outputVariables: string[]
  usedImportedModules: string[]
  error: BlockError | null
}

export interface DAGEdge {
  from: string
  to: string
  inputVariables: string[]
}

export interface BlockContentDepsDAG {
  nodes: DAGNode[]
  edges: DAGEdge[]
  modulesEdges: DAGEdge[]
}

// Input block type for the analyzer
export interface AnalyzerBlock {
  cellId: string
  cell_type: string
  source: string
  metadata?: Record<string, unknown>
}

// Zod schema for the AST analyzer output
export const AstAnalyzerItemSchema = z.object({
  blockId: z.string(),
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

export const AstAnalyzerSuccessSchema = z.array(AstAnalyzerItemSchema)
export const AstAnalyzerErrorSchema = z.object({ errorMessage: z.string() })
export const AstAnalyzerResponseSchema = z.union([AstAnalyzerSuccessSchema, AstAnalyzerErrorSchema])

export type AstAnalyzerItem = z.infer<typeof AstAnalyzerItemSchema>
