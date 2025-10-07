import { z } from 'zod'

export const deepnoteFileBlockSchema = z.object({
  blockGroup: z.string().optional(),
  content: z.string().optional(),
  executionCount: z.number().optional(),
  id: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  outputs: z.array(z.any()).optional(),
  sortingKey: z.string(),
  type: z.string(),
  version: z.number().optional(),
})

export type DeepnoteFileBlock = z.infer<typeof deepnoteFileBlockSchema>

export const deepnoteFileSchema = z.object({
  metadata: z.object({
    checksum: z.string().optional(),
    createdAt: z.string(),
    exportedAt: z.string().optional(),
    modifiedAt: z.string().optional(),
  }),

  project: z.object({
    id: z.string(),

    initNotebookId: z.string().optional(),
    integrations: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
        })
      )
      .optional(),
    name: z.string(),
    notebooks: z.array(
      z.object({
        blocks: z.array(deepnoteFileBlockSchema),
        executionMode: z.enum(['block', 'downstream']).optional(),
        id: z.string(),
        isModule: z.boolean().optional(),
        name: z.string(),
        workingDirectory: z.string().optional(),
      })
    ),
    settings: z
      .object({
        environment: z
          .object({
            customImage: z.string().optional(),
            pythonVersion: z.string().optional(),
          })
          .optional(),
        requirements: z.array(z.string()).optional(),
        sqlCacheMaxAge: z.number().optional(),
      })
      .optional(),
  }),
  version: z.string(),
})

export type DeepnoteFile = z.infer<typeof deepnoteFileSchema>
