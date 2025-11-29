import { z } from 'zod'

export const deepnoteRunBlockSchema = z.object({
  id: z.string(),
  executionCount: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  outputs: z.array(z.any()).optional(),
})

export type DeepnoteRunBlock = z.infer<typeof deepnoteRunBlockSchema>

export const deepnoteRunNotebookSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  blocks: z.array(deepnoteRunBlockSchema),
})

export type DeepnoteRunNotebook = z.infer<typeof deepnoteRunNotebookSchema>

export const deepnoteRunFileSchema = z.object({
  metadata: z.object({
    capturedAt: z.string(),
    source: z.string().optional(),
  }),
  project: z.object({
    id: z.string(),
    name: z.string().optional(),
    notebooks: z.array(deepnoteRunNotebookSchema),
  }),
  version: z.string(),
})

export type DeepnoteRunFile = z.infer<typeof deepnoteRunFileSchema>
