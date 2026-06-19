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
  saveExecutionSnapshotForRun,
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

      // The uniform saver writes whatever file it is given: it keys the filename by the main
      // notebook id but does NOT filter the init notebook out (that shaping is the caller's job now).
      const parsed = parse(await fs.readFile(result.snapshotPath, 'utf-8'))
      expect(parsed.project.notebooks.map((n: { id: string }) => n.id)).toEqual([initNotebookId, mainNotebookId])
    })

    // The init-aware behavior (exclude the borrowed init notebook from the snapshot; skip the snapshot
    // for an init-only run) is no longer the saver's responsibility — it now lives in the run-command
    // callers (CLI run.ts, MCP execution.ts) and is covered by their tests. The saver writes whatever
    // file it is given (see the `[init, main]` assertion in the main-notebook-id test above).
  })

  describe('saveExecutionSnapshotForRun', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'output-persistence-best-effort-test-'))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true })
    })

    const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const initNotebookId = '22222222-2222-2222-2222-222222222222'
    const mainNotebookId = '33333333-3333-3333-3333-333333333333'
    const initBlockId = 'blk-init-md'
    const mainBlockId = 'blk-main-code'

    /** A composed `[init, main]` DeepnoteFile with `initNotebookId` set, mirroring a borrowed-init run. */
    const makeComposedFile = (): DeepnoteFile => ({
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
                id: initBlockId,
                type: 'code',
                content: 'x = 1',
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
                id: mainBlockId,
                type: 'code',
                content: 'print(x)',
                sortingKey: 'a1',
                blockGroup: 'group-1',
                metadata: {},
              },
            ],
          },
        ],
      },
    })

    const timing = {
      startedAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-01-01T00:00:05.000Z',
    }

    it('saves normally for a single-notebook file with no initBlockIds', async () => {
      const file = await loadTestFile()
      const sourcePath = join(tempDir, 'project.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
      ]

      const result = await saveExecutionSnapshotForRun({
        sourcePath,
        file,
        blockOutputs: outputs,
        timing,
      })

      expect(result).toBeDefined()
      expect(result?.snapshotPath).toContain('_latest.snapshot.deepnote')
      expect(result?.timestampedSnapshotPath).toContain('_2024-01-01T00-00-05.snapshot.deepnote')

      // Both files exist on disk.
      // biome-ignore lint/style/noNonNullAssertion: result asserted defined above
      const latestStat = await fs.stat(result!.snapshotPath)
      expect(latestStat.isFile()).toBe(true)
      // biome-ignore lint/style/noNonNullAssertion: result asserted defined above
      const timestampedStat = await fs.stat(result!.timestampedSnapshotPath)
      expect(timestampedStat.isFile()).toBe(true)
    })

    it('skips the save for an init-only composed run', async () => {
      const file = makeComposedFile()
      const sourcePath = join(tempDir, 'split.deepnote')
      // Only the init block executed.
      const outputs: BlockExecutionOutput[] = [
        {
          id: initBlockId,
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'init-only\n' }],
          executionCount: 1,
        },
      ]

      const result = await saveExecutionSnapshotForRun({
        sourcePath,
        file,
        blockOutputs: outputs,
        timing,
        initBlockIds: new Set([initBlockId]),
      })

      expect(result).toBeUndefined()

      // No snapshot file was written: the snapshots dir is absent.
      await expect(fs.stat(join(tempDir, 'snapshots'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('excludes the borrowed init notebook when a non-init block executed', async () => {
      const file = makeComposedFile()
      const sourcePath = join(tempDir, 'split.deepnote')
      // A main block executed.
      const outputs: BlockExecutionOutput[] = [
        {
          id: mainBlockId,
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'persisted\n' }],
          executionCount: 1,
        },
      ]

      const result = await saveExecutionSnapshotForRun({
        sourcePath,
        file,
        blockOutputs: outputs,
        timing,
        initBlockIds: new Set([initBlockId]),
      })

      expect(result).toBeDefined()

      // The written snapshot drops the init notebook, matching the single-notebook main source.
      // biome-ignore lint/style/noNonNullAssertion: result asserted defined above
      const parsed = parse(await fs.readFile(result!.snapshotPath, 'utf-8'))
      expect(parsed.project.notebooks.map((n: { id: string }) => n.id)).toEqual([mainNotebookId])
    })

    it('forwards a .deepnote sourcePath verbatim, writing the snapshot beside it', async () => {
      const file = await loadTestFile()
      // Simulates a caller that already rewrote a converted input to its .deepnote equivalent.
      const sourcePath = join(tempDir, 'converted.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
      ]

      const result = await saveExecutionSnapshotForRun({
        sourcePath,
        file,
        blockOutputs: outputs,
        timing,
      })

      expect(result).toBeDefined()
      // The snapshot lands in the snapshots/ dir beside the forwarded sourcePath.
      const expectedDir = join(tempDir, 'snapshots')
      expect(result?.snapshotPath.startsWith(expectedDir)).toBe(true)
      expect(result?.timestampedSnapshotPath.startsWith(expectedDir)).toBe(true)
      // biome-ignore lint/style/noNonNullAssertion: result asserted defined above
      expect((await fs.stat(result!.snapshotPath)).isFile()).toBe(true)
    })

    it('throws when the underlying save fails', async () => {
      const file = await loadTestFile()
      // /dev/null is a file, so mkdir of `/dev/null/...` throws ENOTDIR inside the saver.
      const sourcePath = '/dev/null/x.deepnote'
      const outputs: BlockExecutionOutput[] = [
        {
          id: 'block-1',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
          executionCount: 1,
        },
      ]

      // The helper does not swallow — the error propagates for the caller to handle.
      await expect(
        saveExecutionSnapshotForRun({
          sourcePath,
          file,
          blockOutputs: outputs,
          timing,
        })
      ).rejects.toThrow()
    })

    it('treats an undefined initBlockIds as a non-composed run, keeping both notebooks', async () => {
      const file = makeComposedFile()
      const sourcePath = join(tempDir, 'split.deepnote')
      const outputs: BlockExecutionOutput[] = [
        {
          id: mainBlockId,
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'persisted\n' }],
          executionCount: 1,
        },
      ]

      // initBlockIds omitted => `?? empty set` => isComposed false => no skip, no init exclusion.
      const result = await saveExecutionSnapshotForRun({
        sourcePath,
        file,
        blockOutputs: outputs,
        timing,
      })

      expect(result).toBeDefined()

      // Both notebooks are retained because the run is not treated as composed.
      // biome-ignore lint/style/noNonNullAssertion: result asserted defined above
      const parsed = parse(await fs.readFile(result!.snapshotPath, 'utf-8'))
      expect(parsed.project.notebooks.map((n: { id: string }) => n.id)).toEqual([initNotebookId, mainNotebookId])
    })
  })
})
