import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDeepnoteFile } from '../utils'
import { handleWritingTool } from './writing'

describe('writing tools handlers', () => {
  let tempDir: string
  let testNotebookPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-writing-test-'))
    testNotebookPath = path.join(tempDir, 'test.deepnote')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('deepnote_create assigns unique blockGroup per block', async () => {
    await handleWritingTool('deepnote_create', {
      outputPath: testNotebookPath,
      projectName: 'Test Project',
      notebooks: [
        {
          name: 'Notebook',
          blocks: [
            { type: 'code', content: 'print("one")' },
            { type: 'markdown', content: '# two' },
            { type: 'code', content: 'print("three")' },
          ],
        },
      ],
    })

    const file = await loadDeepnoteFile(testNotebookPath)
    const blocks = file.project.notebooks[0].blocks
    const groups = blocks.map(block => block.blockGroup)
    expect(new Set(groups).size).toBe(blocks.length)
  })

  it('deepnote_add_block uses a new blockGroup instead of reusing existing group', async () => {
    await handleWritingTool('deepnote_create', {
      outputPath: testNotebookPath,
      projectName: 'Test Project',
      notebooks: [
        {
          name: 'Notebook',
          blocks: [{ type: 'code', content: 'print("hello")' }],
        },
      ],
    })

    const before = await loadDeepnoteFile(testNotebookPath)
    const existingGroup = before.project.notebooks[0].blocks[0].blockGroup

    await handleWritingTool('deepnote_add_block', {
      path: testNotebookPath,
      notebook: 'Notebook',
      block: { type: 'markdown', content: 'new block' },
    })

    const after = await loadDeepnoteFile(testNotebookPath)
    const addedBlock = after.project.notebooks[0].blocks[1]
    expect(addedBlock.blockGroup).not.toBe(existingGroup)
  })

  it('deepnote_add_notebook assigns unique blockGroup per block in new notebook', async () => {
    await handleWritingTool('deepnote_create', {
      outputPath: testNotebookPath,
      projectName: 'Test Project',
      notebooks: [{ name: 'Main', blocks: [] }],
    })

    await handleWritingTool('deepnote_add_notebook', {
      path: testNotebookPath,
      name: 'Second',
      blocks: [
        { type: 'code', content: 'x = 1' },
        { type: 'code', content: 'y = x + 1' },
      ],
    })

    const file = await loadDeepnoteFile(testNotebookPath)
    const newNotebook = file.project.notebooks.find(notebook => notebook.name === 'Second')
    expect(newNotebook).toBeDefined()
    const groups = (newNotebook?.blocks ?? []).map(block => block.blockGroup)
    expect(new Set(groups).size).toBe(groups.length)
  })
})
