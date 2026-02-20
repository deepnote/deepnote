import { z } from 'zod/v3'

const BlockErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
})

type BlockError = z.infer<typeof BlockErrorSchema>

export const BlockDependencySchema = z.object({
  id: z.string(),
  definedVariables: z.array(z.string()),
  usedVariables: z.array(z.string()),
  importedModules: z.array(z.string()).optional(),
  importedPackages: z.array(z.string()).optional(),
  // Note: if this field is not returned by AST parser, it will be calculated within webapp
  usedImportedModules: z.array(z.string()).optional(),
  error: BlockErrorSchema.optional(),
})

export interface DagNode {
  id: string
  inputVariables: string[]
  importedModules: string[]
  importedPackages?: string[]
  packageAliases?: Record<string, string>
  packageFromImports?: Record<string, string[]>
  order: number
  outputVariables: string[]
  usedImportedModules: string[]
  error: BlockError | null
}

export interface DagEdge {
  from: string
  to: string
  inputVariables: string[]
}

export interface BlockDependencyDag {
  nodes: DagNode[]
  edges: DagEdge[]
  modulesEdges: DagEdge[]
}
