import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

  describe('auto-discovery (no path provided)', () => {
    let originalCwd: string
    let testDir: string

    beforeEach(async () => {
      originalCwd = process.cwd()
      testDir = join(tmpdir(), `file-resolver-auto-${Date.now()}`)
      await mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      process.chdir(originalCwd)
      await rm(testDir, { recursive: true, force: true })
    })

    it('finds .deepnote file in current directory when no path provided', async () => {
      await writeFile(join(testDir, 'project.deepnote'), 'content')
      process.chdir(testDir)

      const result = await resolvePathToDeepnoteFile(undefined)

      expect(result.absolutePath).toContain('project.deepnote')
    })

    it('selects first .deepnote file alphabetically when multiple exist', async () => {
      await writeFile(join(testDir, 'beta.deepnote'), 'content')
      await writeFile(join(testDir, 'alpha.deepnote'), 'content')
      await writeFile(join(testDir, 'gamma.deepnote'), 'content')
      process.chdir(testDir)

      const result = await resolvePathToDeepnoteFile(undefined)

      expect(result.absolutePath).toContain('alpha.deepnote')
    })

    it('throws FileResolutionError when no .deepnote files in current directory', async () => {
      await writeFile(join(testDir, 'not-a-notebook.txt'), 'content')
      process.chdir(testDir)

      const promise = resolvePathToDeepnoteFile(undefined)
      await expect(promise).rejects.toThrow(FileResolutionError)
      await expect(promise).rejects.toThrow('No .deepnote files found')
    })

    it('uses custom error message when provided and no files found', async () => {
      process.chdir(testDir)
      const customMessage = 'Custom no files message'

      await expect(resolvePathToDeepnoteFile(undefined, { noFilesFoundMessage: customMessage })).rejects.toThrow(
        customMessage
      )
    })
  })

  describe('directory path provided', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = join(tmpdir(), `file-resolver-dir-${Date.now()}`)
      await mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('finds .deepnote file in specified directory', async () => {
      await writeFile(join(testDir, 'notebook.deepnote'), 'content')

      const result = await resolvePathToDeepnoteFile(testDir)

      expect(result.absolutePath).toContain('notebook.deepnote')
    })

    it('selects first .deepnote file alphabetically in directory', async () => {
      await writeFile(join(testDir, 'zebra.deepnote'), 'content')
      await writeFile(join(testDir, 'aardvark.deepnote'), 'content')

      const result = await resolvePathToDeepnoteFile(testDir)

      expect(result.absolutePath).toContain('aardvark.deepnote')
    })

    it('throws FileResolutionError when directory has no .deepnote files', async () => {
      await writeFile(join(testDir, 'other.txt'), 'content')

      const promise = resolvePathToDeepnoteFile(testDir)
      await expect(promise).rejects.toThrow(FileResolutionError)
      await expect(promise).rejects.toThrow('No .deepnote files found')
    })

    it('works with examples directory from repo root', async () => {
      const result = await resolvePathToDeepnoteFile(EXAMPLES_DIR)

      // Should find first alphabetically (1_hello_world.deepnote)
      expect(result.absolutePath).toContain('1_hello_world.deepnote')
    })
  })

  describe('file not found', () => {
    it('throws FileResolutionError for non-existent file', async () => {
      const nonExistentPath = join(EXAMPLES_DIR, 'does-not-exist.deepnote')
      const absolutePath = resolve(process.cwd(), nonExistentPath)

      const promise = resolvePathToDeepnoteFile(nonExistentPath)
      await expect(promise).rejects.toThrow(FileResolutionError)
      await expect(promise).rejects.toThrow(`File not found: ${absolutePath}`)
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
      const promise = resolvePathToDeepnoteFile(IPYNB_FILE)
      await expect(promise).rejects.toThrow(FileResolutionError)
      await expect(promise).rejects.toThrow('Unsupported file type: .ipynb')
    })

    it('includes hint about converting ipynb files', async () => {
      await expect(resolvePathToDeepnoteFile(IPYNB_FILE)).rejects.toThrow('@deepnote/convert')
    })

    it('throws FileResolutionError for file without extension', async () => {
      const noExtFile = join(tempDir, 'noext')
      await writeFile(noExtFile, 'content')

      const promise = resolvePathToDeepnoteFile(noExtFile)
      await expect(promise).rejects.toThrow(FileResolutionError)
      await expect(promise).rejects.toThrow('Expected a .deepnote file')
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
