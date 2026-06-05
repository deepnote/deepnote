import { dedent } from 'ts-dedent'

import type { CodeBlock, SqlBlock } from '../deepnote-file/deepnote-file-schema'
import { escapePythonString } from './python-utils'

export function createDataFrameConfig(block: CodeBlock | SqlBlock): string {
  const tableState = block.metadata?.deepnote_table_state ?? {}
  const tableStateAsJson = JSON.stringify(tableState)

  return dedent`
    if '_dntk' in globals():
      _dntk.dataframe_utils.configure_dataframe_formatter(${escapePythonString(tableStateAsJson)})
    else:
      _deepnote_current_table_attrs = ${escapePythonString(tableStateAsJson)}
  `
}
