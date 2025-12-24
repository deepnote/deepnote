import assert from 'node:assert'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it, vi } from 'vitest'
import { getDAGForBlocks, getDownstreamBlocks } from './dag'
import { getDownstreamBlocksForBlocksIds } from './dag-analyzer'

const DATAFRAME_SQL_INTEGRATION_ID = 'dataframe-sql-integration'

vi.mock('./dag-analyzer', () => ({
  getDownstreamBlocksForBlocksIds: vi.fn().mockReturnValue(['2', '4']),
}))

function createBlocks(
  blocks: {
    id: string
    type: string
    content: string
    metadata?: Record<string, unknown>
  }[]
): DeepnoteBlock[] {
  return blocks.map(block => ({
    blockGroup: 'default',
    sortingKey: '0',
    ...block,
  })) as DeepnoteBlock[]
}

describe('DAG', () => {
  describe('getDAGForBlocks', () => {
    it('should return an empty edges/nodes when given an empty array of blocks', async () => {
      const { dag } = await getDAGForBlocks([])

      expect(dag).toEqual({
        edges: [],
        nodes: [],
        modulesEdges: [],
      })
    })

    it('should throw SyntaxError when there is invalid code', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'notValidPythonCode = **42 <<<',
        },
      ])

      await expect(getDAGForBlocks(blocks, { acceptPartialDAG: false })).rejects.toThrow(SyntaxError)
    })

    it('should not throw SyntaxError when there is invalid code but we accept partial DAG', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'notValidPythonCode = **42 <<<',
        },
      ])

      await expect(getDAGForBlocks(blocks, { acceptPartialDAG: true })).resolves.toBeTruthy()
    })

    it('should return partial DAG when there is error', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
        {
          id: '2',
          type: 'code',
          content: 'c = a + b',
        },
        {
          id: '3',
          type: 'code',
          content: 'print("nothing here")',
        },
        {
          id: '4',
          type: 'code',
          content: 'd = c + 3',
        },
        { id: '5', type: 'code', content: 'notValidPythonCode = **42 <<<\nprint(d)' },
      ])

      const { dag } = await getDAGForBlocks(blocks, { acceptPartialDAG: true })

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['a'], 'to': '2' }),
          expect.objectContaining({ from: '1', inputVariables: ['b'], 'to': '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['c'], 'to': '4' }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: expect.arrayContaining(['a', 'b']),
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: expect.arrayContaining(['a', 'b']),
            outputVariables: ['c'],
          }),
          expect.objectContaining({
            id: '4',
            inputVariables: ['c'],
            outputVariables: ['d'],
          }),
          expect.objectContaining({
            id: '5',
            inputVariables: [],
            outputVariables: [],
            error: {
              message: expect.any(String),
              type: 'SyntaxError',
            },
          }),
        ]),
      })
    })

    it('should not crash when there are invalid blocks', async () => {
      const blocks = [
        {
          id: '1',
          type: 'code',
          noValidDataBro: 42,
        },
      ]

      // @ts-expect-error skipping all required properties in `blocks`
      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        edges: [],
        nodes: [
          expect.objectContaining({
            id: '1',
          }),
        ],
        modulesEdges: [],
      })
    })

    it('should return a DAG for simple Python blocks', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
        {
          id: '2',
          type: 'code',
          content: 'c = a + b',
        },
        {
          id: '3',
          type: 'code',
          content: 'print("nothing here")',
        },
        {
          id: '4',
          type: 'code',
          content: 'd = c + 3',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['a'], 'to': '2' }),
          expect.objectContaining({ from: '1', inputVariables: ['b'], 'to': '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['c'], 'to': '4' }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: expect.arrayContaining(['a', 'b']),
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: expect.arrayContaining(['a', 'b']),
            outputVariables: ['c'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: [],
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '4',
            inputVariables: ['c'],
            outputVariables: ['d'],
          }),
        ]),
      })
    })

    it('should return DAG for notebook function blocks', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'test_variable = 42',
        },
        {
          id: '2',
          type: 'code',
          content: 'another_variable = 42',
        },
        {
          id: '3',
          type: 'notebook-function',
          content: '',
          metadata: {
            function_notebook_id: 'connected-notebook-id',
            function_notebook_inputs: {
              'input_1': { custom_value: null, variable_name: 'test_variable' },
              'input_2': { custom_value: null, variable_name: 'another_variable' },
              'input_3': { custom_value: 'custom_value', variable_name: null },
            },
            function_notebook_export_mappings: {
              'output_1': { enabled: true, variable_name: 'imported_1' },
              'output_2': { enabled: true, variable_name: 'imported_2' },
              'output_3': { enabled: false, variable_name: 'imported_3' },
            },
          },
        },
        {
          id: '4',
          type: 'code',
          content: 'print(imported_1 + imported_2)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({
            from: '1',
            inputVariables: ['test_variable'],
            'to': '3',
          }),
          expect.objectContaining({
            from: '2',
            inputVariables: ['another_variable'],
            'to': '3',
          }),
          expect.objectContaining({
            from: '3',
            inputVariables: ['imported_1'],
            'to': '4',
          }),
          expect.objectContaining({
            from: '3',
            inputVariables: ['imported_2'],
            'to': '4',
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['test_variable'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['another_variable'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: expect.arrayContaining(['test_variable', 'another_variable']),
            outputVariables: expect.arrayContaining(['imported_1', 'imported_2']),
          }),
          expect.objectContaining({
            id: '4',
            inputVariables: expect.arrayContaining(['imported_1', 'imported_2']),
            outputVariables: [],
          }),
        ]),
      })
    })

    it('should sanitize variable names in DAG for notebook function blocks', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'test_variable = 42',
        },
        {
          id: '2',
          type: 'code',
          content: 'another_variable = 42',
        },
        {
          id: '3',
          type: 'notebook-function',
          content: '',
          metadata: {
            function_notebook_id: 'connected-notebook-id',
            function_notebook_inputs: {
              'input_1': { custom_value: null, variable_name: 'test variable' },
              'input_2': { custom_value: null, variable_name: 'another_variable!' },
              'input_3': { custom_value: 'custom_value', variable_name: null },
            },
            function_notebook_export_mappings: {
              'output_1': { enabled: true, variable_name: 'imported variable!' },
            },
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({
            from: '1',
            inputVariables: ['test_variable'],
            'to': '3',
          }),
          expect.objectContaining({
            from: '2',
            inputVariables: ['another_variable'],
            'to': '3',
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['test_variable'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['another_variable'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: expect.arrayContaining(['test_variable', 'another_variable']),
            outputVariables: ['imported_variable'],
          }),
        ]),
      })
    })

    it('should return DAG for Big Number block', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'test_variable = 42',
        },
        {
          id: '2',
          type: 'code',
          content: 'another_variable = 42',
        },
        {
          id: '3',
          type: 'big-number',
          content: '',
          metadata: {
            deepnote_big_number_title: 'Title',
            // TODO: handle this as well
            // deepnote_big_number_title: 'Title {{ title_variable }}',
            deepnote_big_number_value: 'test_variable',
            deepnote_big_number_comparison_value: 'another_variable',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({
            from: '1',
            inputVariables: ['test_variable'],
            'to': '3',
          }),
          expect.objectContaining({
            from: '2',
            inputVariables: ['another_variable'],
            'to': '3',
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['test_variable'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['another_variable'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: expect.arrayContaining(['test_variable', 'another_variable']),
            outputVariables: [],
          }),
        ]),
      })
    })

    it('should return DAG for Button block', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'button',
          content: '',
          metadata: {
            deepnote_button_behavior: 'set_variable',
            deepnote_variable_name: 'button_1',
            deepnote_button_title: 'Submit',
            deepnote_button_color_schema: 'red',
          },
        },
        {
          id: '2',
          type: 'code',
          content: 'if button_1:\n  print("Button clicked!")',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['button_1'], 'to': '2' }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['button_1'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['button_1'],
          }),
        ]),
      })
    })

    it('should return a DAG for Python variable in SQL block', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'test = 42',
        },
        {
          id: '2',
          type: 'sql',
          content: 'SELECT * FROM users WHERE id = {{ test }}',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([expect.objectContaining({ from: '1', inputVariables: ['test'], 'to': '2' })]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['test'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['test'],
            outputVariables: [],
          }),
        ]),
      })
    })

    it('should return a DAG for SQL block', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'sql',
          content: 'SELECT * FROM users WHERE id = {{ test }}',
          metadata: {
            deepnote_variable_name: 'df_1',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: [],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            inputVariables: [],
            outputVariables: ['df_1'],
          }),
        ]),
      })
    })

    it('should return a DAG for SQL block with jinja loop and conditions', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'code',
          content: `column_names = []\nstation_name='USW00094728'`,
        },
        {
          id: '1',
          type: 'sql',
          content: `SELECT date, name, {% for col in column_names %}{% if not loop.last %}{{ col | sqlsafe }}, {% else %}{{ col | sqlsafe }}{% endif %}{% endfor %} FROM fh-bigquery.weather_gsod.all WHERE date > '2015-12-31'  and name = {{ station_name }} ORDER BY date DESC LIMIT 5`,
          metadata: {
            deepnote_variable_name: 'df_1',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: expect.arrayContaining([
          expect.objectContaining({
            from: '0',
            inputVariables: ['column_names'],
            to: '1',
          }),
          expect.objectContaining({
            from: '0',
            inputVariables: ['station_name'],
            to: '1',
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            inputVariables: [],
            outputVariables: expect.arrayContaining(['column_names', 'station_name']),
          }),
          expect.objectContaining({
            id: '1',
            inputVariables: expect.arrayContaining(['column_names', 'station_name']),
            outputVariables: ['df_1'],
          }),
        ]),
      })
    })

    it('should return a DAG for SQL Dataframe block that refers dfs defined in code block and uses jinja statements and expressions', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'code',
          content: 'import pandas as pd',
        },
        {
          id: '1',
          type: 'code',
          content: 'users = pd.DataFrame({"id": [1, 2, 3]})\nsome_id = 42\ncondition_string = "test"',
        },
        {
          id: '2',
          type: 'sql',
          content: `
          SELECT *
          FROM users WHERE id = {{ some_id }}
          {% if condition_string == 'test' %}
              AND users.name NOT LIKE 'internal%'
          {% endif %}
          `,
          metadata: {
            sql_integration_id: DATAFRAME_SQL_INTEGRATION_ID,
            deepnote_variable_name: 'df_1',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: expect.arrayContaining([expect.objectContaining({ from: '0', inputVariables: ['pd'], to: '1' })]),
        edges: expect.arrayContaining([expect.objectContaining({ from: '1', inputVariables: ['users'], to: '2' })]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            importedModules: ['pd'],
            inputVariables: [],
            outputVariables: [],
            usedImportedModules: [],
          }),
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: expect.arrayContaining(['some_id', 'users', 'condition_string']),
            usedImportedModules: ['pd'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: expect.arrayContaining(['some_id', 'users', 'condition_string']),
            outputVariables: ['df_1'],
            importedModules: [],
            usedImportedModules: [],
          }),
        ]),
      })
    })
    it('should return a DAG for SQL Dataframe block that refers dfs defined in code block', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'code',
          content: 'import pandas as pd',
        },
        {
          id: '1',
          type: 'code',
          content: 'users = pd.DataFrame({"id": [1, 2, 3]})',
        },
        {
          id: '2',
          type: 'sql',
          content: "SELECT * FROM users WHERE id = '1'",
          metadata: {
            sql_integration_id: DATAFRAME_SQL_INTEGRATION_ID,
            deepnote_variable_name: 'df_1',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: expect.arrayContaining([expect.objectContaining({ from: '0', inputVariables: ['pd'], to: '1' })]),
        edges: expect.arrayContaining([expect.objectContaining({ from: '1', inputVariables: ['users'], to: '2' })]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            importedModules: ['pd'],
            inputVariables: [],
            outputVariables: [],
            usedImportedModules: [],
          }),
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['users'],
            usedImportedModules: ['pd'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['users'],
            outputVariables: ['df_1'],
            importedModules: [],
            usedImportedModules: [],
          }),
        ]),
      })
    })

    it('should return a DAG for SQL Dataframe block that refers another SQL Dataframe and also df from code', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'code',
          content: 'import pandas as pd',
        },
        {
          id: '1',
          type: 'code',
          content: 'users = pd.DataFrame({"id": [1, 2, 3]})',
        },
        {
          id: '2',
          type: 'sql',
          content: "SELECT * FROM users WHERE id = '1'",
          metadata: {
            sql_integration_id: DATAFRAME_SQL_INTEGRATION_ID,
            deepnote_variable_name: 'df_1',
          },
        },
        {
          id: '3',
          type: 'sql',
          content: 'SELECT * FROM users JOIN df_1 ON df_1.id = users.id',
          metadata: {
            sql_integration_id: DATAFRAME_SQL_INTEGRATION_ID,
            deepnote_variable_name: 'df_2',
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: expect.arrayContaining([expect.objectContaining({ from: '0', inputVariables: ['pd'], to: '1' })]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['users'], to: '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['df_1'], to: '3' }),
          expect.objectContaining({ from: '2', inputVariables: ['users'], to: '3' }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            importedModules: ['pd'],
            inputVariables: [],
            outputVariables: [],
            usedImportedModules: [],
          }),
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['users'],
            usedImportedModules: ['pd'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['users'],
            outputVariables: expect.arrayContaining(['users', 'df_1']),
            importedModules: [],
            usedImportedModules: [],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: expect.arrayContaining(['users', 'df_1']),
            outputVariables: ['df_2'],
            importedModules: [],
            usedImportedModules: [],
          }),
        ]),
      })
    })

    it('should return a DAG for numpy array mutation', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'import numpy as np\narr = np.array([1, 2, 3, 4, 5])',
        },
        {
          id: '2',
          type: 'code',
          content: 'arr[2] = 10',
        },
        {
          id: '3',
          type: 'code',
          content: 'arr = np.append(arr, 6)',
        },
        {
          id: '4',
          type: 'code',
          content: 'reshaped_arr = arr.reshape(2, 3)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: expect.arrayContaining([
          expect.objectContaining({
            from: '1',
            to: '3',
            inputVariables: ['np'],
          }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['arr'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['arr'],
            outputVariables: ['arr'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['arr'],
            outputVariables: ['arr'],
          }),
          expect.objectContaining({
            id: '4',
            inputVariables: ['arr'],
            outputVariables: ['reshaped_arr'],
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['arr'], to: '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['arr'], to: '3' }),
          expect.objectContaining({ from: '3', inputVariables: ['arr'], to: '4' }),
        ]),
      })
    })

    it('should return a DAG for Class', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'class MyClass: x = 5',
        },
        {
          id: '2',
          type: 'code',
          content: 'p1 = MyClass()',
        },
        {
          id: '3',
          type: 'code',
          content: 'print(p1.x)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['MyClass'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['MyClass'],
            outputVariables: ['p1'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['p1'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['MyClass'], to: '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['p1'], to: '3' }),
        ]),
      })
    })

    it('should return a DAG for function', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'def test(a): print(a)',
        },
        {
          id: '2',
          type: 'code',
          content: 'my_var = 42',
        },
        {
          id: '3',
          type: 'code',
          content: 'test(my_var)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['test'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['my_var'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: expect.arrayContaining(['my_var', 'test']),
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '2', inputVariables: ['my_var'], to: '3' }),
          expect.objectContaining({ from: '1', inputVariables: ['test'], to: '3' }),
        ]),
      })
    })

    it('should return a DAG for global variable', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'num = 3',
        },
        {
          id: '2',
          type: 'code',
          content: `def test(a):\n  global num\n  print(a + num)`,
        },
        {
          id: '3',
          type: 'code',
          content: 'test(2)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: ['num'],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: ['num'],
            outputVariables: ['test'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['test'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '1', inputVariables: ['num'], to: '2' }),
          expect.objectContaining({ from: '2', inputVariables: ['test'], to: '3' }),
        ]),
      })
    })

    it('should return a DAG with imported modules', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'import pandas as pd',
        },
        {
          id: '2',
          type: 'code',
          content: `test = pd.DataFrame({'a': [1, 2, 3]})`,
        },
        {
          id: '3',
          type: 'code',
          content: 'print(test)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            importedModules: ['pd'],
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['test'],
            usedImportedModules: ['pd'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['test'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([expect.objectContaining({ from: '2', inputVariables: ['test'], to: '3' })]),
        modulesEdges: expect.arrayContaining([expect.objectContaining({ from: '1', to: '2', inputVariables: ['pd'] })]),
      })
    })

    it('should return a DAG with imported modules (imported with from)', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'from pandas import pd',
        },
        {
          id: '2',
          type: 'code',
          content: `test = pd.DataFrame({'a': [1, 2, 3]})`,
        },
        {
          id: '3',
          type: 'code',
          content: 'print(test)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            importedModules: ['pd'],
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['test'],
            usedImportedModules: ['pd'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['test'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([expect.objectContaining({ from: '2', inputVariables: ['test'], to: '3' })]),
        modulesEdges: expect.arrayContaining([expect.objectContaining({ from: '1', to: '2', inputVariables: ['pd'] })]),
      })
    })

    it('should return a DAG with imported modules (simple import)', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'import pandas',
        },
        {
          id: '2',
          type: 'code',
          content: `test = pandas.pd.DataFrame({'a': [1, 2, 3]})`,
        },
        {
          id: '3',
          type: 'code',
          content: 'print(test)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            importedModules: ['pandas'],
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['test'],
            usedImportedModules: ['pandas'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['test'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([expect.objectContaining({ from: '2', inputVariables: ['test'], to: '3' })]),
        modulesEdges: expect.arrayContaining([
          expect.objectContaining({ from: '1', to: '2', inputVariables: ['pandas'] }),
        ]),
      })
    })

    it('should return a DAG with imported modules (mixed import types)', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'import pandas\nfrom numpy import array',
        },
        {
          id: '2',
          type: 'code',
          content: `test = pandas.pd.DataFrame({'a': [1, 2, 3]})`,
        },
        {
          id: '3',
          type: 'code',
          content: 'print(test)',
        },
        {
          id: '4',
          type: 'code',
          content: 'arr = array([1, 2, 3])',
        },
        {
          id: '5',
          type: 'code',
          content: 'print(arr)',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            importedModules: expect.arrayContaining(['pandas', 'array']),
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '2',
            inputVariables: [],
            outputVariables: ['test'],
            usedImportedModules: ['pandas'],
          }),
          expect.objectContaining({
            id: '3',
            inputVariables: ['test'],
            outputVariables: [],
          }),
          expect.objectContaining({
            id: '4',
            inputVariables: [],
            usedImportedModules: ['array'],
            outputVariables: ['arr'],
          }),
          expect.objectContaining({
            id: '5',
            inputVariables: ['arr'],
            outputVariables: [],
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ from: '2', inputVariables: ['test'], to: '3' }),
          expect.objectContaining({ from: '4', inputVariables: ['arr'], to: '5' }),
        ]),
        modulesEdges: expect.arrayContaining([
          expect.objectContaining({ from: '1', to: '2', inputVariables: ['pandas'] }),
          expect.objectContaining({ from: '1', to: '4', inputVariables: ['array'] }),
        ]),
      })
    })

    it('should return a DAG for single Python block', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const { dag } = await getDAGForBlocks(blocks)

      expect(dag).toEqual({
        modulesEdges: [],
        edges: [],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            inputVariables: [],
            outputVariables: expect.arrayContaining(['a', 'b']),
          }),
        ]),
      })
    })

    it('should NOT return error when there are missing () in IN operator', async () => {
      const blocks = createBlocks([
        {
          id: '0',
          type: 'code',
          content: 'ids = []',
        },
        {
          id: '1',
          type: 'sql',
          content: 'SELECT *\nFROM df_2\nWHERE id IN {{ ids | inclause }}',
          metadata: {
            sql_integration_id: DATAFRAME_SQL_INTEGRATION_ID,
          },
        },
      ])

      const { dag } = await getDAGForBlocks(blocks, { acceptPartialDAG: true })

      expect(dag).toEqual({
        modulesEdges: [],
        edges: [
          {
            from: '0',
            to: '1',
            inputVariables: ['ids'],
          },
        ],
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: '0',
            inputVariables: [],
            outputVariables: ['ids'],
            error: null,
          }),
          expect.objectContaining({
            id: '1',
            inputVariables: ['ids'],
            outputVariables: [],
            error: null,
          }),
        ]),
      })
    })
  })

  describe('getDownstreamBlocks', () => {
    it('should return downstream blocks for the given blocks', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
        {
          id: '2',
          type: 'code',
          content: 'c = a + b',
        },
        {
          id: '3',
          type: 'code',
          content: 'print("nothing here")',
        },
        {
          id: '4',
          type: 'code',
          content: 'd = c + 3',
        },
      ])

      const blocksToExecute = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const downstreamBlocksDesc = await getDownstreamBlocks(blocks, blocksToExecute)

      expect(downstreamBlocksDesc.status).toBe('success')
      assert(downstreamBlocksDesc.status !== 'fatal', 'Should not be fatal')
      expect(downstreamBlocksDesc.blocksToExecuteWithDeps).toHaveLength(3)
      const expectedIds = ['1', '2', '4']
      expect(downstreamBlocksDesc.blocksToExecuteWithDeps.every(block => expectedIds.includes(block.id))).toBeTruthy()
    })

    it('should compute content dependencies for blocks', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const blocksToExecute = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const downstreamBlocksDesc = await getDownstreamBlocks(blocks, blocksToExecute)

      assert(downstreamBlocksDesc.status !== 'fatal', 'Should not be fatal')
      expect(downstreamBlocksDesc.newlyComputedBlocksContentDeps).toHaveLength(1)
    })

    it('should compute content dependencies for blocks with error', async () => {
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const blocksToExecute = createBlocks([
        {
          id: '1',
          type: 'code',
          content: 'a = 1\nb = 2',
        },
      ])

      const downstreamBlocksDesc = await getDownstreamBlocks(blocks, blocksToExecute)

      assert(downstreamBlocksDesc.status !== 'fatal', 'Should not be fatal')
      expect(downstreamBlocksDesc.newlyComputedBlocksContentDeps).toHaveLength(1)
    })

    it('should return missing-deps status if code block could not be parsed', async () => {
      const content = `
        brokenCode----[()](3šš)
      `
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content,
        },
      ])

      const blocksToExecute = createBlocks([
        {
          id: '1',
          type: 'code',
          content,
        },
      ])

      const downstreamBlocksDesc = await getDownstreamBlocks(blocks, blocksToExecute)

      expect(downstreamBlocksDesc.status).toBe('missing-deps')
    })

    it('should return fatal status if code block could not be parsed', async () => {
      vi.mocked(getDownstreamBlocksForBlocksIds).mockImplementation(() => {
        throw new Error('Error')
      })

      const content = `a = 42`
      const blocks = createBlocks([
        {
          id: '1',
          type: 'code',
          content,
        },
      ])

      const blocksToExecute = createBlocks([
        {
          id: '1',
          type: 'code',
          content,
        },
      ])

      const downstreamBlocksDesc = await getDownstreamBlocks(blocks, blocksToExecute)

      expect(downstreamBlocksDesc.status).toBe('fatal')
      assert(downstreamBlocksDesc.status === 'fatal', 'Should be fatal')
      expect(downstreamBlocksDesc.error).toBeDefined()
    })
  })
})
