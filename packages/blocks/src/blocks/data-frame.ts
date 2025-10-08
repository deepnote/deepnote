import { dedent } from 'ts-dedent'

import type { CodeBlock } from './code-blocks'
import { escapePythonString } from './python-utils'
import type { SqlBlock } from './sql-blocks'

export function createDataFrameConfig(block: CodeBlock | SqlBlock): string {
  const rawTableState = 'deepnote_table_state' in block.metadata ? block.metadata.deepnote_table_state : {}
  const tableState = rawTableState ?? {}
  const tableStateAsJson = JSON.stringify(tableState) ?? '{}'

  return dedent`
    if '_dntk' in globals():
      _dntk.dataframe_utils.configure_dataframe_formatter(${escapePythonString(tableStateAsJson)})
    else:
      _deepnote_current_table_attrs = ${escapePythonString(tableStateAsJson)}
  `
}
