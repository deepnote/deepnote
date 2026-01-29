import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  type BlockExecutionOutput,
  getSnapshotPath,
  mergeOutputsIntoFile,
  saveExecutionSnapshot,
} from './output-persistence'

describe('output-persistence', () => {
  const createTestFile = (): DeepnoteFile =>
    ({
      version: '1',
      project: {
        id: 'test-project-id-1234-5678-90ab',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Notebook 1',
            blocks: [
              {
                id: 'block-1',
                type: 'code',
                content: 'print("hello")',
                sortingKey: 'a0',
                blockGroup: 'group-1',
                metadata: {},
              },
              {
                id: 'block-2',
                type: 'code',
                content: 'x = 42',
                sortingKey: 'a1',
                blockGroup: 'group-1',
                metadata: {},
              },
              {
                id: 'block-3',
                type: 'markdown',
                content: '# Header',
                sortingKey: 'a2',
                blockGroup: 'group-1',
                metadata: {},
              },
            ],
          },
        ],
      },
    }) as DeepnoteFile

  describe('mergeOutputsIntoFile', () => {
    it('merges outputs into matching blocks', () => {
      const file = createTestFile()
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
        {
          id: 'block-2',
          outputs: [{ output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {} }],
          executionCount: 2,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = mergeOutputsIntoFile(file, outputs, timing)

      // Check execution timing
      expect(result.execution).toEqual(timing)

      // Check block outputs were merged
      const block1 = result.project.notebooks[0].blocks[0] as { outputs?: unknown[]; executionCount?: number }
      expect(block1.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'hello\n' }])
      expect(block1.executionCount).toBe(1)

      const block2 = result.project.notebooks[0].blocks[1] as { outputs?: unknown[]; executionCount?: number }
      expect(block2.outputs).toEqual([{ output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {} }])
      expect(block2.executionCount).toBe(2)

      // Non-code block should be unchanged
      const block3 = result.project.notebooks[0].blocks[2] as { outputs?: unknown[] }
      expect(block3.outputs).toBeUndefined()
    })

    it('leaves blocks without matching outputs unchanged', () => {
      const file = createTestFile()
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
        // block-2 not included
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = mergeOutputsIntoFile(file, outputs, timing)

      const block2 = result.project.notebooks[0].blocks[1] as { outputs?: unknown[] }
      expect(block2.outputs).toBeUndefined()
    })

    it('handles null executionCount', () => {
      const file = createTestFile()
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [],
          executionCount: null,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = mergeOutputsIntoFile(file, outputs, timing)

      const block1 = result.project.notebooks[0].blocks[0] as { executionCount?: number | null }
      // executionCount should not be set if null
      expect(block1.executionCount).toBeUndefined()
    })

    it('does not mutate original file', () => {
      const file = createTestFile()
      const originalBlock = file.project.notebooks[0].blocks[0]
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      mergeOutputsIntoFile(file, outputs, timing)

      // Original should be unchanged
      expect((originalBlock as { outputs?: unknown[] }).outputs).toBeUndefined()
    })
  })

  describe('getSnapshotPath', () => {
    it('returns correct snapshot path', () => {
      const file = createTestFile()
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe('/path/to/snapshots/test-project_test-project-id-1234-5678-90ab_latest.snapshot.deepnote')
    })

    it('handles project name with special characters', () => {
      const file = createTestFile()
      file.project.name = 'My Project (Draft) #1'
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        '/path/to/snapshots/my-project-draft-1_test-project-id-1234-5678-90ab_latest.snapshot.deepnote'
      )
    })

    it('uses "project" as fallback for empty name', () => {
      const file = createTestFile()
      file.project.name = ''
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe('/path/to/snapshots/project_test-project-id-1234-5678-90ab_latest.snapshot.deepnote')
    })
  })

  describe('saveExecutionSnapshot', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'output-persistence-test-'))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true })
    })

    it('creates snapshot directory and saves snapshot file', async () => {
      const file = createTestFile()
      const sourcePath = join(tempDir, 'project.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = await saveExecutionSnapshot(sourcePath, file, outputs, timing)

      // Check snapshot was created
      expect(result.snapshotPath).toContain('snapshots')
      expect(result.snapshotPath).toContain('.snapshot.deepnote')

      // Check file exists
      const stat = await fs.stat(result.snapshotPath)
      expect(stat.isFile()).toBe(true)

      // Check content is valid YAML
      const content = await fs.readFile(result.snapshotPath, 'utf-8')
      const parsed = parse(content)
      expect(parsed.version).toBe('1')
      expect(parsed.project.id).toBe('test-project-id-1234-5678-90ab')

      // Check outputs were included
      const block1 = parsed.project.notebooks[0].blocks[0]
      expect(block1.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'hello\n' }])
    })

    it('overwrites existing snapshot', async () => {
      const file = createTestFile()
      const sourcePath = join(tempDir, 'project.deepnote')
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      // First save
      const outputs1: BlockExecutionOutput[] = [
        { id: 'block-1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'first\n' }], executionCount: 1 },
      ]
      const result1 = await saveExecutionSnapshot(sourcePath, file, outputs1, timing)

      // Second save
      const outputs2: BlockExecutionOutput[] = [
        { id: 'block-1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'second\n' }], executionCount: 2 },
      ]
      const result2 = await saveExecutionSnapshot(sourcePath, file, outputs2, timing)

      // Should use same path
      expect(result1.snapshotPath).toBe(result2.snapshotPath)

      // Should have second output
      const content = await fs.readFile(result2.snapshotPath, 'utf-8')
      const parsed = parse(content)
      const block1 = parsed.project.notebooks[0].blocks[0]
      expect(block1.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'second\n' }])
    })
  })
})
