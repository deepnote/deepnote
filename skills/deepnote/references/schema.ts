// Auto-generated from Zod schemas in @deepnote/blocks
// Do not edit manually. Regenerate with: pnpm --filter @deepnote/cli generate:skill-schema
//
// DeepnoteFile and DeepnoteSnapshot are omitted — they wrap DeepnoteBlock
// inside project.notebooks[].blocks[]. See SKILL.md for the file structure.


export type DeepnoteBlock =
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'markdown';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        deepnote_cell_height?: number;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'image';
      content?: '';
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        deepnote_img_src?: string;
        deepnote_img_width?: 'actual' | '50%' | '75%' | '100%';
        deepnote_img_alignment?: 'left' | 'center' | 'right';
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'separator';
      content?: '';
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-h1';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-h2';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-h3';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-p';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-bullet';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-todo';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        checked?: boolean;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      type: 'text-cell-callout';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        is_collapsed?: boolean;
        formattedRanges?: any[];
        color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'code';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        function_export_name?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'sql';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_return_variable_type?: 'dataframe' | 'query_preview';
        sql_integration_id?: string;
        is_compiled_sql_query_visible?: boolean;
        function_export_name?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'notebook-function';
      content?: '';
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        function_notebook_id: string | null;
        function_notebook_inputs?: {
          [k: string]: any;
        };
        function_notebook_export_mappings?: {
          [k: string]: any;
        };
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'visualization';
      content?: '';
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_visualization_spec?: {
          [k: string]: any;
        };
        deepnote_config_collapsed?: boolean;
        deepnote_chart_height?: number;
        deepnote_chart_filter?: {
          [k: string]: any;
        };
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'button';
      content?: '';
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_button_title?: string;
        deepnote_button_color_scheme?: 'blue' | 'red' | 'neutral' | 'green' | 'yellow';
        deepnote_button_behavior?: 'run' | 'set_variable';
        deepnote_variable_name?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'big-number';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_big_number_title?: string;
        deepnote_big_number_value?: string;
        deepnote_big_number_format?: string;
        deepnote_big_number_comparison_enabled?: boolean;
        deepnote_big_number_comparison_title?: string;
        deepnote_big_number_comparison_value?: string;
        deepnote_big_number_comparison_type?: string;
        deepnote_big_number_comparison_format?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-text';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string;
        deepnote_variable_default_value?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-textarea';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string;
        deepnote_variable_default_value?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-checkbox';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: boolean;
        deepnote_variable_default_value?: boolean;
        deepnote_input_checkbox_label?: string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-select';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string | string[];
        deepnote_variable_default_value?: string | string[];
        deepnote_variable_options?: string[];
        deepnote_variable_custom_options?: string[];
        deepnote_variable_selected_variable?: string;
        deepnote_variable_select_type?: 'from-options' | 'from-variable';
        deepnote_allow_multiple_values?: boolean;
        deepnote_allow_empty_values?: boolean;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-slider';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string;
        deepnote_variable_default_value?: string;
        deepnote_slider_min_value?: number;
        deepnote_slider_max_value?: number;
        deepnote_slider_step?: number;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-date';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string;
        deepnote_variable_default_value?: string;
        deepnote_allow_empty_values?: boolean;
        deepnote_input_date_version?: number;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-date-range';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: [string, string] | string;
        deepnote_variable_default_value?: [string, string] | string;
        [k: string]: any;
      };
    }
  | {
      id: string;
      blockGroup: string;
      sortingKey: string;
      contentHash?: string;
      version?: number;
      executionCount?: number | null;
      executionFinishedAt?: string;
      executionStartedAt?: string;
      outputs?: any[];
      type: 'input-file';
      content?: string;
      metadata?: {
        deepnote_app_is_code_hidden?: boolean;
        deepnote_app_is_output_hidden?: boolean;
        deepnote_app_block_visible?: boolean;
        deepnote_app_block_width?: number;
        deepnote_app_block_group_id?: string | null;
        deepnote_app_block_subgroup_id?: string;
        deepnote_app_block_order?: number;
        allow_embed?: boolean | ('code_output' | 'code' | 'output');
        is_code_hidden?: boolean;
        is_output_hidden?: boolean;
        output_cleared?: boolean;
        execution_start?: number;
        execution_millis?: number;
        source_hash?: string;
        execution_context_id?: string;
        deepnote_cell_height?: number;
        deepnote_output_heights?: (number | null)[];
        deepnote_table_state?: {
          [k: string]: any;
        };
        last_executed_function_notebook_id?: string;
        last_function_run_started_at?: number;
        function_notebook_export_states?: {
          [k: string]: any;
        };
        deepnote_variable_name?: string;
        deepnote_input_label?: string;
        deepnote_variable_value?: string;
        deepnote_allowed_file_extensions?: string;
        [k: string]: any;
      };
    };

export interface DeepnoteFile {
  environment?: {
    customImage?: string;
    hash?: string;
    packages?: {
      [k: string]: string;
    };
    platform?: string;
    python?: {
      environment?: 'uv' | 'conda' | 'venv' | 'poetry' | 'system';
      version?: string;
    };
  };
  execution?: {
    error?: {
      message?: string;
      name?: string;
      traceback?: string[];
    };
    finishedAt?: string;
    inputs?: {
      [k: string]: any;
    };
    startedAt?: string;
    summary?: {
      blocksExecuted?: number;
      blocksFailed?: number;
      blocksSucceeded?: number;
      totalDurationMs?: number;
    };
    triggeredBy?: 'user' | 'schedule' | 'api' | 'ci';
  };
  metadata: {
    checksum?: string;
    createdAt: string;
    exportedAt?: string;
    modifiedAt?: string;
  };
  project: {
    id: string;
    initNotebookId?: string;
    integrations?: {
      id: string;
      name: string;
      type: string;
    }[];
    name: string;
    notebooks: {
      blocks: (
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'markdown';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              deepnote_cell_height?: number;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'image';
            content?: '';
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              deepnote_img_src?: string;
              deepnote_img_width?: 'actual' | '50%' | '75%' | '100%';
              deepnote_img_alignment?: 'left' | 'center' | 'right';
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'separator';
            content?: '';
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-h1';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-h2';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-h3';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-p';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-bullet';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-todo';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              checked?: boolean;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            type: 'text-cell-callout';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              is_collapsed?: boolean;
              formattedRanges?: any[];
              color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'code';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              function_export_name?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'sql';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_return_variable_type?: 'dataframe' | 'query_preview';
              sql_integration_id?: string;
              is_compiled_sql_query_visible?: boolean;
              function_export_name?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'notebook-function';
            content?: '';
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              function_notebook_id: string | null;
              function_notebook_inputs?: {
                [k: string]: any;
              };
              function_notebook_export_mappings?: {
                [k: string]: any;
              };
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'visualization';
            content?: '';
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_visualization_spec?: {
                [k: string]: any;
              };
              deepnote_config_collapsed?: boolean;
              deepnote_chart_height?: number;
              deepnote_chart_filter?: {
                [k: string]: any;
              };
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'button';
            content?: '';
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_button_title?: string;
              deepnote_button_color_scheme?: 'blue' | 'red' | 'neutral' | 'green' | 'yellow';
              deepnote_button_behavior?: 'run' | 'set_variable';
              deepnote_variable_name?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'big-number';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_big_number_title?: string;
              deepnote_big_number_value?: string;
              deepnote_big_number_format?: string;
              deepnote_big_number_comparison_enabled?: boolean;
              deepnote_big_number_comparison_title?: string;
              deepnote_big_number_comparison_value?: string;
              deepnote_big_number_comparison_type?: string;
              deepnote_big_number_comparison_format?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-text';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string;
              deepnote_variable_default_value?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-textarea';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string;
              deepnote_variable_default_value?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-checkbox';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: boolean;
              deepnote_variable_default_value?: boolean;
              deepnote_input_checkbox_label?: string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-select';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string | string[];
              deepnote_variable_default_value?: string | string[];
              deepnote_variable_options?: string[];
              deepnote_variable_custom_options?: string[];
              deepnote_variable_selected_variable?: string;
              deepnote_variable_select_type?: 'from-options' | 'from-variable';
              deepnote_allow_multiple_values?: boolean;
              deepnote_allow_empty_values?: boolean;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-slider';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string;
              deepnote_variable_default_value?: string;
              deepnote_slider_min_value?: number;
              deepnote_slider_max_value?: number;
              deepnote_slider_step?: number;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-date';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string;
              deepnote_variable_default_value?: string;
              deepnote_allow_empty_values?: boolean;
              deepnote_input_date_version?: number;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-date-range';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: [string, string] | string;
              deepnote_variable_default_value?: [string, string] | string;
              [k: string]: any;
            };
          }
        | {
            id: string;
            blockGroup: string;
            sortingKey: string;
            contentHash?: string;
            version?: number;
            executionCount?: number | null;
            executionFinishedAt?: string;
            executionStartedAt?: string;
            outputs?: any[];
            type: 'input-file';
            content?: string;
            metadata?: {
              deepnote_app_is_code_hidden?: boolean;
              deepnote_app_is_output_hidden?: boolean;
              deepnote_app_block_visible?: boolean;
              deepnote_app_block_width?: number;
              deepnote_app_block_group_id?: string | null;
              deepnote_app_block_subgroup_id?: string;
              deepnote_app_block_order?: number;
              allow_embed?: boolean | ('code_output' | 'code' | 'output');
              is_code_hidden?: boolean;
              is_output_hidden?: boolean;
              output_cleared?: boolean;
              execution_start?: number;
              execution_millis?: number;
              source_hash?: string;
              execution_context_id?: string;
              deepnote_cell_height?: number;
              deepnote_output_heights?: (number | null)[];
              deepnote_table_state?: {
                [k: string]: any;
              };
              last_executed_function_notebook_id?: string;
              last_function_run_started_at?: number;
              function_notebook_export_states?: {
                [k: string]: any;
              };
              deepnote_variable_name?: string;
              deepnote_input_label?: string;
              deepnote_variable_value?: string;
              deepnote_allowed_file_extensions?: string;
              [k: string]: any;
            };
          }
      )[];
      executionMode?: 'block' | 'downstream';
      id: string;
      isModule?: boolean;
      name: string;
      workingDirectory?: string;
    }[];
    settings?: {
      environment?: {
        customImage?: string;
        pythonVersion?: string;
      };
      requirements?: string[];
      sqlCacheMaxAge?: number;
    };
  };
  version: string;
}

export type Environment =
  | {
      [k: string]: any;
    }
  | {
      customImage?: string;
      hash?: string;
      packages?: {
        [k: string]: string;
      };
      platform?: string;
      python?: {
        environment?: 'uv' | 'conda' | 'venv' | 'poetry' | 'system';
        version?: string;
      };
    };

export type Execution =
  | {
      [k: string]: any;
    }
  | {
      error?: {
        message?: string;
        name?: string;
        traceback?: string[];
      };
      finishedAt?: string;
      inputs?: {
        [k: string]: any;
      };
      startedAt?: string;
      summary?: {
        blocksExecuted?: number;
        blocksFailed?: number;
        blocksSucceeded?: number;
        totalDurationMs?: number;
      };
      triggeredBy?: 'user' | 'schedule' | 'api' | 'ci';
    };

export type ExecutionSummary =
  | {
      [k: string]: any;
    }
  | {
      blocksExecuted?: number;
      blocksFailed?: number;
      blocksSucceeded?: number;
      totalDurationMs?: number;
    };

export type ExecutionError =
  | {
      [k: string]: any;
    }
  | {
      message?: string;
      name?: string;
      traceback?: string[];
    };
