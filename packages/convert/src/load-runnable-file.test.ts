import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LoadRunnableFileError, loadRunnableFile, parseRunnableFileContent } from './load-runnable-file'

const testFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures')

describe('parseRunnableFileContent', () => {
  it('parses native .deepnote content without conversion', async () => {
    const fixturePath = path.join(testFixturesDir, 'simple.deepnote')
    const content = await fs.readFile(fixturePath, 'utf-8')
    const absolutePath = path.resolve(fixturePath)

    const result = parseRunnableFileContent(content, absolutePath)

    expect(result.format).toBe('deepnote')
    expect(result.wasConverted).toBe(false)
    expect(result.originalPath).toBe(absolutePath)
    expect(result.file.project.name).toBe('simple-test')
    expect(result.file.project.notebooks).toHaveLength(1)
  })

  it('matches loadRunnableFile for .deepnote files', async () => {
    const fixturePath = path.join(testFixturesDir, 'simple.deepnote')
    const content = await fs.readFile(fixturePath, 'utf-8')
    const absolutePath = path.resolve(fixturePath)

    const fromContent = parseRunnableFileContent(content, absolutePath)
    const fromDisk = await loadRunnableFile(fixturePath)

    expect(fromContent.file).toEqual(fromDisk.file)
    expect(fromContent.format).toBe(fromDisk.format)
    expect(fromContent.wasConverted).toBe(fromDisk.wasConverted)
  })

  it('throws LoadRunnableFileError for unsupported extensions', () => {
    expect(() => parseRunnableFileContent('hello', '/tmp/readme.txt')).toThrow(LoadRunnableFileError)
  })

  it('throws LoadRunnableFileError for invalid .deepnote YAML', () => {
    expect(() => parseRunnableFileContent('not: valid: yaml: [[', '/tmp/bad.deepnote')).toThrow(LoadRunnableFileError)
  })
})
