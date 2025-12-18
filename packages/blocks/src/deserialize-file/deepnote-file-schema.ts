import { z } from 'zod'

export const deepnoteBlockSchema = z.object({
  blockGroup: z.string().optional(),
  content: z.string().optional(),
  contentHash: z.string().optional(),
  executionCount: z.number().optional(),
  executionFinishedAt: z.string().optional(),
  executionStartedAt: z.string().optional(),
  id: z.string(),
  metadata: z.record(z.any()).optional(),
  outputs: z.array(z.any()).optional(),
  sortingKey: z.string(),
  type: z.string(),
  version: z.number().optional(),
})

export type DeepnoteBlock = z.infer<typeof deepnoteBlockSchema>

export const environmentSchema = z
  .object({
    customImage: z.string().optional(),
    hash: z.string().optional(),
    packages: z.record(z.string()).optional(),
    platform: z.string().optional(),
    pythonEnvironment: z.enum(['uv', 'conda', 'venv', 'poetry', 'system']).optional(),
    pythonVersion: z.string().optional(),
  })
  .optional()

export type Environment = z.infer<typeof environmentSchema>

export const executionSummarySchema = z
  .object({
    blocksExecuted: z.number().optional(),
    blocksFailed: z.number().optional(),
    blocksSucceeded: z.number().optional(),
    totalDurationMs: z.number().optional(),
  })
  .optional()

export type ExecutionSummary = z.infer<typeof executionSummarySchema>

export const executionErrorSchema = z
  .object({
    message: z.string().optional(),
    name: z.string().optional(),
    traceback: z.array(z.string()).optional(),
  })
  .optional()

export type ExecutionError = z.infer<typeof executionErrorSchema>

export const executionSchema = z
  .object({
    error: executionErrorSchema,
    finishedAt: z.string().optional(),
    inputs: z.record(z.any()).optional(),
    startedAt: z.string().optional(),
    summary: executionSummarySchema,
    triggeredBy: z.enum(['user', 'schedule', 'api', 'ci']).optional(),
  })
  .optional()

export type Execution = z.infer<typeof executionSchema>

export const deepnoteFileSchema = z.object({
  environment: environmentSchema,
  execution: executionSchema,
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
        blocks: z.array(deepnoteBlockSchema),
        executionMode: z.enum(['block', 'downstream']).optional(),
        id: z.string(),
        isModule: z.boolean().optional(),
        name: z.string(),
        workingDirectory: z.string().optional(),
      })
    ),
    settings: z
      .object({
        /**
         * @deprecated Use top-level `environment` instead.
         * This field is kept for backward compatibility.
         */
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
