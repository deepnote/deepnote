import { describe, expect, it } from 'vitest'

import type { DeepnoteFile, DeepnoteSnapshot } from './deepnote-file-schema'
import { deserializeDeepnoteFile } from './deserialize-deepnote-file'
import { serializeDeepnoteFile, serializeDeepnoteSnapshot } from './serialize-deepnote-file'

const createMinimalFile = (): DeepnoteFile => ({
  version: '1.0',
  metadata: {
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  project: {
    id: 'project-1',
    name: 'Test Project',
    notebooks: [],
  },
})

const createFileWithBlocks = (): DeepnoteFile => ({
  version: '1.0',
  metadata: {
    createdAt: '2024-01-01T00:00:00.000Z',
    modifiedAt: '2024-01-02T00:00:00.000Z',
    checksum: 'abc123',
  },
  environment: {
    python: {
      version: '3.11',
      environment: 'uv',
    },
  },
  project: {
    id: 'project-1',
    name: 'Test Project',
    notebooks: [
      {
        id: 'notebook-1',
        name: 'Main Notebook',
        blocks: [
          {
            id: 'block-1',
            blockGroup: 'group-1',
            sortingKey: '000001',
            type: 'code',
            content: 'print("hello")',
            metadata: {},
          },
          {
            id: 'block-2',
            blockGroup: 'group-1',
            sortingKey: '000002',
            type: 'markdown',
            content: '# Title',
            metadata: {},
          },
        ],
      },
    ],
  },
})

const createSnapshot = (): DeepnoteSnapshot => ({
  version: '1.0',
  metadata: {
    createdAt: '2024-01-01T00:00:00.000Z',
    modifiedAt: '2024-01-02T00:00:00.000Z',
    snapshotHash: 'snapshot-hash-123',
  },
  environment: {
    python: {
      version: '3.11',
    },
  },
  execution: {
    startedAt: '2024-01-02T00:00:00.000Z',
    finishedAt: '2024-01-02T00:01:00.000Z',
    triggeredBy: 'user',
    summary: {
      blocksExecuted: 2,
      blocksSucceeded: 2,
      blocksFailed: 0,
      totalDurationMs: 1000,
    },
  },
  project: {
    id: 'project-1',
    name: 'Test Project',
    notebooks: [
      {
        id: 'notebook-1',
        name: 'Main Notebook',
        blocks: [
          {
            id: 'block-1',
            blockGroup: 'group-1',
            sortingKey: '000001',
            type: 'code',
            content: 'x = 1',
            metadata: {},
            outputs: [{ output_type: 'execute_result', data: { 'text/plain': '1' } }],
          },
        ],
      },
    ],
  },
})

describe('serializeDeepnoteFile', () => {
  describe('roundtrip', () => {
    it('serializes and deserializes a minimal file correctly', () => {
      const file = createMinimalFile()
      const yaml = serializeDeepnoteFile(file)
      const parsed = deserializeDeepnoteFile(yaml)

      expect(parsed).toEqual(file)
    })

    it('serializes and deserializes a file with blocks correctly', () => {
      const file = createFileWithBlocks()
      const yaml = serializeDeepnoteFile(file)
      const parsed = deserializeDeepnoteFile(yaml)

      expect(parsed).toEqual(file)
    })

    it('serializes a snapshot and deserializes core fields correctly', () => {
      const snapshot = createSnapshot()
      const yaml = serializeDeepnoteSnapshot(snapshot)
      const parsed = deserializeDeepnoteFile(yaml)

      // Note: snapshotHash is not part of DeepnoteFile schema, so it's stripped during deserialization
      // We verify the YAML contains it in a separate test
      expect(parsed.version).toBe(snapshot.version)
      expect(parsed.project).toEqual(snapshot.project)
      expect(parsed.environment).toEqual(snapshot.environment)
      expect(parsed.execution).toEqual(snapshot.execution)
      expect(parsed.metadata.createdAt).toBe(snapshot.metadata.createdAt)
      expect(parsed.metadata.modifiedAt).toBe(snapshot.metadata.modifiedAt)
    })
  })

  describe('field ordering', () => {
    it('outputs top-level fields in schema order', () => {
      const file = createFileWithBlocks()
      const yaml = serializeDeepnoteFile(file)
      const lines = yaml.split('\n')

      const topLevelKeys = lines.filter(line => /^[a-z]/.test(line)).map(line => line.split(':')[0])

      // Schema order: environment, execution, metadata, project, version
      // Only present keys should appear, in that order
      expect(topLevelKeys).toEqual(['environment', 'metadata', 'project', 'version'])
    })

    it('outputs metadata fields in schema order', () => {
      const file = createFileWithBlocks()
      const yaml = serializeDeepnoteFile(file)

      // Extract metadata section
      const metadataMatch = yaml.match(/metadata:\n((?:\s{2}\w+:.*\n)+)/)
      expect(metadataMatch).not.toBeNull()

      const metadataLines = metadataMatch?.[1]
        ?.split('\n')
        .filter(line => line.trim())
        .map(line => line.trim().split(':')[0])

      // Schema order: checksum, createdAt, exportedAt, modifiedAt
      expect(metadataLines).toEqual(['checksum', 'createdAt', 'modifiedAt'])
    })

    it('outputs block fields in schema order', () => {
      const file = createFileWithBlocks()
      const yaml = serializeDeepnoteFile(file)

      // Find first block section (after "- id:")
      const blockMatch = yaml.match(/blocks:\n\s+-\s+(\w+):/)
      expect(blockMatch).not.toBeNull()

      // The first field of a block should be 'id' (from baseBlockFields)
      expect(blockMatch?.[1]).toBe('id')
    })

    it('outputs snapshot metadata with snapshotHash', () => {
      const snapshot = createSnapshot()
      const yaml = serializeDeepnoteSnapshot(snapshot)

      expect(yaml).toContain('snapshotHash:')

      // Extract metadata section
      const metadataMatch = yaml.match(/metadata:\n((?:\s{2}\w+:.*\n)+)/)
      expect(metadataMatch).not.toBeNull()

      const metadataLines = metadataMatch?.[1]
        ?.split('\n')
        .filter(line => line.trim())
        .map(line => line.trim().split(':')[0])

      expect(metadataLines).toContain('snapshotHash')
    })
  })

  describe('line width', () => {
    it('does not wrap long strings', () => {
      const file = createMinimalFile()
      const longContent = `x = ${'a'.repeat(200)}`
      file.project.notebooks = [
        {
          id: 'notebook-1',
          name: 'Test',
          blocks: [
            {
              id: 'block-1',
              blockGroup: 'group-1',
              sortingKey: '000001',
              type: 'code',
              content: longContent,
              metadata: {},
            },
          ],
        },
      ]

      const yaml = serializeDeepnoteFile(file)

      // The long content should appear on a single line (possibly with YAML literal/folded syntax)
      // It should NOT be broken into multiple lines mid-content
      expect(yaml).toContain('a'.repeat(50)) // At least 50 consecutive 'a's should appear
    })
  })

  describe('special characters', () => {
    it('handles quotes and special YAML characters', () => {
      const file = createMinimalFile()
      file.project.notebooks = [
        {
          id: 'notebook-1',
          name: 'Test',
          blocks: [
            {
              id: 'block-1',
              blockGroup: 'group-1',
              sortingKey: '000001',
              type: 'code',
              content: 'x = "hello: world" # comment with {braces}',
              metadata: {},
            },
          ],
        },
      ]

      const yaml = serializeDeepnoteFile(file)
      const parsed = deserializeDeepnoteFile(yaml)

      expect(parsed.project.notebooks[0].blocks[0].content).toBe('x = "hello: world" # comment with {braces}')
    })

    it('handles multiline content', () => {
      const file = createMinimalFile()
      const multilineContent = 'line1\nline2\nline3'
      file.project.notebooks = [
        {
          id: 'notebook-1',
          name: 'Test',
          blocks: [
            {
              id: 'block-1',
              blockGroup: 'group-1',
              sortingKey: '000001',
              type: 'code',
              content: multilineContent,
              metadata: {},
            },
          ],
        },
      ]

      const yaml = serializeDeepnoteFile(file)
      const parsed = deserializeDeepnoteFile(yaml)

      expect(parsed.project.notebooks[0].blocks[0].content).toBe(multilineContent)
    })
  })
})
