import { z } from 'zod'

// =============================================================================
// Base metadata schemas
// =============================================================================

const baseCellMetadataSchema = z
  .object({
    cell_id: z.unknown().optional(),
    deepnote_app_is_code_hidden: z.boolean().optional(),
    deepnote_app_is_output_hidden: z.boolean().optional(),
    deepnote_app_block_visible: z.boolean().optional(),
    deepnote_app_block_width: z.number().optional(),
    deepnote_app_block_group_id: z.string().nullable().optional(),
    deepnote_app_block_subgroup_id: z.string().optional(),
    deepnote_app_block_order: z.number().optional(),
  })
  .passthrough()

const executableCellMetadataSchema = baseCellMetadataSchema
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
    deepnote_output_heights: z.record(z.number()).optional(),
    deepnote_table_state: z.record(z.any()).optional(),
    last_executed_function_notebook_id: z.string().optional(),
    last_function_run_started_at: z.number().optional(),
    function_notebook_export_states: z.record(z.any()).optional(),
  })
  .passthrough()

const textCellMetadataSchema = baseCellMetadataSchema
  .extend({
    is_collapsed: z.boolean().optional(),
    formattedRanges: z.array(z.any()).optional(),
  })
  .passthrough()

// Base metadata schema for input blocks (extends executable with common input fields)
const baseInputMetadataSchema = executableCellMetadataSchema.extend({
  deepnote_variable_name: z.string(),
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
    .regex(/^(md5|sha256):[a-f0-9]+$/i)
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
// Schema factory helpers
// =============================================================================

/** Creates a text cell block schema with optional metadata extensions */
const createTextCellBlockSchema = <T extends string, M extends z.ZodRawShape = z.ZodRawShape>(
  type: T,
  metadataExtensions?: M
) =>
  z.object({
    ...baseBlockFields,
    type: z.literal(type),
    content: z.string().optional(),
    metadata: metadataExtensions
      ? textCellMetadataSchema.extend(metadataExtensions).optional()
      : textCellMetadataSchema.optional(),
  })

/** Creates an input block schema with the given value type and additional metadata */
const createInputBlockSchema = <T extends string, V extends z.ZodTypeAny, M extends z.ZodRawShape = z.ZodRawShape>(
  type: T,
  valueSchema: V,
  additionalMetadata?: M,
  options?: { noDefaultValue?: boolean }
) => {
  const baseMetadata = {
    deepnote_variable_value: valueSchema,
    ...(options?.noDefaultValue ? {} : { deepnote_variable_default_value: valueSchema.nullable().optional() }),
    ...additionalMetadata,
  }

  return z.object({
    ...executableBlockFields,
    type: z.literal(type),
    content: z.string().optional(),
    metadata: baseInputMetadataSchema.extend(baseMetadata),
  })
}

// =============================================================================
// Non-executable block schemas
// =============================================================================

const markdownBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('markdown'),
  content: z.string().optional(),
  metadata: baseCellMetadataSchema.extend({ deepnote_cell_height: z.number().optional() }).optional(),
})

const imageBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('image'),
  content: z.literal('').optional(),
  metadata: baseCellMetadataSchema
    .extend({
      deepnote_img_src: z.string().optional(),
      deepnote_img_width: z.enum(['actual', '50%', '75%', '100%']).optional(),
      deepnote_img_alignment: z.enum(['left', 'center', 'right']).optional(),
    })
    .optional(),
})

const separatorBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal('separator'),
  content: z.literal('').optional(),
  metadata: baseCellMetadataSchema.optional(),
})

const textCellH1BlockSchema = createTextCellBlockSchema('text-cell-h1')
const textCellH2BlockSchema = createTextCellBlockSchema('text-cell-h2')
const textCellH3BlockSchema = createTextCellBlockSchema('text-cell-h3')
const textCellPBlockSchema = createTextCellBlockSchema('text-cell-p')
const textCellBulletBlockSchema = createTextCellBlockSchema('text-cell-bullet')
const textCellTodoBlockSchema = createTextCellBlockSchema('text-cell-todo', {
  checked: z.boolean().optional(),
})
const textCellCalloutBlockSchema = createTextCellBlockSchema('text-cell-callout', {
  color: z.enum(['blue', 'green', 'yellow', 'red', 'purple']).optional(),
})

// =============================================================================
// Executable block schemas
// =============================================================================

const codeBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('code'),
  content: z.string().optional(),
  metadata: executableCellMetadataSchema.extend({ function_export_name: z.string().optional() }).optional(),
})

const sqlBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('sql'),
  content: z.string().optional(),
  metadata: executableCellMetadataSchema
    .extend({
      deepnote_variable_name: z.string().optional(),
      deepnote_return_variable_type: z.enum(['dataframe', 'query_preview']).optional(),
      sql_integration_id: z.string().optional(),
      is_compiled_sql_query_visible: z.boolean().optional(),
      function_export_name: z.string().optional(),
    })
    .optional(),
})

const notebookFunctionBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('notebook-function'),
  content: z.literal('').optional(),
  metadata: executableCellMetadataSchema
    .extend({
      function_notebook_id: z.string().nullable(),
      function_notebook_inputs: z.record(z.any()).optional(),
      function_notebook_export_mappings: z.record(z.any()).optional(),
    })
    .optional(),
})

const visualizationBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('visualization'),
  content: z.literal('').optional(),
  metadata: executableCellMetadataSchema
    .extend({
      deepnote_variable_name: z.string().optional(),
      deepnote_visualization_spec: z.record(z.any()).optional(),
      deepnote_config_collapsed: z.boolean().optional(),
      deepnote_chart_height: z.number().optional(),
      deepnote_chart_filter: z.record(z.any()).optional(),
    })
    .optional(),
})

const buttonBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('button'),
  content: z.literal('').optional(),
  metadata: executableCellMetadataSchema
    .extend({
      deepnote_button_title: z.string().optional(),
      deepnote_button_color_scheme: z.enum(['blue', 'red', 'neutral', 'green', 'yellow']).optional(),
      deepnote_button_behavior: z.enum(['run', 'set_variable']).optional(),
      deepnote_variable_name: z.string().optional(),
    })
    .optional(),
})

const bigNumberBlockSchema = z.object({
  ...executableBlockFields,
  type: z.literal('big-number'),
  content: z.string().optional(),
  metadata: executableCellMetadataSchema.extend({
    deepnote_big_number_title: z.string(),
    deepnote_big_number_value: z.string(),
    deepnote_big_number_format: z.string(),
    deepnote_big_number_comparison_enabled: z.boolean().optional(),
    deepnote_big_number_comparison_title: z.string().optional(),
    deepnote_big_number_comparison_value: z.string().optional(),
    deepnote_big_number_comparison_type: z.string().optional(),
    deepnote_big_number_comparison_format: z.string().optional(),
  }),
})

// =============================================================================
// Input block schemas
// =============================================================================

// Common value schemas for reuse
const stringOrStringArraySchema = z.union([z.string(), z.array(z.string())])
const dateRangeValueSchema = z.union([z.tuple([z.string(), z.string()]), z.string()])

const inputTextBlockSchema = createInputBlockSchema('input-text', z.string())

const inputTextareaBlockSchema = createInputBlockSchema('input-textarea', z.string())

const inputCheckboxBlockSchema = createInputBlockSchema('input-checkbox', z.boolean(), {
  deepnote_input_checkbox_label: z.string().optional(),
})

const inputSelectBlockSchema = createInputBlockSchema('input-select', stringOrStringArraySchema, {
  deepnote_variable_options: z.array(z.string()),
  deepnote_variable_custom_options: z.array(z.string()),
  deepnote_variable_selected_variable: z.string(),
  deepnote_variable_select_type: z.enum(['from-options', 'from-variable']),
  deepnote_allow_multiple_values: z.boolean().optional(),
  deepnote_allow_empty_values: z.boolean().optional(),
})

const inputSliderBlockSchema = createInputBlockSchema('input-slider', z.string(), {
  deepnote_slider_min_value: z.number(),
  deepnote_slider_max_value: z.number(),
  deepnote_slider_step: z.number(),
})

const inputDateBlockSchema = createInputBlockSchema('input-date', z.string(), {
  deepnote_allow_empty_values: z.boolean().optional(),
  deepnote_input_date_version: z.number().optional(),
})

const inputDateRangeBlockSchema = createInputBlockSchema('input-date-range', dateRangeValueSchema)

const inputFileBlockSchema = createInputBlockSchema(
  'input-file',
  z.string(),
  { deepnote_allowed_file_extensions: z.string().optional() },
  { noDefaultValue: true }
)

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
