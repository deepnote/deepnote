import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deserializeDeepnoteFile } from './deserialize-deepnote-file'

describe('validate all .deepnote files in the repository', () => {
  // Use paths relative to workspace root
  const workspaceRoot = join(__dirname, '../../../..')
  const deepnoteFiles = [
    'packages/convert/test-fixtures/All-Deepnote-blocks.deepnote',
    'packages/convert/test-fixtures/ChartExamples.deepnote',
    'examples/1_hello_world.deepnote',
    'examples/2_blocks.deepnote',
    'examples/3_integrations.deepnote',
    'examples/demos/housing_price_prediction.deepnote',
  ]

  for (const filePath of deepnoteFiles) {
    it(`validates ${filePath}`, async () => {
      const fullPath = join(workspaceRoot, filePath)
      const yamlContent = await readFile(fullPath, 'utf-8')

      // Should not throw and return a valid DeepnoteFile object
      // Validates UTF-8, no duplicates, no anchors/aliases/merge keys, no tags
      const result = deserializeDeepnoteFile(yamlContent)

      expect(result).toBeDefined()
      expect(result.version).toBeDefined()
      expect(result.project).toBeDefined()
      expect(result.project.notebooks).toBeInstanceOf(Array)
    })
  }

  it('validates that all .deepnote files meet strict requirements', async () => {
    const results = await Promise.all(
      deepnoteFiles.map(async filePath => {
        const fullPath = join(workspaceRoot, filePath)
        const yamlContent = await readFile(fullPath, 'utf-8')
        const result = deserializeDeepnoteFile(yamlContent)
        return { filePath, result }
      })
    )

    // All files should parse successfully
    expect(results).toHaveLength(deepnoteFiles.length)

    // Check that all files have valid structure
    for (const { filePath, result } of results) {
      expect(result.version, `${filePath} should have version`).toBeDefined()
      expect(result.project, `${filePath} should have project`).toBeDefined()
      expect(result.project.notebooks, `${filePath} should have notebooks`).toBeInstanceOf(Array)
      expect(result.metadata, `${filePath} should have metadata`).toBeDefined()
      expect(result.metadata.createdAt, `${filePath} should have createdAt`).toBeDefined()

      // Verify timestamps are strings (not Date objects)
      expect(typeof result.metadata.createdAt, `${filePath} createdAt should be string`).toBe('string')
    }
  })
})
