import type { DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { countBlocksWithOutputs, mergeSnapshotIntoSource } from './merge'

describe('mergeSnapshotIntoSource', () => {
  const createSource = (): DeepnoteFile => ({
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
              contentHash: 'sha256:abc123',
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

  const createSnapshot = (): DeepnoteSnapshot => ({
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z', snapshotHash: 'sha256:snap123' },
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
              contentHash: 'sha256:abc123',
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

  it('should merge outputs from snapshot into source', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    const codeBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(codeBlock.outputs).toHaveLength(1)
  })

  it('should merge execution metadata', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    const codeBlock = merged.project.notebooks[0].blocks[0] as {
      executionCount?: number
      executionStartedAt?: string
      executionFinishedAt?: string
    }
    expect(codeBlock.executionCount).toBe(1)
    expect(codeBlock.executionStartedAt).toBe('2025-01-01T00:00:00Z')
    expect(codeBlock.executionFinishedAt).toBe('2025-01-01T00:00:01Z')
  })

  it('should merge environment from snapshot', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    expect(merged.environment).toEqual({ hash: 'env-123' })
  })

  it('should merge execution info from snapshot', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    expect(merged.execution).toEqual({
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T00:01:00Z',
    })
  })

  it('should not modify source file', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    mergeSnapshotIntoSource(source, snapshot)

    const sourceBlock = source.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(sourceBlock.outputs).toBeUndefined()
  })

  it('should skip blocks without snapshot outputs', () => {
    const source = createSource()
    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    const markdownBlock = merged.project.notebooks[0].blocks[1] as { outputs?: unknown[] }
    expect(markdownBlock.outputs).toBeUndefined()
  })

  it('should skip mismatched blocks when skipMismatched is true', () => {
    const source = createSource()
    // Modify source contentHash to simulate changed content
    ;(source.project.notebooks[0].blocks[0] as { contentHash: string }).contentHash = 'sha256:different'

    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot, { skipMismatched: true })

    const codeBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(codeBlock.outputs).toBeUndefined()
  })

  it('should merge mismatched blocks when skipMismatched is false', () => {
    const source = createSource()
    // Modify source contentHash to simulate changed content
    ;(source.project.notebooks[0].blocks[0] as { contentHash: string }).contentHash = 'sha256:different'

    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot, { skipMismatched: false })

    const codeBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(codeBlock.outputs).toHaveLength(1)
  })

  it('should handle blocks with no contentHash', () => {
    const source = createSource()
    delete (source.project.notebooks[0].blocks[0] as { contentHash?: string }).contentHash

    const snapshot = createSnapshot()

    const merged = mergeSnapshotIntoSource(source, snapshot)

    const codeBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(codeBlock.outputs).toHaveLength(1)
  })

  it('should handle empty notebooks', () => {
    const source: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    const snapshot: DeepnoteSnapshot = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z', snapshotHash: 'sha256:snap123' },
      environment: {},
      execution: {},
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    const merged = mergeSnapshotIntoSource(source, snapshot)

    expect(merged.project.notebooks).toHaveLength(0)
  })
})

describe('countBlocksWithOutputs', () => {
  it('should count blocks with outputs', () => {
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
              {
                id: 'block-2',
                type: 'code',
                blockGroup: 'bg-2',
                sortingKey: '0001',
                content: 'x = 1',
                outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }],
                metadata: {},
              },
              {
                id: 'block-3',
                type: 'markdown',
                blockGroup: 'bg-3',
                sortingKey: '0002',
                content: '# Hello',
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    expect(countBlocksWithOutputs(file)).toBe(2)
  })

  it('should return 0 for file with no outputs', () => {
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

    expect(countBlocksWithOutputs(file)).toBe(0)
  })

  it('should ignore empty outputs arrays', () => {
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

    expect(countBlocksWithOutputs(file)).toBe(0)
  })
})
