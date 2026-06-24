import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleConversionTool } from './conversion'

interface ToolResponse {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

function extractResult(response: ToolResponse): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

function minimalIpynb(source: string): string {
  return JSON.stringify({
    cells: [{ cell_type: 'code', source: [source], metadata: {}, outputs: [], execution_count: null }],
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  })
}

async function readDeepnote(filePath: string) {
  return deserializeDeepnoteFile(await fs.readFile(filePath, 'utf-8'))
}

describe('deepnote_convert_to', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-conversion-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('single file input', () => {
    it('converts a single .ipynb to one .deepnote file (auto-detect, default output path)', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hello")'))

      const response = (await handleConversionTool('deepnote_convert_to', { inputPath })) as ToolResponse
      expect(response.isError).toBeFalsy()

      const result = extractResult(response)
      const expectedOutput = path.join(tempDir, 'analysis.deepnote')
      expect(result.success).toBe(true)
      expect(result.outputPath).toBe(expectedOutput)
      expect(result.detectedFormat).toBe('jupyter')
      expect(result.projectName).toBe('analysis')
      expect(result.outputIsDirectory).toBe(false)
      expect(result.inputFiles).toEqual([inputPath])
      expect(result.outputFiles).toEqual([expectedOutput])

      // The file actually exists and is a single-notebook Deepnote file.
      const file = await readDeepnote(expectedOutput)
      expect(file.project.name).toBe('analysis')
      expect(file.project.notebooks.length).toBe(1)
    })

    it('honors an explicit outputPath ending in .deepnote', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hi")'))
      const outputPath = path.join(tempDir, 'custom.deepnote')

      const response = (await handleConversionTool('deepnote_convert_to', { inputPath, outputPath })) as ToolResponse
      const result = extractResult(response)
      expect(result.outputPath).toBe(outputPath)
      await expect(fs.stat(outputPath)).resolves.toBeDefined()
    })

    it('appends .deepnote when the explicit outputPath has no extension', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hi")'))
      const outputPath = path.join(tempDir, 'custom')

      const response = (await handleConversionTool('deepnote_convert_to', { inputPath, outputPath })) as ToolResponse
      const result = extractResult(response)
      expect(result.outputPath).toBe(`${outputPath}.deepnote`)
    })

    it('writes into an existing directory passed as outputPath', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hi")'))
      const outDir = path.join(tempDir, 'out')
      await fs.mkdir(outDir)

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath,
        outputPath: outDir,
      })) as ToolResponse
      const result = extractResult(response)
      expect(result.outputPath).toBe(path.join(outDir, 'analysis.deepnote'))
    })

    it('uses the provided projectName', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hi")'))

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath,
        projectName: 'My Project',
      })) as ToolResponse
      const result = extractResult(response)
      expect(result.projectName).toBe('My Project')

      const file = await readDeepnote(result.outputPath as string)
      expect(file.project.name).toBe('My Project')
    })

    it('respects an explicit format', async () => {
      const inputPath = path.join(tempDir, 'analysis.ipynb')
      await fs.writeFile(inputPath, minimalIpynb('print("hi")'))

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath,
        format: 'jupyter',
      })) as ToolResponse
      const result = extractResult(response)
      expect(result.detectedFormat).toBe('jupyter')
    })
  })

  describe('directory input', () => {
    it('converts each notebook to its own single-notebook .deepnote sharing one project id', async () => {
      const inputDir = path.join(tempDir, 'notebooks')
      await fs.mkdir(inputDir)
      await fs.writeFile(path.join(inputDir, 'first.ipynb'), minimalIpynb('print(1)'))
      await fs.writeFile(path.join(inputDir, 'second.ipynb'), minimalIpynb('print(2)'))

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: inputDir,
        format: 'jupyter',
      })) as ToolResponse
      expect(response.isError).toBeFalsy()

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.outputIsDirectory).toBe(true)
      // Output directory defaults to the input directory.
      expect(result.outputPath).toBe(inputDir)
      expect(result.detectedFormat).toBe('jupyter')
      // projectName derives from the directory name.
      expect(result.projectName).toBe('notebooks')

      const outputFiles = result.outputFiles as string[]
      expect(outputFiles).toHaveLength(2)
      // One output named after each source notebook.
      expect(outputFiles).toEqual([path.join(inputDir, 'first.deepnote'), path.join(inputDir, 'second.deepnote')])

      const firstFile = await readDeepnote(outputFiles[0])
      const secondFile = await readDeepnote(outputFiles[1])
      // Each output is a single-notebook file...
      expect(firstFile.project.notebooks.length).toBe(1)
      expect(secondFile.project.notebooks.length).toBe(1)
      // ...and they share one generated project id.
      expect(firstFile.project.id).toBe(secondFile.project.id)
      expect(firstFile.project.name).toBe('notebooks')
      expect(secondFile.project.name).toBe('notebooks')
    })

    it('writes outputs into an explicit output directory', async () => {
      const inputDir = path.join(tempDir, 'notebooks')
      await fs.mkdir(inputDir)
      await fs.writeFile(path.join(inputDir, 'first.ipynb'), minimalIpynb('print(1)'))
      const outDir = path.join(tempDir, 'converted')

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: inputDir,
        outputPath: outDir,
        format: 'jupyter',
      })) as ToolResponse
      const result = extractResult(response)
      expect(result.outputPath).toBe(outDir)
      expect(result.outputFiles).toEqual([path.join(outDir, 'first.deepnote')])
      // The output directory is created if missing.
      await expect(fs.stat(path.join(outDir, 'first.deepnote'))).resolves.toBeDefined()
    })

    it('uses the provided projectName for every file in a directory', async () => {
      const inputDir = path.join(tempDir, 'notebooks')
      await fs.mkdir(inputDir)
      await fs.writeFile(path.join(inputDir, 'first.ipynb'), minimalIpynb('print(1)'))
      await fs.writeFile(path.join(inputDir, 'second.ipynb'), minimalIpynb('print(2)'))

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: inputDir,
        projectName: 'Shared Project',
        format: 'jupyter',
      })) as ToolResponse
      const result = extractResult(response)
      expect(result.projectName).toBe('Shared Project')

      const outputFiles = result.outputFiles as string[]
      for (const outputFile of outputFiles) {
        const file = await readDeepnote(outputFile)
        expect(file.project.name).toBe('Shared Project')
      }
    })

    it('errors when no files match the requested format in the directory', async () => {
      const inputDir = path.join(tempDir, 'empty')
      await fs.mkdir(inputDir)

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: inputDir,
        format: 'jupyter',
      })) as ToolResponse
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('No input files found')
    })

    it('errors when format is auto for a directory input', async () => {
      const inputDir = path.join(tempDir, 'notebooks')
      await fs.mkdir(inputDir)
      await fs.writeFile(path.join(inputDir, 'first.ipynb'), minimalIpynb('print(1)'))

      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: inputDir,
        format: 'auto',
      })) as ToolResponse
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Auto-detect format is only supported for file inputs')
    })
  })

  describe('errors', () => {
    it('rejects a missing inputPath', async () => {
      const response = (await handleConversionTool('deepnote_convert_to', {
        inputPath: path.join(tempDir, 'does-not-exist.ipynb'),
      })) as ToolResponse
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Invalid inputPath')
    })

    it('rejects empty inputPath arguments', async () => {
      const response = (await handleConversionTool('deepnote_convert_to', { inputPath: '   ' })) as ToolResponse
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Invalid arguments')
    })

    it('rejects a .deepnote file as input under auto-detect', async () => {
      const inputPath = path.join(tempDir, 'already.deepnote')
      // Produce a real .deepnote file first.
      const ipynbPath = path.join(tempDir, 'src.ipynb')
      await fs.writeFile(ipynbPath, minimalIpynb('print("hi")'))
      await handleConversionTool('deepnote_convert_to', { inputPath: ipynbPath, outputPath: inputPath })

      const response = (await handleConversionTool('deepnote_convert_to', { inputPath })) as ToolResponse
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('already a .deepnote file')
    })
  })
})

describe('handleConversionTool dispatch', () => {
  it('returns an error for an unknown tool name', async () => {
    const response = (await handleConversionTool('deepnote_unknown', {})) as ToolResponse
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Unknown conversion tool')
  })
})
