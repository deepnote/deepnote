import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deepnoteFileSchema } from './deepnote-file-schema'
import { deserializeDeepnoteFile } from './deserialize-deepnote-file'

describe('llm block in deepnote file', () => {
  it('parses the llm-block test fixture', () => {
    const fixturePath = path.join(__dirname, '../../../../test-fixtures/llm-block.deepnote')
    const content = fs.readFileSync(fixturePath, 'utf-8')
    const file = deserializeDeepnoteFile(content)

    expect(file.project.name).toBe('LLM Block Test')
    expect(file.project.settings?.mcpServers).toHaveLength(1)
    expect(file.project.settings?.mcpServers?.[0]?.name).toBe('filesystem')

    const notebook = file.project.notebooks[0]
    expect(notebook?.blocks).toHaveLength(3)

    const llmBlock = notebook?.blocks.find(b => b.type === 'llm')
    expect(llmBlock).toBeDefined()
    expect(llmBlock?.content).toContain('Analyze the DataFrame')

    if (llmBlock?.type === 'llm') {
      expect(llmBlock.metadata.deepnote_model).toBe('gpt-4o')
      expect(llmBlock.metadata.deepnote_max_iterations).toBe(5)
    }
  })

  it('validates project-level mcpServers in settings', () => {
    const result = deepnoteFileSchema.safeParse({
      version: '1.0.0',
      metadata: { createdAt: '2026-01-01T00:00:00Z' },
      project: {
        id: 'test',
        name: 'Test',
        settings: {
          mcpServers: [
            { name: 'test-server', command: 'python', args: ['-m', 'server'] },
            { name: 'another', command: 'npx', env: { KEY: 'val' } },
          ],
        },
        notebooks: [],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.project.settings?.mcpServers).toHaveLength(2)
    }
  })
})
