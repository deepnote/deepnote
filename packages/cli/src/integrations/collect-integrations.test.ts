import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { collectRequiredIntegrationIds } from './collect-integrations'

// Helper to build a DeepnoteFile with one SQL block per provided integration ID.
function makeFileWithSqlBlocks(integrationIds: Array<string | undefined>): DeepnoteFile {
  return {
    version: '1',
    project: {
      id: 'test-project-id',
      name: 'Test Project',
      notebooks: [
        {
          id: 'test-notebook-id',
          name: 'Test Notebook',
          blocks: integrationIds.map((integrationId, index) => ({
            id: `block${index}`,
            type: 'sql',
            content: 'SELECT 1',
            metadata: integrationId === undefined ? {} : { sql_integration_id: integrationId },
            sortingKey: String(index).padStart(5, '0'),
          })),
        },
      ],
    },
  } as DeepnoteFile
}

describe('collectRequiredIntegrationIds', () => {
  it('does not collect a built-in integration referenced with non-canonical casing', () => {
    const file = makeFileWithSqlBlocks(['Pandas-DataFrame'])
    expect(collectRequiredIntegrationIds(file)).toEqual([])
  })

  it('collects a genuine external integration ID preserving its original casing', () => {
    const file = makeFileWithSqlBlocks(['My-Warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['My-Warehouse'])
  })

  it('capstone: returns exactly the external ID when a mixed-case built-in and an external block coexist', () => {
    const file = makeFileWithSqlBlocks(['Deepnote-DataFrame-SQL', 'my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['my-warehouse'])
  })
})
