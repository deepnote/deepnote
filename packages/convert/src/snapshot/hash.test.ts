import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { addContentHashes, computeContentHash, computeSnapshotHash } from './hash'

describe('computeContentHash', () => {
  it('should compute SHA-256 hash of content', () => {
    const hash = computeContentHash('print("hello")')
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('should return different hashes for different content', () => {
    const hash1 = computeContentHash('print("hello")')
    const hash2 = computeContentHash('print("world")')
    expect(hash1).not.toBe(hash2)
  })

  it('should return same hash for same content', () => {
    const hash1 = computeContentHash('print("hello")')
    const hash2 = computeContentHash('print("hello")')
    expect(hash1).toBe(hash2)
  })

  it('should handle empty string', () => {
    const hash = computeContentHash('')
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('should handle unicode content', () => {
    const hash = computeContentHash('print("こんにちは")')
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})

describe('computeSnapshotHash', () => {
  const baseFile: DeepnoteFile = {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: 'proj-123',
      name: 'Test Project',
      notebooks: [],
    },
  }

  it('should compute hash from version', () => {
    const hash = computeSnapshotHash(baseFile)
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('should include environment hash if present', () => {
    const file1: DeepnoteFile = { ...baseFile }
    const file2: DeepnoteFile = {
      ...baseFile,
      environment: { hash: 'env-hash-123' },
    }

    const hash1 = computeSnapshotHash(file1)
    const hash2 = computeSnapshotHash(file2)

    expect(hash1).not.toBe(hash2)
  })

  it('should include integrations in hash', () => {
    const file1: DeepnoteFile = { ...baseFile }
    const file2: DeepnoteFile = {
      ...baseFile,
      project: {
        ...baseFile.project,
        integrations: [{ id: 'int-1', name: 'PostgreSQL', type: 'postgres' }],
      },
    }

    const hash1 = computeSnapshotHash(file1)
    const hash2 = computeSnapshotHash(file2)

    expect(hash1).not.toBe(hash2)
  })

  it('should include block content hashes', () => {
    const file1: DeepnoteFile = { ...baseFile }
    const file2: DeepnoteFile = {
      ...baseFile,
      project: {
        ...baseFile.project,
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
            ],
          },
        ],
      },
    }

    const hash1 = computeSnapshotHash(file1)
    const hash2 = computeSnapshotHash(file2)

    expect(hash1).not.toBe(hash2)
  })

  it('should produce deterministic hashes for same integrations in different order', () => {
    const file1: DeepnoteFile = {
      ...baseFile,
      project: {
        ...baseFile.project,
        integrations: [
          { id: 'int-1', name: 'A', type: 'a' },
          { id: 'int-2', name: 'B', type: 'b' },
        ],
      },
    }
    const file2: DeepnoteFile = {
      ...baseFile,
      project: {
        ...baseFile.project,
        integrations: [
          { id: 'int-2', name: 'B', type: 'b' },
          { id: 'int-1', name: 'A', type: 'a' },
        ],
      },
    }

    const hash1 = computeSnapshotHash(file1)
    const hash2 = computeSnapshotHash(file2)

    // Should be same since integrations are sorted
    expect(hash1).toBe(hash2)
  })
})

describe('addContentHashes', () => {
  it('should add content hashes to blocks without them', () => {
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

    const result = addContentHashes(file)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('should not overwrite existing content hashes', () => {
    const existingHash = 'sha256:abc123def456'
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
                contentHash: existingHash,
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    const result = addContentHashes(file)

    expect(result.project.notebooks[0].blocks[0].contentHash).toBe(existingHash)
  })

  it('should return a new file (immutability)', () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'proj-123',
        name: 'Test Project',
        notebooks: [],
      },
    }

    const result = addContentHashes(file)
    expect(result).not.toBe(file)
    expect(result).toEqual(file)
  })

  it('should skip blocks without content', () => {
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
                type: 'separator',
                blockGroup: 'bg-1',
                sortingKey: '0000',
                metadata: {},
              },
            ],
          },
        ],
      },
    }

    const result = addContentHashes(file)

    expect(result.project.notebooks[0].blocks[0].contentHash).toBeUndefined()
  })
})
