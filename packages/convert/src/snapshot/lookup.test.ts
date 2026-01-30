import { describe, expect, it } from 'vitest'
import { getSnapshotDir, parseSnapshotFilename, parseSourceFilePath } from './lookup'

// Note: File I/O tests (findSnapshotsForProject, loadLatestSnapshot, loadSnapshotFile,
// snapshotExists) have been moved to @deepnote/runtime-core.

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
