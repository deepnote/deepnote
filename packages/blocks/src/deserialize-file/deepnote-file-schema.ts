import { z } from 'zod'

// =============================================================================
// Backward compatibility helpers
// =============================================================================

/** Preprocesses any content value to empty string for blocks that don't use content */
const emptyContent = () => z.preprocess(() => '', z.literal('').optional())

// =============================================================================
// Base metadata schemas
// =============================================================================

const baseBlockMetadataSchema = z
  .object({
    deepnote_app_is_code_hidden: z.boolean().optional(),
    deepnote_app_is_output_hidden: z.boolean().optional(),
    deepnote_app_block_visible: z.boolean().optional(),
    deepnote_app_block_width: z.number().optional(),
    deepnote_app_block_group_id: z.string().nullable().optional(),
    deepnote_app_block_subgroup_id: z.string().optional(),
    deepnote_app_block_order: z.number().optional(),
  })
  .passthrough()

const executableBlockMetadataSchema = baseBlockMetadataSchema
  .extend({
    allow_embed: z.union([z.boolean(), z.enum(['code_output', 'code', 'output'])]).optional(),
    is_code_hidden: z.boolean().optional(),
    is_output_hidden: z.boolean().optional(),
    output_cleared: z.boolean().optional(),
    execution_start: z.number().optional(),
    execution_millis: z.number().optional(),
    source_hash: z.string().optional(),
    execution_context_id: z.string().optional(),
    deepnote_cell_height: z.number().optional(),
    deepnote_output_heights: z.array(z.number().nullable()).optional(),
    deepnote_table_state: z.record(z.any()).optional(),
    last_executed_function_notebook_id: z.string().optional(),
    last_function_run_started_at: z.number().optional(),
    function_notebook_export_states: z.record(z.any()).optional(),
  })
  .passthrough()

const textCellMetadataSchema = baseBlockMetadataSchema
  .extend({
    is_collapsed: z.boolean().optional(),
    formattedRanges: z.array(z.any()).optional(),
  })
  .passthrough()

// Base metadata schema for input blocks (extends executable with common input fields)
const baseInputMetadataSchema = executableBlockMetadataSchema.extend({
  deepnote_variable_name: z.string().default('unnamed_variable'),
  deepnote_input_label: z.string().optional(),
})

// =============================================================================
// Common block fields
// =============================================================================

const baseBlockFields = {
  id: z.string(),
  blockGroup: z.string(),
  sortingKey: z.string(),
  contentHash: z
    .string()
    .regex(/^([a-z0-9]+:)?[a-f0-9]+$/i)
    .optional(),
  version: z.number().optional(),
}

const executableBlockFields = {
  ...baseBlockFields,
  executionCount: z.number().nullable().optional(),
  executionFinishedAt: z.string().datetime().optional(),
  executionStartedAt: z.string().datetime().optional(),
  outputs: z.array(z.any()).optional(),
}

// =============================================================================
// Non-executable block schemas
// =============================================================================

const markdownBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('markdown'),
  content: z.string().optional(),
  metadata: baseBlockMetadataSchema.extend({ deepnote_cell_height: z.number().optional() }).default({}),
})

const imageBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('image'),
  content: emptyContent(),
  metadata: baseBlockMetadataSchema
    .extend({
      deepnote_img_src: z.string().optional(),
      deepnote_img_width: z.enum(['actual', '50%', '75%', '100%']).optional(),
      deepnote_img_alignment: z.enum(['left', 'center', 'right']).optional(),
    })
    .default({}),
})

const separatorBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('separator'),
  content: emptyContent(),
  metadata: baseBlockMetadataSchema.default({}),
})

const textCellH1BlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-h1'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.default({}),
})

const textCellH2BlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-h2'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.default({}),
})

const textCellH3BlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-h3'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.default({}),
})

const textCellPBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-p'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.default({}),
})

const textCellBulletBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-bullet'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.default({}),
})

const textCellTodoBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-todo'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema.extend({ checked: z.boolean().optional() }).default({}),
})

const textCellCalloutBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('text-cell-callout'),
  content: z.string().optional(),
  metadata: textCellMetadataSchema
    .extend({ color: z.enum(['blue', 'green', 'yellow', 'red', 'purple']).optional() })
    .default({}),
})

// =============================================================================
// Executable block schemas
// =============================================================================

const codeBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('code'),
  content: z.string().optional(),
  metadata: executableBlockMetadataSchema.extend({ function_export_name: z.string().optional() }).default({}),
})

const sqlBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('sql'),
  content: z.string().optional(),
  metadata: executableBlockMetadataSchema
    .extend({
      deepnote_variable_name: z.string().optional(),
      deepnote_return_variable_type: z.enum(['dataframe', 'query_preview']).optional(),
      sql_integration_id: z.string().optional(),
      is_compiled_sql_query_visible: z.boolean().optional(),
      function_export_name: z.string().optional(),
    })
    .default({}),
})

const notebookFunctionBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('notebook-function'),
  content: emptyContent(),
  metadata: executableBlockMetadataSchema
    .extend({
      function_notebook_id: z.string().nullable(),
      function_notebook_inputs: z.record(z.any()).optional(),
      function_notebook_export_mappings: z.record(z.any()).optional(),
    })
    .default({ function_notebook_id: null }),
})

const visualizationBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('visualization'),
  content: emptyContent(),
  metadata: executableBlockMetadataSchema
    .extend({
      deepnote_variable_name: z.string().optional(),
      deepnote_visualization_spec: z.record(z.any()).optional(),
      deepnote_config_collapsed: z.boolean().optional(),
      deepnote_chart_height: z.number().optional(),
      deepnote_chart_filter: z.record(z.any()).optional(),
    })
    .default({}),
})

const buttonBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('button'),
  content: emptyContent(),
  metadata: executableBlockMetadataSchema
    .extend({
      deepnote_button_title: z.string().optional(),
      deepnote_button_color_scheme: z.enum(['blue', 'red', 'neutral', 'green', 'yellow']).optional(),
      deepnote_button_behavior: z.enum(['run', 'set_variable']).optional(),
      deepnote_variable_name: z.string().optional(),
    })
    .default({}),
})

const bigNumberBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('big-number'),
  content: z.string().optional(),
  metadata: executableBlockMetadataSchema
    .extend({
      deepnote_big_number_title: z.string().default(''),
      deepnote_big_number_value: z.string().default(''),
      deepnote_big_number_format: z.string().default(''),
      deepnote_big_number_comparison_enabled: z.boolean().optional(),
      deepnote_big_number_comparison_title: z.string().optional(),
      deepnote_big_number_comparison_value: z.string().optional(),
      deepnote_big_number_comparison_type: z.string().optional(),
      deepnote_big_number_comparison_format: z.string().optional(),
    })
    .default({}),
})

// =============================================================================
// Input block schemas
// =============================================================================

const inputTextBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-text'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.string().default(''),
      deepnote_variable_default_value: z.preprocess(val => (val === null ? undefined : val), z.string().optional()),
    })
    .default({}),
})

const inputTextareaBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-textarea'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.string().default(''),
      deepnote_variable_default_value: z.preprocess(val => (val === null ? undefined : val), z.string().optional()),
    })
    .default({}),
})

const inputCheckboxBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-checkbox'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.boolean().default(false),
      deepnote_variable_default_value: z.preprocess(val => (val === null ? undefined : val), z.boolean().optional()),
      deepnote_input_checkbox_label: z.string().optional(),
    })
    .default({}),
})

const inputSelectBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-select'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.union([z.string(), z.array(z.string())]).default(''),
      deepnote_variable_default_value: z.preprocess(
        val => (val === null ? undefined : val),
        z.union([z.string(), z.array(z.string())]).optional()
      ),
      deepnote_variable_options: z.array(z.string()).default([]),
      deepnote_variable_custom_options: z.array(z.string()).default([]),
      deepnote_variable_selected_variable: z.string().default(''),
      deepnote_variable_select_type: z.enum(['from-options', 'from-variable']).default('from-options'),
      deepnote_allow_multiple_values: z.boolean().optional(),
      deepnote_allow_empty_values: z.boolean().optional(),
    })
    .default({}),
})

const inputSliderBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-slider'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.string().default('0'),
      deepnote_variable_default_value: z.preprocess(val => (val === null ? undefined : val), z.string().optional()),
      deepnote_slider_min_value: z.number().default(0),
      deepnote_slider_max_value: z.number().default(100),
      deepnote_slider_step: z.number().default(1),
    })
    .default({}),
})

const inputDateBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-date'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.string().default(''),
      deepnote_variable_default_value: z.preprocess(val => (val === null ? undefined : val), z.string().optional()),
      deepnote_allow_empty_values: z.boolean().optional(),
      deepnote_input_date_version: z.number().optional(),
    })
    .default({}),
})

const inputDateRangeBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-date-range'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.union([z.tuple([z.string(), z.string()]), z.string()]).default(''),
      deepnote_variable_default_value: z.preprocess(
        val => (val === null ? undefined : val),
        z.union([z.tuple([z.string(), z.string()]), z.string()]).optional()
      ),
    })
    .default({}),
})

const inputFileBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('input-file'),
  content: z.string().optional(),
  metadata: baseInputMetadataSchema
    .extend({
      deepnote_variable_value: z.string().default(''),
      deepnote_allowed_file_extensions: z.string().optional(),
    })
    .default({}),
})

// =============================================================================
// Combined block schema (discriminated union)
// =============================================================================

export const deepnoteBlockSchema = z.discriminatedUnion('type', [
  // Non-executable blocks
  markdownBlockSchema,
  imageBlockSchema,
  separatorBlockSchema,
  textCellH1BlockSchema,
  textCellH2BlockSchema,
  textCellH3BlockSchema,
  textCellPBlockSchema,
  textCellBulletBlockSchema,
  textCellTodoBlockSchema,
  textCellCalloutBlockSchema,
  // Executable blocks
  codeBlockSchema,
  sqlBlockSchema,
  notebookFunctionBlockSchema,
  visualizationBlockSchema,
  buttonBlockSchema,
  bigNumberBlockSchema,
  // Input blocks
  inputTextBlockSchema,
  inputTextareaBlockSchema,
  inputCheckboxBlockSchema,
  inputSelectBlockSchema,
  inputSliderBlockSchema,
  inputDateBlockSchema,
  inputDateRangeBlockSchema,
  inputFileBlockSchema,
])

export type DeepnoteBlock = z.infer<typeof deepnoteBlockSchema>

// =============================================================================
// Individual block types (inferred from Zod schemas)
// =============================================================================

export type MarkdownBlock = z.infer<typeof markdownBlockSchema>
export type ImageBlock = z.infer<typeof imageBlockSchema>
export type SeparatorBlock = z.infer<typeof separatorBlockSchema>
export type TextCellH1Block = z.infer<typeof textCellH1BlockSchema>
export type TextCellH2Block = z.infer<typeof textCellH2BlockSchema>
export type TextCellH3Block = z.infer<typeof textCellH3BlockSchema>
export type TextCellPBlock = z.infer<typeof textCellPBlockSchema>
export type TextCellBulletBlock = z.infer<typeof textCellBulletBlockSchema>
export type TextCellTodoBlock = z.infer<typeof textCellTodoBlockSchema>
export type TextCellCalloutBlock = z.infer<typeof textCellCalloutBlockSchema>
export type CodeBlock = z.infer<typeof codeBlockSchema>
export type SqlBlock = z.infer<typeof sqlBlockSchema>
export type NotebookFunctionBlock = z.infer<typeof notebookFunctionBlockSchema>
export type VisualizationBlock = z.infer<typeof visualizationBlockSchema>
export type ButtonBlock = z.infer<typeof buttonBlockSchema>
export type BigNumberBlock = z.infer<typeof bigNumberBlockSchema>
export type InputTextBlock = z.infer<typeof inputTextBlockSchema>
export type InputTextareaBlock = z.infer<typeof inputTextareaBlockSchema>
export type InputCheckboxBlock = z.infer<typeof inputCheckboxBlockSchema>
export type InputSelectBlock = z.infer<typeof inputSelectBlockSchema>
export type InputSliderBlock = z.infer<typeof inputSliderBlockSchema>
export type InputDateBlock = z.infer<typeof inputDateBlockSchema>
export type InputDateRangeBlock = z.infer<typeof inputDateRangeBlockSchema>
export type InputFileBlock = z.infer<typeof inputFileBlockSchema>

/** Union of all input block types */
export type InputBlock =
  | InputTextBlock
  | InputTextareaBlock
  | InputCheckboxBlock
  | InputSelectBlock
  | InputSliderBlock
  | InputDateBlock
  | InputDateRangeBlock
  | InputFileBlock

/** Union of all text cell block types */
export type TextCellBlock =
  | TextCellH1Block
  | TextCellH2Block
  | TextCellH3Block
  | TextCellPBlock
  | TextCellBulletBlock
  | TextCellTodoBlock
  | TextCellCalloutBlock

// =============================================================================
// File-level schemas
// =============================================================================

export const environmentSchema = z
  .object({
    customImage: z.string().optional(),
    hash: z.string().optional(),
    packages: z.record(z.string()).optional(),
    platform: z.string().optional(),
    python: z
      .object({
        environment: z.enum(['uv', 'conda', 'venv', 'poetry', 'system']).optional(),
        version: z.string().optional(),
      })
      .optional(),
  })
  .optional()

export type Environment = z.infer<typeof environmentSchema>

export const executionSummarySchema = z
  .object({
    blocksExecuted: z.number().int().nonnegative().optional(),
    blocksFailed: z.number().int().nonnegative().optional(),
    blocksSucceeded: z.number().int().nonnegative().optional(),
    totalDurationMs: z.number().nonnegative().optional(),
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
    finishedAt: z.string().datetime().optional(),
    inputs: z.record(z.unknown()).optional(),
    startedAt: z.string().datetime().optional(),
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
