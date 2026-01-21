import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileResolutionError, resolvePathToDeepnoteFile } from './file-resolver'

// Use example files from the repo (tests run from root)
const EXAMPLES_DIR = 'examples'
const HELLO_WORLD_FILE = join(EXAMPLES_DIR, '1_hello_world.deepnote')
const IPYNB_FILE = join(EXAMPLES_DIR, '1_hello_world.ipynb')

describe('FileResolutionError', () => {
  it('is an instance of Error', () => {
    const error = new FileResolutionError('test message')
    expect(error).toBeInstanceOf(Error)
  })

  it('has correct name', () => {
    const error = new FileResolutionError('test message')
    expect(error.name).toBe('FileResolutionError')
  })

  it('has correct message', () => {
    const error = new FileResolutionError('test message')
    expect(error.message).toBe('test message')
  })
})

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

  describe('missing path', () => {
    it('throws FileResolutionError when path is undefined', async () => {
      await expect(resolvePathToDeepnoteFile(undefined)).rejects.toThrow(FileResolutionError)
      await expect(resolvePathToDeepnoteFile(undefined)).rejects.toThrow('Missing path to a .deepnote file')
    })

    it('uses custom error message when provided', async () => {
      const customMessage = 'Custom error message'
      await expect(resolvePathToDeepnoteFile(undefined, { missingPathMessage: customMessage })).rejects.toThrow(
        customMessage
      )
    })
  })

  describe('file not found', () => {
    it('throws FileResolutionError for non-existent file', async () => {
      const nonExistentPath = join(EXAMPLES_DIR, 'does-not-exist.deepnote')
      const absolutePath = resolve(process.cwd(), nonExistentPath)

      await expect(resolvePathToDeepnoteFile(nonExistentPath)).rejects.toThrow(FileResolutionError)
      await expect(resolvePathToDeepnoteFile(nonExistentPath)).rejects.toThrow(`File not found: ${absolutePath}`)
    })

    it('throws FileResolutionError when path is a directory', async () => {
      const absolutePath = resolve(process.cwd(), EXAMPLES_DIR)

      await expect(resolvePathToDeepnoteFile(EXAMPLES_DIR)).rejects.toThrow(FileResolutionError)
      await expect(resolvePathToDeepnoteFile(EXAMPLES_DIR)).rejects.toThrow(`Not a file: ${absolutePath}`)
    })

    it('includes suggestion for similar files', async () => {
      // Looking for a file that partially matches existing files
      const partialMatchPath = join(EXAMPLES_DIR, 'hello.deepnote')

      await expect(resolvePathToDeepnoteFile(partialMatchPath)).rejects.toThrow('Did you mean?')
    })

    it('shows available files when no similar match', async () => {
      const unrelatedPath = join(EXAMPLES_DIR, 'xyz123.deepnote')

      await expect(resolvePathToDeepnoteFile(unrelatedPath)).rejects.toThrow('Available .deepnote files')
    })
  })

  describe('invalid file extension', () => {
    it('throws FileResolutionError for non-.deepnote file', async () => {
      await expect(resolvePathToDeepnoteFile(IPYNB_FILE)).rejects.toThrow(FileResolutionError)
      await expect(resolvePathToDeepnoteFile(IPYNB_FILE)).rejects.toThrow('Unsupported file type: .ipynb')
    })

    it('includes hint about converting ipynb files', async () => {
      await expect(resolvePathToDeepnoteFile(IPYNB_FILE)).rejects.toThrow('@deepnote/convert')
    })

    it('throws FileResolutionError for file without extension', async () => {
      const noExtFile = join(tempDir, 'noext')
      await writeFile(noExtFile, 'content')

      await expect(resolvePathToDeepnoteFile(noExtFile)).rejects.toThrow(FileResolutionError)
      await expect(resolvePathToDeepnoteFile(noExtFile)).rejects.toThrow('Expected a .deepnote file')
    })

    it('shows hint for .json files', async () => {
      const jsonFile = join(tempDir, 'test.json')
      await writeFile(jsonFile, '{}')

      await expect(resolvePathToDeepnoteFile(jsonFile)).rejects.toThrow('JSON files are not supported')
    })

    it('shows hint for .yaml files', async () => {
      const yamlFile = join(tempDir, 'test.yaml')
      await writeFile(yamlFile, 'key: value')

      await expect(resolvePathToDeepnoteFile(yamlFile)).rejects.toThrow('YAML files are not directly supported')
    })

    it('shows hint for .py files', async () => {
      const pyFile = join(tempDir, 'test.py')
      await writeFile(pyFile, 'print("hello")')

      await expect(resolvePathToDeepnoteFile(pyFile)).rejects.toThrow('Python files are not supported')
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
