import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { collectRequiredIntegrationIds } from './collect-integrations'

/**
 * Build a DeepnoteFile whose single notebook contains one SQL block per provided
 * integration ID. An `undefined` entry produces an SQL block with no
 * sql_integration_id metadata (used to exercise the no-id path).
 */
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
          blocks: integrationIds.map((id, index) => ({
            id: `block${index}`,
            type: 'sql',
            content: 'SELECT 1',
            metadata: id === undefined ? {} : { sql_integration_id: id },
            sortingKey: String(index).padStart(5, '0'),
          })),
        },
      ],
    },
  } as DeepnoteFile
}

describe('collectRequiredIntegrationIds', () => {
  it('collects a single external integration once', () => {
    const file = makeFileWithSqlBlocks(['my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['my-warehouse'])
  })

  it('excludes built-in integrations case-insensitively', () => {
    const file = makeFileWithSqlBlocks(['Pandas-DataFrame', 'deepnote-dataframe-sql', 'My-Warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['My-Warehouse'])
  })

  it('dedupes a mixed-case external integration to its first-seen casing', () => {
    const file = makeFileWithSqlBlocks(['My-Warehouse', 'my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['My-Warehouse'])
  })

  it('keeps genuinely different external integrations distinct (no over-merge)', () => {
    const file = makeFileWithSqlBlocks(['warehouse-a', 'warehouse-b'])
    expect(collectRequiredIntegrationIds(file).sort()).toEqual(['warehouse-a', 'warehouse-b'])
  })

  it('ignores SQL blocks without an integration id', () => {
    const file = makeFileWithSqlBlocks([undefined, 'my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['my-warehouse'])
  })

  it('capstone: collects a mixed-case external integration once, first-seen casing', () => {
    const file = makeFileWithSqlBlocks(['My-Warehouse', 'my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['My-Warehouse'])
  })

  it('capstone (combined): built-in filtered out, external deduped to first-seen casing', () => {
    const file = makeFileWithSqlBlocks(['Pandas-DataFrame', 'My-Warehouse', 'my-warehouse'])
    expect(collectRequiredIntegrationIds(file)).toEqual(['My-Warehouse'])
  })
})
