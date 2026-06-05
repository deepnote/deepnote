import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import type { CodeBlock, NotebookFunctionBlock } from '../deepnote-file/deepnote-file-schema'
import { createPythonCodeForNotebookFunctionBlock, isNotebookFunctionBlock } from './notebook-function-blocks'

describe('isNotebookFunctionBlock', () => {
  it('returns true for notebook-function blocks', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-123',
      },
    }

    expect(isNotebookFunctionBlock(block)).toBe(true)
  })

  it('returns false for other block types', () => {
    const block: CodeBlock = {
      id: '123',
      type: 'code',
      content: 'print("hello")',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {},
    }

    expect(isNotebookFunctionBlock(block)).toBe(false)
  })
})

describe('createPythonCodeForNotebookFunctionBlock', () => {
  it('generates code for single export', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'efceb59f45724c68b1e39b366bd30ff2',
        function_notebook_inputs: {},
        function_notebook_export_mappings: {
          kpis: {
            enabled: true,
            variable_name: 'kpis',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: efceb59f45724c68b1e39b366bd30ff2
      # Inputs: {}
      # Exports: kpis -> kpis
      kpis = _dntk.run_notebook_function(
          'efceb59f45724c68b1e39b366bd30ff2',
          inputs={},
          export_mappings={"kpis":"kpis"}
      )
    `)
  })

  it('generates code for multiple exports with tuple unpacking', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-456',
        function_notebook_inputs: {},
        function_notebook_export_mappings: {
          data: {
            enabled: true,
            variable_name: 'df',
          },
          stats: {
            enabled: true,
            variable_name: 'statistics',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-456
      # Inputs: {}
      # Exports: data -> df, stats -> statistics
      df, statistics = _dntk.run_notebook_function(
          'notebook-456',
          inputs={},
          export_mappings={"data":"df","stats":"statistics"}
      )
    `)
  })

  it('generates code for no exports', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-789',
        function_notebook_inputs: {},
        function_notebook_export_mappings: {},
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-789
      # Inputs: {}
      # Exports: (none)
      _dntk.run_notebook_function(
          'notebook-789',
          inputs={},
          export_mappings={}
      )
    `)
  })

  it('filters out disabled exports', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-abc',
        function_notebook_inputs: {},
        function_notebook_export_mappings: {
          enabled_export: {
            enabled: true,
            variable_name: 'result',
          },
          disabled_export: {
            enabled: false,
            variable_name: 'ignored',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-abc
      # Inputs: {}
      # Exports: enabled_export -> result
      result = _dntk.run_notebook_function(
          'notebook-abc',
          inputs={},
          export_mappings={"enabled_export":"result"}
      )
    `)
  })

  it('generates placeholder for unconfigured block (null notebook_id)', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: null,
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: Not configured
      pass
    `)
  })

  it('handles export with different variable_name mapping', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-def',
        function_notebook_inputs: {},
        function_notebook_export_mappings: {
          original_name: {
            enabled: true,
            variable_name: 'local_alias',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-def
      # Inputs: {}
      # Exports: original_name -> local_alias
      local_alias = _dntk.run_notebook_function(
          'notebook-def',
          inputs={},
          export_mappings={"original_name":"local_alias"}
      )
    `)
  })

  it('handles inputs with values', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-ghi',
        function_notebook_inputs: {
          param1: 'value1',
          param2: 42,
        },
        function_notebook_export_mappings: {
          output: {
            enabled: true,
            variable_name: 'result',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-ghi
      # Inputs: {"param1":"value1","param2":42}
      # Exports: output -> result
      result = _dntk.run_notebook_function(
          'notebook-ghi',
          inputs={"param1":"value1","param2":42},
          export_mappings={"output":"result"}
      )
    `)
  })

  it('handles missing metadata gracefully', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: 'notebook-jkl',
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    expect(result).toEqual(dedent`
      # Notebook Function: notebook-jkl
      # Inputs: {}
      # Exports: (none)
      _dntk.run_notebook_function(
          'notebook-jkl',
          inputs={},
          export_mappings={}
      )
    `)
  })

  it('escapes special characters in notebook_id', () => {
    const block: NotebookFunctionBlock = {
      id: '123',
      type: 'notebook-function',
      content: '',
      blockGroup: 'abc',
      sortingKey: 'a0',
      metadata: {
        function_notebook_id: "notebook-with'quote",
        function_notebook_inputs: {},
        function_notebook_export_mappings: {
          data: {
            enabled: true,
            variable_name: 'result',
          },
        },
      },
    }

    const result = createPythonCodeForNotebookFunctionBlock(block)

    // The single quote should be escaped in the Python string literal
    expect(result).toContain("'notebook-with\\'quote'")
  })
})
