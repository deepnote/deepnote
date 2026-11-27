// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DeepnoteNotebookResponse, DeepnoteSnapshotBlock } from './index'

describe('index', () => {
  it('loads in Node without a DOM', async () => {
    await expect(import('./index')).resolves.toBeDefined()
  })

  it('exports the path where the page origin mints API tokens', async () => {
    const { STATIC_FILES_API_TOKEN_PATH } = await import('./index')
    expect(STATIC_FILES_API_TOKEN_PATH).toBe('/__deepnote/api-token')
  })
})

// Compile-only: `pnpm typecheck` fails if the types reject what the API sends.
const _notebookWithInputWithoutValue = {
  notebook: { inputs: [{ blockId: 'b1', name: 'threshold', type: 'input-slider' }] },
} satisfies DeepnoteNotebookResponse

const streamOutput = { output_type: 'stream', name: 'stdout', text: 'done\n' }
const errorOutput = { output_type: 'error', ename: 'ValueError', evalue: 'bad input', traceback: [] }
const displayDataOutput = { output_type: 'display_data', data: { 'application/json': { total: 1 } }, metadata: {} }
const _blockWithOutputsWithoutData = {
  id: 'b2',
  type: 'code',
  outputs: [streamOutput, errorOutput, displayDataOutput],
  metadata: {},
} satisfies DeepnoteSnapshotBlock
