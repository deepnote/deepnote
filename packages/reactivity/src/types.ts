import { z } from 'zod/v3'

const BlockErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
})

type BlockError = z.infer<typeof BlockErrorSchema>

export const BlockContentDepsSchema = z.object({
  id: z.string(),
  definedVariables: z.array(z.string()),
  usedVariables: z.array(z.string()),
  importedModules: z.array(z.string()).optional(),
  // Note: if this field is not returned by AST parser, it will be calculated within webapp
  usedImportedModules: z.array(z.string()).optional(),
  error: BlockErrorSchema.optional(),
})

export interface DAGNode {
  id: string
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
