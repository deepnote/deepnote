import fs from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import chalk from 'chalk'
import ora from 'ora'
import { stringify } from 'yaml'

import {
  convertDeepnoteFileToJupyter,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToQuartoFiles,
} from '.'
import { isMarimoContent, isPercentContent } from './format-detection'
import { readAndConvertIpynbFiles } from './jupyter-to-deepnote'
import { readAndConvertMarimoFiles } from './marimo-to-deepnote'
import { readAndConvertPercentFiles } from './percent-to-deepnote'
import { readAndConvertQuartoFiles } from './quarto-to-deepnote'
import { loadLatestSnapshot, mergeSnapshotIntoSource } from './snapshot'
import { writeDeepnoteFile } from './write-deepnote-file'

interface ConvertOptions {
  cwd?: string
  inputPath: string
  outputPath?: string
  projectName?: string
  /** Output format when converting from .deepnote (default: 'jupyter') */
  outputFormat?: 'jupyter' | 'percent' | 'quarto' | 'marimo'
  /** When true, outputs are included in the main file (disables snapshot mode) */
  singleFile?: boolean
}

export async function convert(options: ConvertOptions): Promise<string> {
  const {
    inputPath,
    projectName: customProjectName,
    outputPath: customOutputPath,
    cwd = process.cwd(),
    outputFormat = 'jupyter',
    singleFile = false,
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

    const directoryOptions = { resolveProjectName, resolveOutputPath, singleFile }

    // Prioritize by file type
    if (ipynbFiles.length > 0) {
      return convertDirectory({ dirPath: absolutePath, files: ipynbFiles, format: 'jupyter', ...directoryOptions })
    }
    if (quartoFiles.length > 0) {
      return convertDirectory({ dirPath: absolutePath, files: quartoFiles, format: 'quarto', ...directoryOptions })
    }
    if (marimoFiles.length > 0) {
      return convertDirectory({ dirPath: absolutePath, files: marimoFiles, format: 'marimo', ...directoryOptions })
    }
    if (percentFiles.length > 0) {
      return convertDirectory({ dirPath: absolutePath, files: percentFiles, format: 'percent', ...directoryOptions })
    }

    throw new Error('No supported notebook files found in the specified directory (.ipynb, .qmd, .py)')
  }

  const ext = extname(absolutePath).toLowerCase()

  const fileOptions = { absolutePath, resolveProjectName, resolveOutputPath, singleFile }

  // Handle Jupyter notebooks
  if (ext === '.ipynb') {
    return convertJupyterToDeepnote(fileOptions)
  }

  // Handle Quarto documents
  if (ext === '.qmd') {
    return convertQuartoToDeepnote(fileOptions)
  }

  // Handle Python files (could be percent or marimo)
  if (ext === '.py') {
    // Check content to determine format
    const content = await fs.readFile(absolutePath, 'utf-8')

    if (isMarimoContent(content)) {
      return convertMarimoToDeepnote(fileOptions)
    }

    if (isPercentContent(content)) {
      return convertPercentToDeepnote(fileOptions)
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

interface ConvertDirectoryOptions {
  dirPath: string
  files: string[]
  format: 'jupyter' | 'quarto' | 'percent' | 'marimo'
  resolveProjectName: (name?: string) => string
  resolveOutputPath: (filename: string) => Promise<string>
  singleFile: boolean
}

async function convertDirectory(options: ConvertDirectoryOptions): Promise<string> {
  const { dirPath, files, format, resolveProjectName, resolveOutputPath, singleFile } = options
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

    // Read and convert files to DeepnoteFile (no file I/O yet)
    let deepnoteFile: DeepnoteFile
    switch (format) {
      case 'jupyter':
        deepnoteFile = await readAndConvertIpynbFiles(inputFilePaths, { projectName })
        break
      case 'quarto':
        deepnoteFile = await readAndConvertQuartoFiles(inputFilePaths, { projectName })
        break
      case 'percent':
        deepnoteFile = await readAndConvertPercentFiles(inputFilePaths, { projectName })
        break
      case 'marimo':
        deepnoteFile = await readAndConvertMarimoFiles(inputFilePaths, { projectName })
        break
    }

    // Write file (handles snapshot splitting in memory)
    const { snapshotPath } = await writeDeepnoteFile({
      file: deepnoteFile,
      outputPath,
      projectName,
      singleFile,
    })

    if (snapshotPath) {
      spinner.succeed(
        `The Deepnote project has been saved to ${chalk.bold(outputPath)}\nSnapshot saved to ${chalk.bold(snapshotPath)}`
      )
    } else {
      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
    }

    return outputPath
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}

interface ConvertSingleFileOptions {
  absolutePath: string
  formatName: string
  converter: (paths: string[], opts: { projectName: string }) => Promise<DeepnoteFile>
  resolveProjectName: (name?: string) => string
  resolveOutputPath: (filename: string) => Promise<string>
  singleFile: boolean
}

async function convertSingleFileToDeepnote(options: ConvertSingleFileOptions): Promise<string> {
  const { absolutePath, formatName, converter, resolveProjectName, resolveOutputPath, singleFile } = options
  const spinner = ora(`Converting the ${formatName} to a Deepnote project...`).start()

  try {
    const ext = extname(absolutePath)
    const filenameWithoutExtension = basename(absolutePath, ext)
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    // Read and convert file to DeepnoteFile (no file I/O yet)
    const deepnoteFile = await converter([absolutePath], { projectName })

    // Write file (handles snapshot splitting in memory)
    const { snapshotPath } = await writeDeepnoteFile({
      file: deepnoteFile,
      outputPath,
      projectName,
      singleFile,
    })

    if (snapshotPath) {
      spinner.succeed(
        `The Deepnote project has been saved to ${chalk.bold(outputPath)}\nSnapshot saved to ${chalk.bold(snapshotPath)}`
      )
    } else {
      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
    }

    return outputPath
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}

interface ConvertToDeepnoteOptions {
  absolutePath: string
  resolveProjectName: (name?: string) => string
  resolveOutputPath: (filename: string) => Promise<string>
  singleFile: boolean
}

function convertJupyterToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'Jupyter Notebook',
    converter: readAndConvertIpynbFiles,
  })
}

function convertQuartoToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'Quarto document',
    converter: readAndConvertQuartoFiles,
  })
}

function convertPercentToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'percent format notebook',
    converter: readAndConvertPercentFiles,
  })
}

function convertMarimoToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'Marimo notebook',
    converter: readAndConvertMarimoFiles,
  })
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

    // Read the source file and try to merge with snapshot
    const sourceContent = await fs.readFile(absolutePath, 'utf-8')
    let deepnoteFile = deserializeDeepnoteFile(sourceContent)

    // Try to load and merge snapshot
    const snapshot = await loadLatestSnapshot(absolutePath, deepnoteFile.project.id)
    if (snapshot) {
      deepnoteFile = mergeSnapshotIntoSource(deepnoteFile, snapshot)
    }

    // Write merged content to a temporary file for the converters
    const tempDir = dirname(absolutePath)
    const tempFilename = `.${filenameWithoutExtension}.merged.deepnote`
    const tempPath = resolve(tempDir, tempFilename)

    try {
      const mergedYaml = stringify(deepnoteFile)
      await fs.writeFile(tempPath, mergedYaml, 'utf-8')

      switch (outputFormat) {
        case 'jupyter':
          await convertDeepnoteFileToJupyter(tempPath, { outputDir })
          break
        case 'percent':
          await convertDeepnoteFileToPercentFiles(tempPath, { outputDir })
          break
        case 'quarto':
          await convertDeepnoteFileToQuartoFiles(tempPath, { outputDir })
          break
        case 'marimo':
          await convertDeepnoteFileToMarimoFiles(tempPath, { outputDir })
          break
      }
    } finally {
      // Clean up temp file
      await fs.unlink(tempPath).catch(() => {})
    }

    spinner.succeed(`${formatNames[outputFormat]} have been saved to ${chalk.bold(outputDir)}`)

    return outputDir
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}
