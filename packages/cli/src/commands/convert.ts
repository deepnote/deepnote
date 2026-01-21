import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  convertDeepnoteFileToJupyterFiles,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToQuartoFiles,
  convertIpynbFilesToDeepnoteFile,
  convertMarimoFilesToDeepnoteFile,
  convertPercentFilesToDeepnoteFile,
  convertQuartoFilesToDeepnoteFile,
  detectFormat,
} from '@deepnote/convert'
import chalk from 'chalk'
import type { Command } from 'commander'
import ora from 'ora'
import { ExitCode } from '../exit-codes'
import { debug, getOutputConfig, error as logError, outputJson } from '../output'

export interface ConvertOptions {
  output?: string
  name?: string
  format?: 'jupyter' | 'percent' | 'quarto' | 'marimo'
  json?: boolean
}

export interface ConvertResult {
  success: boolean
  inputPath: string
  outputPath: string
  inputFormat: string
  outputFormat: string
}

export function createConvertAction(_program: Command): (inputPath: string, options: ConvertOptions) => Promise<void> {
  return async (inputPath, options) => {
    try {
      debug(`Converting: ${inputPath}`)
      debug(`Options: ${JSON.stringify(options)}`)
      const result = await convertFile(inputPath, options)

      if (options.json) {
        outputJson(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (options.json) {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(ExitCode.Error)
    }
  }
}

async function convertFile(inputPath: string, options: ConvertOptions): Promise<ConvertResult> {
  const cwd = process.cwd()
  const absolutePath = resolve(cwd, inputPath)

  // Check if path exists
  const stat = await fs.stat(absolutePath).catch(() => null)
  if (!stat) {
    throw new Error(`File or directory not found: ${inputPath}`)
  }

  const isDirectory = stat.isDirectory()
  const ext = isDirectory ? '' : extname(absolutePath).toLowerCase()

  // Determine input format
  const inputFormat = await determineInputFormat(absolutePath, isDirectory, ext)

  // Perform conversion
  if (inputFormat === 'deepnote') {
    const outputFormat = options.format ?? 'jupyter'
    return convertFromDeepnote(absolutePath, outputFormat, options)
  }
  return convertToDeepnote(absolutePath, inputFormat, isDirectory, options)
}

async function determineInputFormat(
  absolutePath: string,
  isDirectory: boolean,
  ext: string
): Promise<'jupyter' | 'quarto' | 'percent' | 'marimo' | 'deepnote'> {
  if (ext === '.deepnote') {
    return 'deepnote'
  }

  if (ext === '.ipynb') {
    return 'jupyter'
  }

  if (ext === '.qmd') {
    return 'quarto'
  }

  if (ext === '.py') {
    const content = await fs.readFile(absolutePath, 'utf-8')
    const format = detectFormat(content)
    if (format === 'marimo') return 'marimo'
    if (format === 'percent') return 'percent'
    throw new Error(
      'Unsupported Python file format. File must be a percent format (# %% markers) or Marimo notebook (@app.cell decorators).'
    )
  }

  if (isDirectory) {
    // Check directory contents to determine format
    const entries = await fs.readdir(absolutePath, { withFileTypes: true })
    const files = entries.filter(e => e.isFile()).map(e => e.name.toLowerCase())

    if (files.some(f => f.endsWith('.ipynb'))) return 'jupyter'
    if (files.some(f => f.endsWith('.qmd'))) return 'quarto'

    // Check .py files for format
    const pyFiles = files.filter(f => f.endsWith('.py'))
    for (const pyFile of pyFiles) {
      const content = await fs.readFile(resolve(absolutePath, pyFile), 'utf-8')
      const format = detectFormat(content)
      if (format === 'marimo') return 'marimo'
      if (format === 'percent') return 'percent'
    }

    throw new Error('No supported notebook files found in the directory (.ipynb, .qmd, .py)')
  }

  throw new Error('Unsupported file type. Please provide a .ipynb, .qmd, .py (percent/marimo), or .deepnote file.')
}

async function convertFromDeepnote(
  absolutePath: string,
  outputFormat: 'jupyter' | 'percent' | 'quarto' | 'marimo',
  options: ConvertOptions
): Promise<ConvertResult> {
  const formatNames: Record<string, string> = {
    jupyter: 'Jupyter Notebooks',
    percent: 'percent format files',
    quarto: 'Quarto documents',
    marimo: 'Marimo notebooks',
  }

  const quiet = getOutputConfig().quiet || options.json
  const spinner = quiet ? null : ora(`Converting Deepnote project to ${formatNames[outputFormat]}...`).start()

  try {
    const ext = extname(absolutePath)
    const filenameWithoutExtension = basename(absolutePath, ext)
    const outputDir = options.output
      ? resolve(process.cwd(), options.output)
      : resolve(process.cwd(), filenameWithoutExtension)

    switch (outputFormat) {
      case 'jupyter':
        await convertDeepnoteFileToJupyterFiles(absolutePath, { outputDir })
        break
      case 'percent':
        await convertDeepnoteFileToPercentFiles(absolutePath, { outputDir })
        break
      case 'quarto':
        await convertDeepnoteFileToQuartoFiles(absolutePath, { outputDir })
        break
      case 'marimo':
        await convertDeepnoteFileToMarimoFiles(absolutePath, { outputDir })
        break
    }

    spinner?.succeed(`${formatNames[outputFormat]} saved to ${chalk.bold(outputDir)}`)

    return {
      success: true,
      inputPath: absolutePath,
      outputPath: outputDir,
      inputFormat: 'deepnote',
      outputFormat,
    }
  } catch (error) {
    spinner?.fail('Conversion failed')
    throw error
  }
}

async function convertToDeepnote(
  absolutePath: string,
  inputFormat: 'jupyter' | 'quarto' | 'percent' | 'marimo',
  isDirectory: boolean,
  options: ConvertOptions
): Promise<ConvertResult> {
  const formatNames: Record<string, string> = {
    jupyter: 'Jupyter Notebook',
    quarto: 'Quarto document',
    percent: 'percent format notebook',
    marimo: 'Marimo notebook',
  }

  const formatName = isDirectory ? `${formatNames[inputFormat]}s` : formatNames[inputFormat]
  const quiet = getOutputConfig().quiet || options.json
  const spinner = quiet ? null : ora(`Converting ${formatName} to Deepnote project...`).start()

  try {
    // Determine output path
    const ext = extname(absolutePath)
    const filenameWithoutExtension = isDirectory ? basename(absolutePath) : basename(absolutePath, ext)
    const projectName = options.name ?? filenameWithoutExtension
    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = options.output ? resolve(process.cwd(), options.output) : resolve(process.cwd(), outputFilename)

    // Get input files
    const inputFiles = isDirectory ? await getFilesFromDirectory(absolutePath, inputFormat) : [absolutePath]

    // Perform conversion
    switch (inputFormat) {
      case 'jupyter':
        await convertIpynbFilesToDeepnoteFile(inputFiles, { projectName, outputPath })
        break
      case 'quarto':
        await convertQuartoFilesToDeepnoteFile(inputFiles, { projectName, outputPath })
        break
      case 'percent':
        await convertPercentFilesToDeepnoteFile(inputFiles, { projectName, outputPath })
        break
      case 'marimo':
        await convertMarimoFilesToDeepnoteFile(inputFiles, { projectName, outputPath })
        break
    }

    spinner?.succeed(`Deepnote project saved to ${chalk.bold(outputPath)}`)

    return {
      success: true,
      inputPath: absolutePath,
      outputPath,
      inputFormat,
      outputFormat: 'deepnote',
    }
  } catch (error) {
    spinner?.fail('Conversion failed')
    throw error
  }
}

async function getFilesFromDirectory(
  dirPath: string,
  format: 'jupyter' | 'quarto' | 'percent' | 'marimo'
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const extensionMap: Record<string, string> = {
    jupyter: '.ipynb',
    quarto: '.qmd',
    percent: '.py',
    marimo: '.py',
  }

  const targetExt = extensionMap[format]
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(targetExt))
    .map(entry => resolve(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b))

  // For .py files, filter by actual format
  if (format === 'percent' || format === 'marimo') {
    const filteredFiles: string[] = []
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8')
      const detectedFormat = detectFormat(content)
      if (detectedFormat === format) {
        filteredFiles.push(file)
      }
    }
    return filteredFiles
  }

  return files
}
