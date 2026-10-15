import { dedent } from 'ts-dedent'

import type { DeepnoteBlock, PivotTableBlock } from '../deepnote-file/deepnote-file-schema'
import { escapePythonString, sanitizePythonVariableName } from './python-utils'

const PIVOT_TABLE_DATA_PREVIEW_SIZE = 10_000
const PIVOT_TABLE_OUTPUT_MIME_TYPE = 'application/vnd.deepnote.pivot-table.v1+json'

export function createPythonCodeForPivotTableBlock(block: PivotTableBlock): string {
  // A name that sanitizes to nothing must not fall back to `input_1`: the pivot reads the variable
  // rather than defining it, so a fallback name would point at a variable the kernel doesn't have.
  const variableName = sanitizePythonVariableName(block.metadata?.deepnote_variable_name ?? '', {
    disableEmptyFallback: true,
  })
  if (!variableName) {
    return ''
  }

  return dedent`
    import json as _deepnote_json
    from IPython.display import display as _deepnote_display

    _deepnote_display(
      {
        ${escapePythonString(PIVOT_TABLE_OUTPUT_MIME_TYPE)}: _deepnote_json.loads(_dntk.deepnote_get_data_preview_json(${variableName}, '[]', [], ${PIVOT_TABLE_DATA_PREVIEW_SIZE}, "sampled"))
      },
      raw=True
    )
  `
}

export function isPivotTableBlock(block: DeepnoteBlock): block is PivotTableBlock {
  return block.type === 'pivot-table'
}
