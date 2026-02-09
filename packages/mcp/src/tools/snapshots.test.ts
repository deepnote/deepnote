import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleMagicTool } from './magic'
import { handleSnapshotTool } from './snapshots'

function extractResult(response: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

describe('snapshot tools handlers', () => {
  let tempDir: string
  let testNotebookPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-snapshot-test-'))

    testNotebookPath = path.join(tempDir, 'test.deepnote')
    await handleMagicTool('deepnote_scaffold', {
      description: 'Hello world test',
      outputPath: testNotebookPath,
    })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('deepnote_snapshot_list', () => {
    it('handles missing snapshot directory gracefully', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_list', {
        path: testNotebookPath,
      })

      const result = extractResult(response)
      // When no snapshots directory exists, returns error
      expect(result.error).toBeDefined()
    })

    it('returns error when path is missing', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_list', {})
      const result = extractResult(response)
      expect(result.error).toBe('path is required')
    })
  })

  describe('deepnote_snapshot_split', () => {
    it('splits source from outputs', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_split', {
        path: testNotebookPath,
        snapshotDir: path.join(tempDir, 'snapshots'),
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.sourcePath).toBeDefined()
      expect(result.snapshotPath).toBeDefined()
      expect(typeof result.outputsExtracted).toBe('number')

      // Snapshot file should exist
      const snapshotPath = result.snapshotPath as string
      const stat = await fs.stat(snapshotPath)
      expect(stat.isFile()).toBe(true)
    })

    it('creates latest snapshot by default', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_split', {
        path: testNotebookPath,
        snapshotDir: path.join(tempDir, 'snapshots'),
      })

      const result = extractResult(response)
      expect(result.latestPath).toBeDefined()
      const latestPath = result.latestPath as string
      expect(latestPath).toContain('_latest.snapshot.deepnote')

      const stat = await fs.stat(latestPath)
      expect(stat.isFile()).toBe(true)
    })

    it('returns error when path is missing', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_split', {})
      const result = extractResult(response)
      expect(result.error).toBe('path is required')
    })
  })

  describe('deepnote_snapshot_load', () => {
    it('loads a snapshot after split', async () => {
      // First split to create a snapshot
      const splitResponse = await handleSnapshotTool('deepnote_snapshot_split', {
        path: testNotebookPath,
        snapshotDir: path.join(tempDir, 'snapshots'),
      })
      const splitResult = extractResult(splitResponse)
      const snapshotPath = splitResult.snapshotPath as string

      // Then load it
      const loadResponse = await handleSnapshotTool('deepnote_snapshot_load', {
        path: snapshotPath,
      })

      const result = extractResult(loadResponse)
      expect(result.projectName).toBeDefined()
      expect(result.notebooks).toBeDefined()
    })

    it('returns error when path is missing', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_load', {})
      const result = extractResult(response)
      expect(result.error).toBe('path is required')
    })
  })

  describe('deepnote_snapshot_merge', () => {
    it('merges snapshot back into source', async () => {
      const snapshotDir = path.join(tempDir, 'snapshots')

      // Split first
      const splitResponse = await handleSnapshotTool('deepnote_snapshot_split', {
        path: testNotebookPath,
        snapshotDir,
      })
      const splitResult = extractResult(splitResponse)
      const snapshotPath = splitResult.snapshotPath as string

      // Then merge back
      const mergeResponse = await handleSnapshotTool('deepnote_snapshot_merge', {
        sourcePath: testNotebookPath,
        snapshotPath,
        outputPath: path.join(tempDir, 'merged.deepnote'),
      })

      const result = extractResult(mergeResponse)
      expect(result.success).toBe(true)
      expect(result.outputPath).toBeDefined()
      expect(typeof result.blocksWithOutputs).toBe('number')
    })

    it('returns error when sourcePath is missing', async () => {
      const response = await handleSnapshotTool('deepnote_snapshot_merge', {})
      const result = extractResult(response)
      expect(result.error).toBe('sourcePath is required')
    })
  })

  describe('deepnote_snapshot_list after split', () => {
    it('finds snapshot files in directory after split', async () => {
      const snapshotDir = path.join(tempDir, 'snapshots')

      // Split to create snapshot
      const splitResponse = await handleSnapshotTool('deepnote_snapshot_split', {
        path: testNotebookPath,
        snapshotDir,
      })
      const splitResult = extractResult(splitResponse)
      expect(splitResult.success).toBe(true)

      // Verify snapshot files were created
      const files = await fs.readdir(snapshotDir)
      const snapshotFiles = files.filter(f => f.endsWith('.snapshot.deepnote'))
      expect(snapshotFiles.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('returns error for unknown tool', async () => {
      const response = (await handleSnapshotTool('deepnote_unknown', {})) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Unknown snapshot tool')
    })
  })
})
