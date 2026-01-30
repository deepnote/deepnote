import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { findSnapshotsForProject, loadLatestSnapshot } from '@deepnote/runtime-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { parseSnapshotFilename } from './lookup'
import { mergeSnapshotIntoSource } from './merge'
import { generateSnapshotFilename, slugifyProjectName, splitDeepnoteFile } from './split'

describe('Snapshot Integration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'snapshot-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should split a file with outputs into source and snapshot', () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      environment: { hash: 'env-123' },
      execution: { startedAt: '2025-01-01T00:00:00Z', finishedAt: '2025-01-01T00:01:00Z' },
      project: {
        id: '2e814690-4f02-465c-8848-5567ab9253b7',
        name: 'Customer Analysis',
        notebooks: [
          {
            id: 'nb-1',
            name: 'Analysis',
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
            ],
          },
        ],
      },
    }

    const { source, snapshot } = splitDeepnoteFile(file)

    // Source should not have outputs
    const sourceBlock = source.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(sourceBlock.outputs).toBeUndefined()

    // Snapshot should have outputs
    const snapshotBlock = snapshot.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(snapshotBlock.outputs).toHaveLength(1)

    // Both should have content hashes
    expect(source.project.notebooks[0].blocks[0].contentHash).toMatch(/^sha256:/)
    expect(snapshot.project.notebooks[0].blocks[0].contentHash).toMatch(/^sha256:/)

    // Snapshot should have snapshotHash
    expect(snapshot.metadata.snapshotHash).toMatch(/^sha256:/)
  })

  it('should roundtrip source and snapshot correctly', () => {
    const original: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      environment: { hash: 'env-123' },
      execution: { startedAt: '2025-01-01T00:00:00Z', finishedAt: '2025-01-01T00:01:00Z' },
      project: {
        id: '2e814690-4f02-465c-8848-5567ab9253b7',
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
                content: 'x = 1',
                executionCount: 5,
                outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }],
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    // Split
    const { source, snapshot } = splitDeepnoteFile(original)

    // Merge
    const merged = mergeSnapshotIntoSource(source, snapshot)

    // Outputs should be restored
    const mergedBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[]; executionCount?: number }
    expect(mergedBlock.outputs).toHaveLength(1)
    expect(mergedBlock.executionCount).toBe(5)
  })

  it('should write and read snapshot files correctly', async () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      environment: { hash: 'env-123' },
      project: {
        id: '2e814690-4f02-465c-8848-5567ab9253b7',
        name: 'My Project',
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
                content: 'print("test")',
                outputs: [{ output_type: 'stream', name: 'stdout', text: ['test\n'] }],
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    // Split
    const { source, snapshot } = splitDeepnoteFile(file)

    // Write source file
    const sourceFilename = 'project.deepnote'
    const sourcePath = join(tempDir, sourceFilename)
    await fs.writeFile(sourcePath, stringify(source), 'utf-8')

    // Create snapshots directory and write snapshot
    const snapshotsDir = join(tempDir, 'snapshots')
    await fs.mkdir(snapshotsDir, { recursive: true })

    const slug = slugifyProjectName(file.project.name)
    const snapshotFilename = generateSnapshotFilename(slug, file.project.id)
    const snapshotPath = join(snapshotsDir, snapshotFilename)
    await fs.writeFile(snapshotPath, stringify(snapshot), 'utf-8')

    // Find snapshots
    const snapshots = await findSnapshotsForProject(tempDir, file.project.id)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].slug).toBe('my-project')
    expect(snapshots[0].projectId).toBe(file.project.id)

    // Load snapshot
    const loadedSnapshot = await loadLatestSnapshot(sourcePath, file.project.id)
    expect(loadedSnapshot).not.toBeNull()
    if (!loadedSnapshot) {
      throw new Error('Snapshot should exist')
    }

    // Merge and verify
    const loadedSource = deserializeDeepnoteFile(await fs.readFile(sourcePath, 'utf-8'))
    const merged = mergeSnapshotIntoSource(loadedSource, loadedSnapshot)

    const mergedBlock = merged.project.notebooks[0].blocks[0] as { outputs?: unknown[] }
    expect(mergedBlock.outputs).toHaveLength(1)
  })

  it('should generate correct snapshot filenames', () => {
    expect(slugifyProjectName('Customer Analysis')).toBe('customer-analysis')
    expect(slugifyProjectName('My Project 2.0')).toBe('my-project-2-0')
    expect(slugifyProjectName('---test---')).toBe('test')

    const filename = generateSnapshotFilename('my-project', '2e814690-4f02-465c-8848-5567ab9253b7')
    expect(filename).toBe('my-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote')

    const parsed = parseSnapshotFilename(filename)
    expect(parsed).toEqual({
      slug: 'my-project',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      timestamp: 'latest',
    })
  })

  it('should return null when no snapshot exists', async () => {
    const sourcePath = join(tempDir, 'project.deepnote')
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'test-id',
        name: 'Test',
        notebooks: [],
      },
    }
    await fs.writeFile(sourcePath, stringify(file), 'utf-8')

    const snapshot = await loadLatestSnapshot(sourcePath, 'test-id')
    expect(snapshot).toBeNull()
  })
})
