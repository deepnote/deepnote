import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { deepnoteSnapshotSchema } from './deepnote-file-schema'
import { deserializeDeepnoteFile } from './deserialize-deepnote-file'
import { parseYaml } from './parse-yaml'

/**
 * Recursively find all .deepnote files in a directory
 */
async function findDeepnoteFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    // Skip node_modules and hidden directories
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const subFiles = await findDeepnoteFiles(fullPath, baseDir)
      files.push(...subFiles)
    } else if (entry.isFile() && entry.name.endsWith('.deepnote')) {
      // Store relative path from base directory
      files.push(relative(baseDir, fullPath))
    }
  }

  return files.sort()
}

describe('validate all .deepnote files in the repository', () => {
  // Use paths relative to workspace root
  const workspaceRoot = join(__dirname, '../../../..')
  let deepnoteFiles: string[] = []

  // Discover all .deepnote files before running any tests
  beforeAll(async () => {
    deepnoteFiles = await findDeepnoteFiles(workspaceRoot)
  })

  it('discovers .deepnote files in the repository', () => {
    expect(deepnoteFiles.length).toBeGreaterThan(0)
  })

  it('validates all discovered .deepnote files', async () => {
    // Ensure files were discovered
    expect(deepnoteFiles.length).toBeGreaterThan(0)

    const results = await Promise.all(
      deepnoteFiles.map(async filePath => {
        const fullPath = join(workspaceRoot, filePath)
        const yamlContent = await readFile(fullPath, 'utf-8')

        // Should not throw and return a valid DeepnoteFile object
        // Validates UTF-8, no duplicates, no anchors/aliases/merge keys, no tags
        const result = deserializeDeepnoteFile(yamlContent)

        return { filePath, result }
      })
    )

    // All files should parse successfully
    expect(results).toHaveLength(deepnoteFiles.length)

    // Check that all files have valid structure
    for (const { filePath, result } of results) {
      expect(result, `${filePath} should be defined`).toBeDefined()
      expect(result.version, `${filePath} should have version`).toBeDefined()
      expect(result.project, `${filePath} should have project`).toBeDefined()
      expect(result.project.notebooks, `${filePath} should have notebooks`).toBeInstanceOf(Array)
      expect(result.metadata, `${filePath} should have metadata`).toBeDefined()
      expect(result.metadata.createdAt, `${filePath} should have createdAt`).toBeDefined()

      // Verify timestamps are strings (not Date objects)
      expect(typeof result.metadata.createdAt, `${filePath} createdAt should be string`).toBe('string')
    }
  })
})

describe('validate all .snapshot.deepnote files in examples/snapshots', () => {
  const workspaceRoot = join(__dirname, '../../../..')
  const snapshotsDir = join(workspaceRoot, 'examples/snapshots')
  let snapshotFiles: string[] = []

  beforeAll(async () => {
    const entries = await readdir(snapshotsDir, { withFileTypes: true })
    snapshotFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.snapshot.deepnote'))
      .map(entry => entry.name)
      .sort()
  })

  it('discovers .snapshot.deepnote files in examples/snapshots', () => {
    expect(snapshotFiles.length).toBeGreaterThan(0)
  })

  it('validates all snapshot files against deepnoteSnapshotSchema', async () => {
    expect(snapshotFiles.length).toBeGreaterThan(0)

    const results = await Promise.all(
      snapshotFiles.map(async fileName => {
        const fullPath = join(snapshotsDir, fileName)
        const yamlContent = await readFile(fullPath, 'utf-8')
        const parsed = parseYaml(yamlContent)
        const result = deepnoteSnapshotSchema.safeParse(parsed)

        return { fileName, result }
      })
    )

    for (const { fileName, result } of results) {
      if (!result.success) {
        const errors = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n  ')
        expect.fail(`${fileName} failed validation:\n  ${errors}`)
      }

      expect(result.data.environment, `${fileName} should have environment`).toBeDefined()
      expect(result.data.execution, `${fileName} should have execution`).toBeDefined()
    }
  })
})
