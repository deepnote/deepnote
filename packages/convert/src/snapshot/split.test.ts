import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { generateSnapshotFilename, hasOutputs, slugifyProjectName, splitDeepnoteFile } from './split'

describe('slugifyProjectName', () => {
  it('should convert to lowercase', () => {
    expect(slugifyProjectName('My Project')).toBe('my-project')
  })

  it('should replace spaces with hyphens', () => {
    expect(slugifyProjectName('customer analysis')).toBe('customer-analysis')
  })

  it('should replace special characters with hyphens', () => {
    expect(slugifyProjectName('project@v2.0')).toBe('project-v2-0')
  })

  it('should remove consecutive hyphens', () => {
    expect(slugifyProjectName('my---project')).toBe('my-project')
  })

  it('should trim leading and trailing hyphens', () => {
    expect(slugifyProjectName('-my-project-')).toBe('my-project')
  })

  it('should handle unicode characters', () => {
    expect(slugifyProjectName('Café Project')).toBe('caf-project')
  })

  it('should handle empty string', () => {
    expect(slugifyProjectName('')).toBe('')
  })
})

describe('generateSnapshotFilename', () => {
  it('should generate filename with latest timestamp by default', () => {
    const filename = generateSnapshotFilename('my-project', '2e814690-4f02-465c-8848-5567ab9253b7')
    expect(filename).toBe('my-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote')
  })

  it('should generate filename with custom timestamp', () => {
    const filename = generateSnapshotFilename(
      'my-project',
      '2e814690-4f02-465c-8848-5567ab9253b7',
      '2025-01-08T10-30-00'
    )
    expect(filename).toBe('my-project_2e814690-4f02-465c-8848-5567ab9253b7_2025-01-08T10-30-00.snapshot.deepnote')
  })
})

describe('splitDeepnoteFile', () => {
  const createFileWithOutputs = (): DeepnoteFile => ({
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    environment: { hash: 'env-123' },
    execution: { startedAt: '2025-01-01T00:00:00Z', finishedAt: '2025-01-01T00:01:00Z' },
    project: {
      id: 'proj-123',
      name: 'Test Project',
      notebooks: [
        {
          id: 'nb-1',
          name: 'Notebook',
          blocks: [
            {
              id: 'block-1',
              type: 'code',
              blockGroup: 'bg-1',
              sortingKey: '0000',
              content: 'print("hello")',
              executionCount: 1,
              executionStartedAt: '2025-01-01T00:00:00Z',
              executionFinishedAt: '2025-01-01T00:00:01Z',
              outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
              metadata: {},
            },
            {
              id: 'block-2',
              type: 'markdown',
              blockGroup: 'bg-2',
              sortingKey: '0001',
              content: '# Hello',
              metadata: {},
            },
          ],
        },
      ],
    },
  })

  it('should split file into source and snapshot', () => {
    const file = createFileWithOutputs()
    const { source, snapshot } = splitDeepnoteFile(file)

    expect(source).toBeDefined()
    expect(snapshot).toBeDefined()
  })

  it('should remove outputs from source', () => {
    const file = createFileWithOutputs()
    const { source } = splitDeepnoteFile(file)

    const codeBlock = source.project.notebooks[0].blocks[0]
    expect(codeBlock).not.toHaveProperty('outputs')
    expect(codeBlock).not.toHaveProperty('executionCount')
    expect(codeBlock).not.toHaveProperty('executionStartedAt')
    expect(codeBlock).not.toHaveProperty('executionFinishedAt')
  })

  it('should preserve outputs in snapshot', () => {
    const file = createFileWithOutputs()
    const { snapshot } = splitDeepnoteFile(file)

    const codeBlock = snapshot.project.notebooks[0].blocks[0] as {
      outputs?: unknown[]
      executionCount?: number
    }
    expect(codeBlock.outputs).toHaveLength(1)
    expect(codeBlock.executionCount).toBe(1)
  })

  it('should add content hashes to blocks', () => {
    const file = createFileWithOutputs()
    const { source, snapshot } = splitDeepnoteFile(file)

    expect(source.project.notebooks[0].blocks[0].contentHash).toMatch(/^sha256:[a-f0-9]+$/)
    expect(snapshot.project.notebooks[0].blocks[0].contentHash).toMatch(/^sha256:[a-f0-9]+$/)
  })

  it('should add snapshotHash to snapshot metadata', () => {
    const file = createFileWithOutputs()
    const { snapshot } = splitDeepnoteFile(file)

    expect(snapshot.metadata.snapshotHash).toMatch(/^sha256:[a-f0-9]+$/)
  })

  it('should preserve non-executable blocks unchanged', () => {
    const file = createFileWithOutputs()
    const { source } = splitDeepnoteFile(file)

    const markdownBlock = source.project.notebooks[0].blocks[1]
    expect(markdownBlock.content).toBe('# Hello')
    expect(markdownBlock.type).toBe('markdown')
  })

  it('should preserve environment in snapshot', () => {
    const file = createFileWithOutputs()
    const { snapshot } = splitDeepnoteFile(file)

    expect(snapshot.environment).toEqual({ hash: 'env-123' })
  })

  it('should preserve execution info in snapshot', () => {
    const file = createFileWithOutputs()
    const { snapshot } = splitDeepnoteFile(file)

    expect(snapshot.execution).toEqual({
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T00:01:00Z',
    })
  })
})

describe('hasOutputs', () => {
  it('should return true if file has outputs', () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'nb-1',
            name: 'Notebook',
            blocks: [
              {
                id: 'block-1',
                type: 'code',
                blockGroup: 'bg-1',
                sortingKey: '0000',
                content: 'print("hello")',
                outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    expect(hasOutputs(file)).toBe(true)
  })

  it('should return false if file has no outputs', () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'nb-1',
            name: 'Notebook',
            blocks: [
              {
                id: 'block-1',
                type: 'code',
                blockGroup: 'bg-1',
                sortingKey: '0000',
                content: 'print("hello")',
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    expect(hasOutputs(file)).toBe(false)
  })

  it('should return false if outputs array is empty', () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'nb-1',
            name: 'Notebook',
            blocks: [
              {
                id: 'block-1',
                type: 'code',
                blockGroup: 'bg-1',
                sortingKey: '0000',
                content: 'print("hello")',
                outputs: [],
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    expect(hasOutputs(file)).toBe(false)
  })
})
