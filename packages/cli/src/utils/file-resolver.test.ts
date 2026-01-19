import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveDeepnoteFile } from './file-resolver'

// Use example files from the repo (tests run from root)
const EXAMPLES_DIR = 'examples'
const HELLO_WORLD_FILE = join(EXAMPLES_DIR, '1_hello_world.deepnote')
const IPYNB_FILE = join(EXAMPLES_DIR, '1_hello_world.ipynb')

describe('resolveDeepnoteFile', () => {
  // Temp directory only needed for edge cases (case-insensitive extension, file without extension)
  let tempDir: string

  beforeAll(async () => {
    tempDir = join(tmpdir(), `file-resolver-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('missing path', () => {
    it('throws error when path is undefined', async () => {
      await expect(resolveDeepnoteFile(undefined)).rejects.toThrow('Missing path to a .deepnote file.')
    })

    it('throws error when path is empty string', async () => {
      await expect(resolveDeepnoteFile('')).rejects.toThrow('Missing path to a .deepnote file.')
    })

    it('uses custom error message when provided', async () => {
      await expect(resolveDeepnoteFile(undefined, { missingPathMessage: 'Custom error message' })).rejects.toThrow(
        'Custom error message'
      )
    })
  })

  describe('file not found', () => {
    it('throws error for non-existent file', async () => {
      const nonExistentPath = join(EXAMPLES_DIR, 'does-not-exist.deepnote')
      const absolutePath = resolve(process.cwd(), nonExistentPath)

      await expect(resolveDeepnoteFile(nonExistentPath)).rejects.toThrow(`File not found: ${absolutePath}`)
    })

    it('throws error when path is a directory', async () => {
      const absolutePath = resolve(process.cwd(), EXAMPLES_DIR)

      await expect(resolveDeepnoteFile(EXAMPLES_DIR)).rejects.toThrow(`File not found: ${absolutePath}`)
    })
  })

  describe('invalid file extension', () => {
    it('throws error for non-.deepnote file', async () => {
      await expect(resolveDeepnoteFile(IPYNB_FILE)).rejects.toThrow('Expected a .deepnote file')
    })

    it('throws error for file without extension', async () => {
      const noExtFile = join(tempDir, 'noext')
      await writeFile(noExtFile, 'content')

      await expect(resolveDeepnoteFile(noExtFile)).rejects.toThrow('Expected a .deepnote file')
    })
  })

  describe('valid .deepnote file', () => {
    it('resolves relative path to absolute', async () => {
      const expectedAbsolute = resolve(process.cwd(), HELLO_WORLD_FILE)

      const result = await resolveDeepnoteFile(HELLO_WORLD_FILE)

      expect(result.absolutePath).toBe(expectedAbsolute)
    })

    it('resolves absolute path', async () => {
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      const result = await resolveDeepnoteFile(absolutePath)

      expect(result.absolutePath).toBe(absolutePath)
    })

    it('handles case-insensitive extension (.DEEPNOTE)', async () => {
      const upperCaseFile = join(tempDir, 'test.DEEPNOTE')
      await writeFile(upperCaseFile, 'content')

      const result = await resolveDeepnoteFile(upperCaseFile)

      expect(result.absolutePath).toBe(upperCaseFile)
    })

    it('handles mixed-case extension (.DeepNote)', async () => {
      const mixedCaseFile = join(tempDir, 'test.DeepNote')
      await writeFile(mixedCaseFile, 'content')

      const result = await resolveDeepnoteFile(mixedCaseFile)

      expect(result.absolutePath).toBe(mixedCaseFile)
    })
  })

  describe('return value', () => {
    it('returns object with absolutePath property', async () => {
      const result = await resolveDeepnoteFile(HELLO_WORLD_FILE)

      expect(result).toHaveProperty('absolutePath')
      expect(typeof result.absolutePath).toBe('string')
    })
  })
})
