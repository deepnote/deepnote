import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findSnapshotsForProject,
  getSnapshotDir,
  getSnapshotPath,
  loadLatestSnapshot,
  loadSnapshotFile,
  parseSnapshotFilename,
  parseSourceFilePath,
  snapshotExists,
} from './lookup'
import { generateSnapshotFilename } from './split'

// Mock fs module
vi.mock('node:fs/promises')

function createSingleNotebookFile(overrides?: { projectName?: string }): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    environment: {},
    project: {
      id: 'test-project-id-1234-5678-90ab',
      name: overrides?.projectName ?? 'Test Project',
      notebooks: [
        {
          id: 'notebook-1',
          name: 'Notebook 1',
          blocks: [],
        },
      ],
    },
  }
}

describe('parseSnapshotFilename', () => {
  it('should parse valid snapshot filename with latest', () => {
    const result = parseSnapshotFilename('my-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote')

    expect(result).toEqual({
      slug: 'my-project',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      timestamp: 'latest',
    })
  })

  it('should parse valid snapshot filename with timestamp', () => {
    const result = parseSnapshotFilename(
      'customer-analysis_2e814690-4f02-465c-8848-5567ab9253b7_2025-01-08T10-30-00.snapshot.deepnote'
    )

    expect(result).toEqual({
      slug: 'customer-analysis',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      timestamp: '2025-01-08T10-30-00',
    })
  })

  it('should handle slugs with multiple hyphens', () => {
    const result = parseSnapshotFilename(
      'my-cool-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote'
    )

    expect(result).toEqual({
      slug: 'my-cool-project',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      timestamp: 'latest',
    })
  })

  it('should return null for invalid filename', () => {
    expect(parseSnapshotFilename('notebook.deepnote')).toBeNull()
    expect(parseSnapshotFilename('invalid.snapshot.deepnote')).toBeNull()
    expect(parseSnapshotFilename('my-project_invalid-uuid_latest.snapshot.deepnote')).toBeNull()
  })

  it('should return null for non-snapshot files', () => {
    expect(parseSnapshotFilename('my-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.deepnote')).toBeNull()
  })

  it('should parse new-format filename with notebookId', () => {
    const result = parseSnapshotFilename(
      'my-project_2e814690-4f02-465c-8848-5567ab9253b7_d8fd4cfe9ce04908a4ed611000d231e4_latest.snapshot.deepnote'
    )
    expect(result).toEqual({
      slug: 'my-project',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      notebookId: 'd8fd4cfe9ce04908a4ed611000d231e4',
      timestamp: 'latest',
    })
  })

  it('should parse notebook-aware snapshot filenames whose notebook id is not UUID-shaped', () => {
    // Regression: non-UUID notebook ids must still parse, or such snapshots vanish from lookup.
    const result = parseSnapshotFilename(
      'my-project_2e814690-4f02-465c-8848-5567ab9253b7_nb-1_latest.snapshot.deepnote'
    )

    expect(result).toEqual({
      slug: 'my-project',
      projectId: '2e814690-4f02-465c-8848-5567ab9253b7',
      notebookId: 'nb-1',
      timestamp: 'latest',
    })
  })

  it('should return undefined notebookId for old-format filename', () => {
    const result = parseSnapshotFilename('my-project_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote')
    expect(result?.notebookId).toBeUndefined()
  })
})

describe('generateSnapshotFilename ↔ parseSnapshotFilename round-trip', () => {
  const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'

  it.each([
    '2e814690-4f02-465c-8848-5567ab9253b7', // UUID
    'd8fd4cfe9ce04908a4ed611000d231e4', // 32-char hex
    'nb-1',
    'nb_1',
    'nb.1',
    'a_b.c',
    'my.notebook.v2',
    'weird id/with\\sep.chars',
    'café-π',
    '_leading-underscore', // parser must accept leading _/- that the encoder preserves verbatim
    '-leading-dash',
    '_1',
  ])('recovers notebook id %s embedded in the generated filename', id => {
    const filename = generateSnapshotFilename({
      slug: 'my-project',
      projectId,
      notebookId: id,
      timestamp: '2025-01-08T10-30-00',
    })

    const parsed = parseSnapshotFilename(filename)

    expect(parsed?.notebookId).toBe(id)
    expect(parsed?.projectId).toBe(projectId)
    expect(parsed?.timestamp).toBe('2025-01-08T10-30-00')
  })
})

describe('getSnapshotDir', () => {
  it('should return default snapshot directory', () => {
    const result = getSnapshotDir('/path/to/project.deepnote')
    expect(result).toBe('/path/to/snapshots')
  })

  it('should use custom snapshot directory', () => {
    const result = getSnapshotDir('/path/to/project.deepnote', { snapshotDir: 'custom-snapshots' })
    expect(result).toBe('/path/to/custom-snapshots')
  })

  it('should handle nested paths', () => {
    const result = getSnapshotDir('/Users/test/projects/my-project/notebook.deepnote')
    expect(result).toBe('/Users/test/projects/my-project/snapshots')
  })
})

describe('getSnapshotPath', () => {
  it('returns the latest notebook-scoped snapshot path for a single-notebook file', () => {
    const file = createSingleNotebookFile()
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

  it('handles project name with special characters', () => {
    const file = createSingleNotebookFile({ projectName: 'My Project (Draft) #1' })
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

  it('uses "project" as fallback for empty name', () => {
    const file = createSingleNotebookFile({ projectName: '' })
    const sourcePath = '/path/to/project.deepnote'

    const result = getSnapshotPath(sourcePath, file)

    expect(result).toBe(
      resolve('/path/to', 'snapshots', 'project_test-project-id-1234-5678-90ab_notebook-1_latest.snapshot.deepnote')
    )
  })

  it('allows overriding the slug source via projectName', () => {
    const file = createSingleNotebookFile()
    const sourcePath = '/path/to/project.deepnote'

    const result = getSnapshotPath(sourcePath, file, { projectName: 'Custom Export Name' })

    expect(result).toBe(
      resolve(
        '/path/to',
        'snapshots',
        'custom-export-name_test-project-id-1234-5678-90ab_notebook-1_latest.snapshot.deepnote'
      )
    )
  })

  it('embeds a timestamp segment when provided', () => {
    const file = createSingleNotebookFile()
    const sourcePath = '/path/to/project.deepnote'

    const result = getSnapshotPath(sourcePath, file, { timestamp: '2024-01-01T00-00-05' })

    expect(result).toBe(
      resolve(
        '/path/to',
        'snapshots',
        'test-project_test-project-id-1234-5678-90ab_notebook-1_2024-01-01T00-00-05.snapshot.deepnote'
      )
    )
  })

  it('uses the main notebook id for composed init+main files', async () => {
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
          { id: initNotebookId, name: 'Init', blocks: [] },
          { id: mainNotebookId, name: 'Main', blocks: [] },
        ],
      },
    }

    const result = getSnapshotPath('/path/to/split.deepnote', file)

    expect(result).toBe(
      resolve('/path/to', 'snapshots', `init-main-project_${projectId}_${mainNotebookId}_latest.snapshot.deepnote`)
    )
  })

  it('falls back to project-wide filenames for multi-notebook files without init scope', () => {
    const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      environment: {},
      project: {
        id: projectId,
        name: 'Multi Notebook',
        notebooks: [
          { id: 'nb-a', name: 'A', blocks: [] },
          { id: 'nb-b', name: 'B', blocks: [] },
        ],
      },
    }

    const result = getSnapshotPath('/path/to/project.deepnote', file)

    expect(result).toBe(resolve('/path/to', 'snapshots', `multi-notebook_${projectId}_latest.snapshot.deepnote`))
  })
})

describe('parseSourceFilePath', () => {
  it('should extract directory and name', () => {
    const result = parseSourceFilePath('/path/to/project.deepnote')

    expect(result).toEqual({
      dir: '/path/to',
      name: 'project',
    })
  })

  it('should handle complex filenames', () => {
    const result = parseSourceFilePath('/path/to/my-complex-project-name.deepnote')

    expect(result).toEqual({
      dir: '/path/to',
      name: 'my-complex-project-name',
    })
  })

  it('should handle root directory', () => {
    const result = parseSourceFilePath('/project.deepnote')

    expect(result).toEqual({
      dir: '/',
      name: 'project',
    })
  })
})

describe('findSnapshotsForProject', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return empty array when snapshot directory does not exist', async () => {
    vi.mocked(fs.readdir).mockRejectedValue({ code: 'ENOENT' })

    const result = await findSnapshotsForProject('/path/to', 'test-project-id')

    expect(result).toEqual([])
  })

  it('should return empty array when no matching snapshots', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'other-project_different-id_latest.snapshot.deepnote', isFile: () => true },
      { name: 'not-a-snapshot.txt', isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await findSnapshotsForProject('/path/to', '2e814690-4f02-465c-8848-5567ab9253b7')

    expect(result).toEqual([])
  })

  it('should return matching snapshots sorted with latest first', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_2025-01-01T10-00-00.snapshot.deepnote`, isFile: () => true },
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
      { name: `my-project_${projectId}_2025-01-02T10-00-00.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await findSnapshotsForProject('/path/to', projectId)

    expect(result).toHaveLength(3)
    expect(result[0].timestamp).toBe('latest')
    expect(result[1].timestamp).toBe('2025-01-02T10-00-00')
    expect(result[2].timestamp).toBe('2025-01-01T10-00-00')
  })

  it('should throw on unexpected filesystem errors', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'))

    await expect(findSnapshotsForProject('/path/to', 'test-id')).rejects.toThrow('Permission denied')
  })

  it('should filter by notebookId when provided', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const nbId1 = 'd8fd4cfe9ce04908a4ed611000d231e4'
    const nbId2 = 'e9fd5cfe0ce05908b5ed711000e341f5'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
      { name: `my-project_${projectId}_${nbId1}_latest.snapshot.deepnote`, isFile: () => true },
      { name: `my-project_${projectId}_${nbId2}_latest.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await findSnapshotsForProject('/path/to', projectId, { notebookId: nbId1 })
    expect(result).toHaveLength(2)
    const ids = result.map(s => s.notebookId)
    expect(ids).toContain(nbId1)
    expect(ids).toContain(undefined)
  })

  it('returns only legacy snapshots when notebookId not provided (never a split sibling)', async () => {
    // An unscoped load is for the original multi-notebook / legacy file. It must NOT pick up a split
    // sibling's notebook-scoped snapshot, or it would load an arbitrary notebook's outputs (P1 bug).
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const nbId1 = 'd8fd4cfe9ce04908a4ed611000d231e4'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
      { name: `my-project_${projectId}_${nbId1}_latest.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await findSnapshotsForProject('/path/to', projectId)
    expect(result).toHaveLength(1)
    expect(result[0].notebookId).toBeUndefined()
  })

  it('should rank notebookId-matching snapshots above legacy snapshots regardless of readdir order', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const nbId1 = 'd8fd4cfe9ce04908a4ed611000d231e4'
    const legacyName = `my-project_${projectId}_latest.snapshot.deepnote`
    const newFormatName = `my-project_${projectId}_${nbId1}_latest.snapshot.deepnote`

    vi.mocked(fs.readdir).mockResolvedValue([
      { name: legacyName, isFile: () => true },
      { name: newFormatName, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const legacyFirst = await findSnapshotsForProject('/path/to', projectId, { notebookId: nbId1 })

    expect(legacyFirst).toHaveLength(2)
    expect(legacyFirst[0].notebookId).toBe(nbId1)

    vi.mocked(fs.readdir).mockResolvedValue([
      { name: newFormatName, isFile: () => true },
      { name: legacyName, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const newFormatFirst = await findSnapshotsForProject('/path/to', projectId, { notebookId: nbId1 })

    expect(newFormatFirst).toEqual(legacyFirst)
  })

  it('should fall back to legacy snapshot when no notebookId match exists', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await findSnapshotsForProject('/path/to', projectId, { notebookId: 'nb-xyz' })

    expect(result).toHaveLength(1)
    expect(result[0].notebookId).toBeUndefined()
  })

  it('finds a scoped snapshot whose notebook id has filename-unsafe characters (regression: lossy id sanitization)', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const notebookId = 'nb.1'
    // Use the real writer so the on-disk name matches what `saveExecutionSnapshot` would produce.
    const scopedName = generateSnapshotFilename({ slug: 'my-project', projectId, notebookId })
    vi.mocked(fs.readdir).mockResolvedValue([{ name: scopedName, isFile: () => true }] as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >)

    const result = await findSnapshotsForProject('/path/to', projectId, { notebookId })

    expect(result).toHaveLength(1)
    expect(result[0].notebookId).toBe(notebookId)
  })

  it('does not alias ids that previously collided under sanitization (`nb.1` vs `nb_1`)', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const dottedName = generateSnapshotFilename({ slug: 'my-project', projectId, notebookId: 'nb.1' })
    const underscoreName = generateSnapshotFilename({ slug: 'my-project', projectId, notebookId: 'nb_1' })

    // Distinct filenames → no overwrite on write.
    expect(dottedName).not.toBe(underscoreName)

    vi.mocked(fs.readdir).mockResolvedValue([
      { name: dottedName, isFile: () => true },
      { name: underscoreName, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    // …and each lookup returns only its own snapshot, never the other.
    const dotted = await findSnapshotsForProject('/path/to', projectId, { notebookId: 'nb.1' })
    expect(dotted.map(s => s.notebookId)).toEqual(['nb.1'])

    const underscore = await findSnapshotsForProject('/path/to', projectId, { notebookId: 'nb_1' })
    expect(underscore.map(s => s.notebookId)).toEqual(['nb_1'])
  })
})

describe('loadSnapshotFile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should parse valid snapshot file', async () => {
    const snapshotContent = `
version: "1.0.0"
metadata:
  createdAt: "2025-01-01T00:00:00Z"
  snapshotHash: "sha256:abc123"
environment: {}
execution: {}
project:
  id: "test-project-id"
  name: "Test Project"
  notebooks: []
  integrations: []
  settings: {}
`
    vi.mocked(fs.readFile).mockResolvedValue(snapshotContent)

    const result = await loadSnapshotFile('/path/to/snapshot.snapshot.deepnote')

    expect(result.version).toBe('1.0.0')
    expect(result.project.id).toBe('test-project-id')
    expect(result.project.name).toBe('Test Project')
  })

  it('should throw on invalid YAML', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('invalid: yaml: content:')

    await expect(loadSnapshotFile('/path/to/snapshot.snapshot.deepnote')).rejects.toThrow()
  })
})

describe('loadLatestSnapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return null when no snapshots exist', async () => {
    vi.mocked(fs.readdir).mockRejectedValue({ code: 'ENOENT' })

    const result = await loadLatestSnapshot('/path/to/project.deepnote', 'test-project-id')

    expect(result).toBeNull()
  })

  it('should load the latest snapshot when available', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const snapshotContent = `
version: "1.0.0"
metadata:
  createdAt: "2025-01-01T00:00:00Z"
  snapshotHash: "sha256:abc123"
environment: {}
execution: {}
project:
  id: "${projectId}"
  name: "Test Project"
  notebooks: []
  integrations: []
  settings: {}
`
    vi.mocked(fs.readFile).mockResolvedValue(snapshotContent)

    const result = await loadLatestSnapshot('/path/to/project.deepnote', projectId)

    expect(result).not.toBeNull()
    expect(result?.project.id).toBe(projectId)
  })

  it('should discover and load a notebook-scoped latest snapshot when the notebook id is notebook-1', async () => {
    // Regression: snapshots with non-UUID notebook ids must be discoverable and loadable.
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const snapshotName = `my-project_${projectId}_notebook-1_latest.snapshot.deepnote`
    vi.mocked(fs.readdir).mockResolvedValue([{ name: snapshotName, isFile: () => true }] as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >)

    const snapshotContent = `
version: "1.0.0"
metadata:
  createdAt: "2025-01-01T00:00:00Z"
  snapshotHash: "sha256:abc123"
environment: {}
execution: {}
project:
  id: "${projectId}"
  name: "Test Project"
  notebooks: []
  integrations: []
  settings: {}
`
    vi.mocked(fs.readFile).mockResolvedValue(snapshotContent)

    const result = await loadLatestSnapshot('/path/to/project.deepnote', projectId, {
      notebookId: 'notebook-1',
    })

    expect(result).not.toBeNull()
    expect(result?.project.id).toBe(projectId)
  })
})

describe('snapshotExists', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return false when no snapshots exist', async () => {
    vi.mocked(fs.readdir).mockRejectedValue({ code: 'ENOENT' })

    const result = await snapshotExists('/path/to/project.deepnote', 'test-project-id')

    expect(result).toBe(false)
  })

  it('should return true when snapshots exist', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `my-project_${projectId}_latest.snapshot.deepnote`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)

    const result = await snapshotExists('/path/to/project.deepnote', projectId)

    expect(result).toBe(true)
  })
})
