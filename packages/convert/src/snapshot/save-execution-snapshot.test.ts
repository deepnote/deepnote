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
} from './save-execution-snapshot'

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

    it('drops stale execution metadata when the re-run does not supply it', async () => {
      // Every stale execution field is stripped before re-applying: a block with
      // a pre-existing executionCount / per-block timing loses them when a re-run
      // returns null/absent, so a prior run's metadata never leaks into the new
      // snapshot. A non-null re-run value still overwrites.
      const file = await loadTestFile()
      const block0 = file.project.notebooks[0].blocks[0] as {
        executionCount?: number | null
        executionStartedAt?: string
        executionFinishedAt?: string
      }
      block0.executionCount = 7
      block0.executionStartedAt = '2023-01-01T00:00:00.000Z'
      block0.executionFinishedAt = '2023-01-01T00:00:01.000Z'
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: null,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = mergeOutputsIntoFile(file, outputs, timing)

      const block1 = result.project.notebooks[0].blocks[0] as {
        outputs?: unknown[]
        executionCount?: number | null
        executionStartedAt?: string
        executionFinishedAt?: string
      }
      // Outputs are merged, but every stale execution field is dropped.
      expect(block1.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'hello\n' }])
      expect(block1.executionCount).toBeUndefined()
      expect(block1.executionStartedAt).toBeUndefined()
      expect(block1.executionFinishedAt).toBeUndefined()

      // A non-null re-run value still overwrites the pre-existing one.
      const overwritten = mergeOutputsIntoFile(file, [{ id: 'block-1', outputs: [], executionCount: 9 }], timing)
      const overwrittenBlock1 = overwritten.project.notebooks[0].blocks[0] as { executionCount?: number | null }
      expect(overwrittenBlock1.executionCount).toBe(9)
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
        resolve(
          '/path/to',
          'snapshots',
          'test-project_test-project-id-1234-5678-90ab_notebook-1_latest.snapshot.deepnote'
        )
      )
    })

    it('handles project name with special characters', async () => {
      const file = await loadTestFile()
      file.project.name = 'My Project (Draft) #1'
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        resolve(
          '/path/to',
          'snapshots',
          'my-project-draft-1_test-project-id-1234-5678-90ab_notebook-1_latest.snapshot.deepnote'
        )
      )
    })

    it('uses "project" as fallback for empty name', async () => {
      const file = await loadTestFile()
      file.project.name = ''
      const sourcePath = '/path/to/project.deepnote'

      const result = getSnapshotPath(sourcePath, file)

      expect(result).toBe(
        resolve('/path/to', 'snapshots', 'project_test-project-id-1234-5678-90ab_notebook-1_latest.snapshot.deepnote')
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
      const latestStat = await fs.stat(result.snapshotPath as string)
      expect(latestStat.isFile()).toBe(true)

      const timestampedStat = await fs.stat(result.timestampedSnapshotPath as string)
      expect(timestampedStat.isFile()).toBe(true)

      // Check latest content is valid YAML with outputs
      const latestContent = await fs.readFile(result.snapshotPath as string, 'utf-8')
      const latestParsed = parse(latestContent)
      expect(latestParsed.version).toBe('1')
      expect(latestParsed.project.id).toBe('test-project-id-1234-5678-90ab')
      expect(latestParsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'hello\n' },
      ])

      // Check timestamped content matches latest
      const timestampedContent = await fs.readFile(result.timestampedSnapshotPath as string, 'utf-8')
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
      const latestContent = await fs.readFile(result2.snapshotPath as string, 'utf-8')
      const latestParsed = parse(latestContent)
      expect(latestParsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'second\n' },
      ])

      // First timestamped snapshot should still have first output
      const ts1Content = await fs.readFile(result1.timestampedSnapshotPath as string, 'utf-8')
      const ts1Parsed = parse(ts1Content)
      expect(ts1Parsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: 'first\n' },
      ])
    })

    it('saveExecutionSnapshot embeds the main notebook id in snapshot filenames when the source file lists init and main notebooks', async () => {
      // Regression: init+main files used to fall back to project-wide snapshot names, colliding across splits.
      const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      const initNotebookId = '22222222-2222-2222-2222-222222222222'
      const mainNotebookId = '33333333-3333-3333-3333-333333333333'
      const file: DeepnoteFile = {
        version: '1.0.0',
        metadata: { createdAt: '2025-01-01T00:00:00Z' },
        environment: {},
        project: {
          id: projectId,
          name: 'Init Main Project',
          initNotebookId,
          notebooks: [
            {
              id: initNotebookId,
              name: 'Init',
              blocks: [
                {
                  id: 'blk-init-md',
                  type: 'markdown',
                  content: 'init',
                  sortingKey: 'a0',
                  blockGroup: 'group-1',
                  metadata: {},
                },
              ],
            },
            {
              id: mainNotebookId,
              name: 'Main',
              blocks: [
                {
                  id: 'blk-main-code',
                  type: 'code',
                  content: 'print(1)',
                  sortingKey: 'a1',
                  blockGroup: 'group-1',
                  metadata: {},
                },
              ],
            },
          ],
        },
      }

      const sourcePath = join(tempDir, 'split.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'blk-main-code',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'persisted\n' }],
          executionCount: 1,
        },
      ]
      const timing = {
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      }

      const result = await saveExecutionSnapshot(sourcePath, file, outputs, timing)

      expect(result.snapshotPath).toContain(`_${projectId}_${mainNotebookId}_`)
      expect(result.timestampedSnapshotPath).toContain(`_${projectId}_${mainNotebookId}_`)
    })

    const COMPOSED_IDS = {
      projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      initNotebookId: '22222222-2222-2222-2222-222222222222',
      mainNotebookId: '33333333-3333-3333-3333-333333333333',
    }
    const COMPOSED_TIMING = { startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:05.000Z' }

    /** A composed `[init, main]` file (as `resolveAndComposeInit` would produce), both notebooks code blocks. */
    const makeComposedFile = (): DeepnoteFile => ({
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      environment: {},
      project: {
        id: COMPOSED_IDS.projectId,
        name: 'Init Main Project',
        initNotebookId: COMPOSED_IDS.initNotebookId,
        notebooks: [
          {
            id: COMPOSED_IDS.initNotebookId,
            name: 'Init',
            blocks: [
              {
                id: 'blk-init-code',
                type: 'code',
                content: 'INIT_VAR = 1',
                sortingKey: 'a0',
                blockGroup: 'g',
                metadata: {},
              },
            ],
          },
          {
            id: COMPOSED_IDS.mainNotebookId,
            name: 'Main',
            blocks: [
              {
                id: 'blk-main-code',
                type: 'code',
                content: 'print(INIT_VAR)',
                sortingKey: 'a1',
                blockGroup: 'g',
                metadata: {},
              },
            ],
          },
        ],
      },
    })

    it('writes a single main-only snapshot for a composed run (init excluded, no separate init file)', async () => {
      // A composed [init, main] run writes ONLY the main snapshot, and that snapshot
      // must NOT embed the init notebook (no duplication, no separate init file).
      const { initNotebookId, mainNotebookId } = COMPOSED_IDS
      const sourcePath = join(tempDir, 'project-main.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'blk-init-code',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'init\n' }],
          executionCount: 1,
        },
        { id: 'blk-main-code', outputs: [{ output_type: 'stream', name: 'stdout', text: '1\n' }], executionCount: 2 },
      ]

      const result = await saveExecutionSnapshot(sourcePath, makeComposedFile(), outputs, COMPOSED_TIMING, {
        initBlockIds: new Set(['blk-init-code']),
      })

      // Main snapshot: keyed by the main notebook id, contains ONLY the main notebook (init excluded).
      expect(result.snapshotPath).toContain(`_${mainNotebookId}_`)
      const mainParsed = parse(await fs.readFile(result.snapshotPath as string, 'utf-8'))
      expect(mainParsed.project.notebooks.map((n: { id: string }) => n.id)).toEqual([mainNotebookId])
      expect(mainParsed.project.notebooks.map((n: { id: string }) => n.id)).not.toContain(initNotebookId)
      expect(mainParsed.project.notebooks[0].blocks[0].outputs).toEqual([
        { output_type: 'stream', name: 'stdout', text: '1\n' },
      ])

      // Exactly the two main-keyed files (latest + timestamped) exist; no init-keyed file.
      const snapshotFiles = await fs.readdir(join(tempDir, 'snapshots'))
      expect(snapshotFiles.some(f => f.includes(`_${initNotebookId}_`))).toBe(false)
      expect(snapshotFiles.filter(f => f.includes(`_${mainNotebookId}_`)).length).toBe(2)
    })

    it('excludes the init notebook from the main snapshot even when init produced no output this run', async () => {
      const { initNotebookId, mainNotebookId } = COMPOSED_IDS
      const sourcePath = join(tempDir, 'project-main.deepnote')
      // Only main emitted output; init ran as a prelude but produced nothing this run.
      const outputs: BlockExecutionOutput[] = [
        { id: 'blk-main-code', outputs: [{ output_type: 'stream', name: 'stdout', text: '1\n' }], executionCount: 1 },
      ]

      const result = await saveExecutionSnapshot(sourcePath, makeComposedFile(), outputs, COMPOSED_TIMING, {
        initBlockIds: new Set(['blk-init-code']),
      })

      const mainParsed = parse(await fs.readFile(result.snapshotPath as string, 'utf-8'))
      expect(mainParsed.project.notebooks.map((n: { id: string }) => n.id)).toEqual([mainNotebookId])
      expect(mainParsed.project.notebooks.map((n: { id: string }) => n.id)).not.toContain(initNotebookId)
    })

    it('writes no snapshot file for an init-only composed run', async () => {
      // e.g. `--block=<initBlockId>`: only init blocks produced output, so a main snapshot would
      // record a misleading empty-main view. Nothing is written.
      const { initNotebookId, mainNotebookId } = COMPOSED_IDS
      const sourcePath = join(tempDir, 'project-main.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'blk-init-code',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'init\n' }],
          executionCount: 1,
        },
      ]

      const result = await saveExecutionSnapshot(sourcePath, makeComposedFile(), outputs, COMPOSED_TIMING, {
        initBlockIds: new Set(['blk-init-code']),
      })

      // No snapshot is written, so no paths are returned.
      expect(result.snapshotPath).toBeUndefined()
      expect(result.timestampedSnapshotPath).toBeUndefined()

      // Neither a main- nor an init-keyed file is written (the dir exists from mkdir, so readdir returns []).
      const snapshotFiles = await fs.readdir(join(tempDir, 'snapshots'))
      expect(snapshotFiles.some(f => f.includes(`_${mainNotebookId}_`))).toBe(false)
      expect(snapshotFiles.some(f => f.includes(`_${initNotebookId}_`))).toBe(false)
    })
  })
})
