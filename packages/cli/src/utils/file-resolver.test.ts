import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePathToDeepnoteFile } from './file-resolver'

// Use example files from the repo (tests run from root)
const EXAMPLES_DIR = 'examples'
const HELLO_WORLD_FILE = join(EXAMPLES_DIR, '1_hello_world.deepnote')
const IPYNB_FILE = join(EXAMPLES_DIR, '1_hello_world.ipynb')

describe('resolvePathToDeepnoteFile', () => {
  // Temp directory only needed for edge cases (case-insensitive extension, file without extension)
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `file-resolver-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('file not found', () => {
    it('throws error for non-existent file', async () => {
      const nonExistentPath = join(EXAMPLES_DIR, 'does-not-exist.deepnote')
      const absolutePath = resolve(process.cwd(), nonExistentPath)

      await expect(resolvePathToDeepnoteFile(nonExistentPath)).rejects.toThrow(`File not found: ${absolutePath}`)
    })

    it('throws error when path is a directory', async () => {
      const absolutePath = resolve(process.cwd(), EXAMPLES_DIR)

      await expect(resolvePathToDeepnoteFile(EXAMPLES_DIR)).rejects.toThrow(
        `Expected a file, but got a directory: ${absolutePath}`
      )
    })
  })

  describe('invalid file extension', () => {
    it('throws error for non-.deepnote file', async () => {
      await expect(resolvePathToDeepnoteFile(IPYNB_FILE)).rejects.toThrow('Expected a .deepnote file')
    })

    it('throws error for file without extension', async () => {
      const noExtFile = join(tempDir, 'noext')
      await writeFile(noExtFile, 'content')

      await expect(resolvePathToDeepnoteFile(noExtFile)).rejects.toThrow('Expected a .deepnote file')
    })
  })

  describe('valid .deepnote file', () => {
    it('resolves relative path to absolute', async () => {
      const expectedAbsolute = resolve(process.cwd(), HELLO_WORLD_FILE)

      const result = await resolvePathToDeepnoteFile(HELLO_WORLD_FILE)

      expect(result.absolutePath).toBe(expectedAbsolute)
    })

    it('resolves absolute path', async () => {
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      const result = await resolvePathToDeepnoteFile(absolutePath)

      expect(result.absolutePath).toBe(absolutePath)
    })

    it('handles case-insensitive extension (.DEEPNOTE)', async () => {
      const upperCaseFile = join(tempDir, 'test.DEEPNOTE')
      await writeFile(upperCaseFile, 'content')

      const result = await resolvePathToDeepnoteFile(upperCaseFile)

      expect(result.absolutePath).toBe(upperCaseFile)
    })

    it('handles mixed-case extension (.DeepNote)', async () => {
      const mixedCaseFile = join(tempDir, 'test.DeepNote')
      await writeFile(mixedCaseFile, 'content')

      const result = await resolvePathToDeepnoteFile(mixedCaseFile)

      expect(result.absolutePath).toBe(mixedCaseFile)
    })
  })

  describe('return value', () => {
    it('returns object with absolutePath property', async () => {
      const result = await resolvePathToDeepnoteFile(HELLO_WORLD_FILE)

      expect(result).toHaveProperty('absolutePath')
      expect(typeof result.absolutePath).toBe('string')
    })
  })
})
