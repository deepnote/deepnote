import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import chalk from 'chalk'
import ora from 'ora'

import {
  convertDeepnoteFileToJupyterFiles,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToQuartoFiles,
  convertIpynbFilesToDeepnoteFile,
  convertMarimoFilesToDeepnoteFile,
  convertPercentFilesToDeepnoteFile,
  convertQuartoFilesToDeepnoteFile,
} from '.'
import { isMarimoContent, isPercentContent } from './format-detection'

interface ConvertOptions {
  cwd?: string
  inputPath: string
  outputPath?: string
  projectName?: string
  /** Output format when converting from .deepnote (default: 'jupyter') */
  outputFormat?: 'jupyter' | 'percent' | 'quarto' | 'marimo'
}

export async function convert(options: ConvertOptions): Promise<string> {
  const {
    inputPath,
    projectName: customProjectName,
    outputPath: customOutputPath,
    cwd = process.cwd(),
    outputFormat = 'jupyter',
  } = options

  const resolveProjectName = (possibleName?: string): string => {
    if (customProjectName) {
      return customProjectName
    }

    if (possibleName) {
      return possibleName
    }

    return 'Untitled project'
  }

  const resolveOutputPath = async (outputFilename: string): Promise<string> => {
    if (customOutputPath) {
      const absoluteOutputPath = resolve(cwd, customOutputPath)
      const stat = await fs.stat(absoluteOutputPath).catch(() => null)

      if (stat?.isDirectory()) {
        return resolve(absoluteOutputPath, outputFilename)
      }

      return absoluteOutputPath
    }

    return resolve(cwd, outputFilename)
  }

  const absolutePath = resolve(cwd, inputPath)

  const stat = await fs.stat(absolutePath)

  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true })

    const ipynbFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.ipynb'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    const quartoFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.qmd'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    // For .py files, we need to check content to distinguish between percent and marimo formats
    const pyFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.py'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    // Read and classify .py files in parallel with bounded concurrency
    const classifyPyFile = async (
      pyFile: string
    ): Promise<{ file: string; type: 'marimo' | 'percent' | 'unknown' }> => {
      const content = await fs.readFile(resolve(absolutePath, pyFile), 'utf-8')
      if (isMarimoContent(content)) {
        return { file: pyFile, type: 'marimo' }
      }
      if (isPercentContent(content)) {
        return { file: pyFile, type: 'percent' }
      }
      return { file: pyFile, type: 'unknown' }
    }

    // Use bounded concurrency to avoid overwhelming the file system
    const CONCURRENCY_LIMIT = 10
    const results: Array<{ file: string; type: 'marimo' | 'percent' | 'unknown' }> = []

    for (let i = 0; i < pyFiles.length; i += CONCURRENCY_LIMIT) {
      const batch = pyFiles.slice(i, i + CONCURRENCY_LIMIT)
      const batchResults = await Promise.all(batch.map(classifyPyFile))
      results.push(...batchResults)
    }

    // Aggregate results while preserving order
    const marimoFiles = results.filter(r => r.type === 'marimo').map(r => r.file)
    const percentFiles = results.filter(r => r.type === 'percent').map(r => r.file)

    // Prioritize by file type
    if (ipynbFiles.length > 0) {
      return convertDirectory(absolutePath, ipynbFiles, 'jupyter', resolveProjectName, resolveOutputPath)
    }
    if (quartoFiles.length > 0) {
      return convertDirectory(absolutePath, quartoFiles, 'quarto', resolveProjectName, resolveOutputPath)
    }
    if (marimoFiles.length > 0) {
      return convertDirectory(absolutePath, marimoFiles, 'marimo', resolveProjectName, resolveOutputPath)
    }
    if (percentFiles.length > 0) {
      return convertDirectory(absolutePath, percentFiles, 'percent', resolveProjectName, resolveOutputPath)
    }

    throw new Error('No supported notebook files found in the specified directory (.ipynb, .qmd, .py)')
  }

  const ext = extname(absolutePath).toLowerCase()

  // Handle Jupyter notebooks
  if (ext === '.ipynb') {
    return convertJupyterToDeepnote(absolutePath, resolveProjectName, resolveOutputPath)
  }

  // Handle Quarto documents
  if (ext === '.qmd') {
    return convertQuartoToDeepnote(absolutePath, resolveProjectName, resolveOutputPath)
  }

  // Handle Python files (could be percent or marimo)
  if (ext === '.py') {
    // Check content to determine format
    const content = await fs.readFile(absolutePath, 'utf-8')

    if (isMarimoContent(content)) {
      return convertMarimoToDeepnote(absolutePath, resolveProjectName, resolveOutputPath)
    }

    if (isPercentContent(content)) {
      return convertPercentToDeepnote(absolutePath, resolveProjectName, resolveOutputPath)
    }

    throw new Error(
      'Unsupported Python file format. File must be a percent format (# %% markers) or Marimo notebook (@app.cell decorators).'
    )
  }

  // Handle Deepnote files
  if (ext === '.deepnote') {
    return convertDeepnoteToFormat(absolutePath, outputFormat, customOutputPath, cwd)
  }

  throw new Error('Unsupported file type. Please provide a .ipynb, .qmd, .py (percent/marimo), or .deepnote file.')
}

async function convertDirectory(
  dirPath: string,
  files: string[],
  format: 'jupyter' | 'quarto' | 'percent' | 'marimo',
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  const formatNames = {
    jupyter: 'Jupyter Notebooks',
    quarto: 'Quarto documents',
    percent: 'percent format notebooks',
    marimo: 'Marimo notebooks',
  }

  const spinner = ora(`Converting ${formatNames[format]} to a Deepnote project...`).start()

  try {
    const filenameWithoutExtension = basename(dirPath)
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    const inputFilePaths = files.map(file => resolve(dirPath, file))

    switch (format) {
      case 'jupyter':
        await convertIpynbFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })
        break
      case 'quarto':
        await convertQuartoFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })
        break
      case 'percent':
        await convertPercentFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })
        break
      case 'marimo':
        await convertMarimoFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })
        break
    }

    spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)

    return outputPath
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}

async function convertSingleFileToDeepnote(
  absolutePath: string,
  formatName: string,
  converter: (paths: string[], opts: { projectName: string; outputPath: string }) => Promise<void>,
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  const spinner = ora(`Converting the ${formatName} to a Deepnote project...`).start()

  try {
    const ext = extname(absolutePath)
    const filenameWithoutExtension = basename(absolutePath, ext)
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    await converter([absolutePath], { projectName, outputPath })

    spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)

    return outputPath
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}

function convertJupyterToDeepnote(
  absolutePath: string,
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  return convertSingleFileToDeepnote(
    absolutePath,
    'Jupyter Notebook',
    convertIpynbFilesToDeepnoteFile,
    resolveProjectName,
    resolveOutputPath
  )
}

function convertQuartoToDeepnote(
  absolutePath: string,
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  return convertSingleFileToDeepnote(
    absolutePath,
    'Quarto document',
    convertQuartoFilesToDeepnoteFile,
    resolveProjectName,
    resolveOutputPath
  )
}

function convertPercentToDeepnote(
  absolutePath: string,
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  return convertSingleFileToDeepnote(
    absolutePath,
    'percent format notebook',
    convertPercentFilesToDeepnoteFile,
    resolveProjectName,
    resolveOutputPath
  )
}

function convertMarimoToDeepnote(
  absolutePath: string,
  resolveProjectName: (name?: string) => string,
  resolveOutputPath: (filename: string) => Promise<string>
): Promise<string> {
  return convertSingleFileToDeepnote(
    absolutePath,
    'Marimo notebook',
    convertMarimoFilesToDeepnoteFile,
    resolveProjectName,
    resolveOutputPath
  )
}

async function convertDeepnoteToFormat(
  absolutePath: string,
  outputFormat: 'jupyter' | 'percent' | 'quarto' | 'marimo',
  customOutputPath: string | undefined,
  cwd: string
): Promise<string> {
  const formatNames = {
    jupyter: 'Jupyter Notebooks',
    percent: 'percent format files',
    quarto: 'Quarto documents',
    marimo: 'Marimo notebooks',
  }

  const spinner = ora(`Converting Deepnote project to ${formatNames[outputFormat]}...`).start()

  try {
    const ext = extname(absolutePath)
    const filenameWithoutExtension = basename(absolutePath, ext)
    const outputDirName = filenameWithoutExtension
    const outputDir = customOutputPath ? resolve(cwd, customOutputPath) : resolve(cwd, outputDirName)

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

    spinner.succeed(`${formatNames[outputFormat]} have been saved to ${chalk.bold(outputDir)}`)

    return outputDir
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}
