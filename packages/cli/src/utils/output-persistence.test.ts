import fs from 'node:fs/promises'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { type DeepnoteFile, deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadRootFixture } from '../../../../test-fixtures/helpers/fixture-loader'
import {
  type BlockExecutionOutput,
  getSnapshotPath,
  mergeOutputsIntoFile,
  saveExecutionSnapshot,
} from './output-persistence'

describe('output-persistence', () => {
  /** Load the test fixture and return a fresh copy */
  const loadTestFile = async (): Promise<DeepnoteFile> => {
    const content = await loadRootFixture('output-persistence-test.deepnote')
    return deserializeDeepnoteFile(content)
  }

  describe('mergeOutputsIntoFile', () => {
    it('merges outputs into matching blocks', async () => {
      const file = await loadTestFile()
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

    it('leaves blocks without matching outputs unchanged', async () => {
      const file = await loadTestFile()
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

    it('handles null executionCount', async () => {
      const file = await loadTestFile()
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

    it('does not mutate original file', async () => {
      const file = await loadTestFile()
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
    it('returns correct snapshot path', async () => {
      const file = await loadTestFile()
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        resolve('/path/to', 'snapshots', 'test-project_test-project-id-1234-5678-90ab_latest.snapshot.deepnote')
      )
    })

    it('handles project name with special characters', async () => {
      const file = await loadTestFile()
      file.project.name = 'My Project (Draft) #1'
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        resolve('/path/to', 'snapshots', 'my-project-draft-1_test-project-id-1234-5678-90ab_latest.snapshot.deepnote')
      )
    })

    it('uses "project" as fallback for empty name', async () => {
      const file = await loadTestFile()
      file.project.name = ''
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        resolve('/path/to', 'snapshots', 'project_test-project-id-1234-5678-90ab_latest.snapshot.deepnote')
      )
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

    it('creates snapshot directory and saves both latest and timestamped snapshot files', async () => {
      const file = await loadTestFile()
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

      // Check latest snapshot was created
      expect(result.snapshotPath).toContain('_latest.snapshot.deepnote')

      // Check timestamped snapshot was created
      expect(result.timestampedSnapshotPath).toContain('_2024-01-01T00-00-05.snapshot.deepnote')

      // Check both files exist
      const latestStat = await fs.stat(result.snapshotPath)
      expect(latestStat.isFile()).toBe(true)

      const timestampedStat = await fs.stat(result.timestampedSnapshotPath)
      expect(timestampedStat.isFile()).toBe(true)

      // Check latest content is valid YAML with outputs
      const latestContent = await fs.readFile(result.snapshotPath, 'utf-8')
      const latestParsed = parse(latestContent)
      expect(latestParsed.version).toBe('1')
      expect(latestParsed.project.id).toBe('test-project-id-1234-5678-90ab')
      expect(latestParsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'hello\n' },
      ])

      // Check timestamped content matches latest
      const timestampedContent = await fs.readFile(result.timestampedSnapshotPath, 'utf-8')
      expect(timestampedContent).toBe(latestContent)
    })

    it('overwrites latest snapshot but creates unique timestamped snapshots', async () => {
      const file = await loadTestFile()
      const sourcePath = join(tempDir, 'project.deepnote')

      // First save
      const timing1 = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }
      const outputs1: BlockExecutionOutput[] = [
        { id: 'block-1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'first\n' }], executionCount: 1 },
      ]
      const result1 = await saveExecutionSnapshot(sourcePath, file, outputs1, timing1)

      // Second save with different finishedAt
      const timing2 = {
        startedAt: '2024-01-01T00:01:00.000Z',
        finishedAt: '2024-01-01T00:01:05.000Z',
      }
      const outputs2: BlockExecutionOutput[] = [
        { id: 'block-1', outputs: [{ output_type: 'stream', name: 'stdout', text: 'second\n' }], executionCount: 2 },
      ]
      const result2 = await saveExecutionSnapshot(sourcePath, file, outputs2, timing2)

      // Latest path should be the same
      expect(result1.snapshotPath).toBe(result2.snapshotPath)

      // Timestamped paths should be different
      expect(result1.timestampedSnapshotPath).not.toBe(result2.timestampedSnapshotPath)

      // Latest should have second output
      const latestContent = await fs.readFile(result2.snapshotPath, 'utf-8')
      const latestParsed = parse(latestContent)
      expect(latestParsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'second\n' },
      ])

      // First timestamped snapshot should still have first output
      const ts1Content = await fs.readFile(result1.timestampedSnapshotPath, 'utf-8')
      const ts1Parsed = parse(ts1Content)
      expect(ts1Parsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'first\n' },
      ])
    })
  })
})
