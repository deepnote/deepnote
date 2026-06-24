import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '@deepnote/blocks'
import chalk from 'chalk'
import ora from 'ora'

import {
  convertDeepnoteFileToJupyterFiles,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToQuartoFiles,
} from '.'
import { UnsupportedFormatError } from './errors'
import { isMarimoContent, isPercentContent } from './format-detection'
import { readAndConvertIpynbFile } from './jupyter-to-deepnote'
import { readAndConvertMarimoFile } from './marimo-to-deepnote'
import { readAndConvertPercentFile } from './percent-to-deepnote'
import { readAndConvertQuartoFile } from './quarto-to-deepnote'
import { loadLatestSnapshot, mergeSnapshotIntoSource, resolveSnapshotNotebookId } from './snapshot'
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

    const directoryOptions = { customOutputPath, cwd, customProjectName, singleFile }

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

    throw new UnsupportedFormatError('No supported notebook files found in the specified directory (.ipynb, .qmd, .py)')
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

    throw new UnsupportedFormatError(
      'Unsupported Python file format. File must be a percent format (# %% markers) or Marimo notebook (@app.cell decorators).',
      { filename: absolutePath }
    )
  }

  // Handle Deepnote files
  if (ext === '.deepnote') {
    return convertDeepnoteToFormat(absolutePath, outputFormat, customOutputPath, cwd)
  }

  throw new UnsupportedFormatError(
    'Unsupported file type. Please provide a .ipynb, .qmd, .py (percent/marimo), or .deepnote file.',
    { filename: absolutePath }
  )
}

interface ConvertDirectoryOptions {
  dirPath: string
  files: string[]
  format: 'jupyter' | 'quarto' | 'percent' | 'marimo'
  customOutputPath?: string
  cwd: string
  customProjectName?: string
  singleFile: boolean
}

const DIRECTORY_FORMAT_NAMES = {
  jupyter: 'Jupyter Notebook',
  quarto: 'Quarto document',
  percent: 'percent format notebook',
  marimo: 'Marimo notebook',
} as const

/** Reads and converts ONE source notebook into a single-notebook `DeepnoteFile`. */
function readAndConvertOne(
  format: ConvertDirectoryOptions['format'],
  inputFilePath: string,
  options: { projectName: string; projectId?: string }
): Promise<DeepnoteFile> {
  switch (format) {
    case 'jupyter':
      return readAndConvertIpynbFile(inputFilePath, options)
    case 'quarto':
      return readAndConvertQuartoFile(inputFilePath, options)
    case 'percent':
      return readAndConvertPercentFile(inputFilePath, options)
    case 'marimo':
      return readAndConvertMarimoFile(inputFilePath, options)
  }
}

/**
 * Converts every notebook in a directory to its own single-notebook `.deepnote` file —
 * one file per source notebook (the recommended layout).
 *
 * All notebooks are converted together as ONE project, so every output file shares the same
 * `project.id`, name, settings, and integrations; each is then written out as a single-notebook
 * file named after its source. `projectName` sets the shared project name (defaults to the
 * directory name). The output directory defaults to the input directory; the directory is returned.
 */
async function convertDirectory(options: ConvertDirectoryOptions): Promise<string> {
  const { dirPath, files, format, customOutputPath, cwd, customProjectName, singleFile } = options

  const outputDir = customOutputPath ? resolve(cwd, customOutputPath) : dirPath
  await fs.mkdir(outputDir, { recursive: true })

  const projectName = customProjectName ?? basename(dirPath)
  const plural = files.length === 1 ? '' : 's'
  const spinner = ora(
    `Converting ${files.length} ${DIRECTORY_FORMAT_NAMES[format]}${plural} to Deepnote files...`
  ).start()

  const projectId = randomUUID()

  try {
    const createdFiles: string[] = []
    for (const file of files) {
      const inputFilePath = resolve(dirPath, file)
      const outputName = basename(file, extname(file))
      const outputPath = resolve(outputDir, `${outputName}.deepnote`)
      // Same projectId across every file ⇒ all outputs belong to one project.
      const deepnoteFile = await readAndConvertOne(format, inputFilePath, { projectName, projectId })
      // writeDeepnoteFile handles snapshot splitting in memory.
      await writeDeepnoteFile({ file: deepnoteFile, outputPath, projectName, singleFile })
      createdFiles.push(outputPath)
    }

    spinner.succeed(
      `${createdFiles.length} Deepnote file${createdFiles.length === 1 ? '' : 's'} saved to ${chalk.bold(outputDir)}`
    )

    return outputDir
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}

interface ConvertSingleFileOptions {
  absolutePath: string
  formatName: string
  converter: (inputFilePath: string, opts: { projectName: string; projectId?: string }) => Promise<DeepnoteFile>
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
    const deepnoteFile = await converter(absolutePath, { projectName })

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
    converter: readAndConvertIpynbFile,
  })
}

function convertQuartoToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'Quarto document',
    converter: readAndConvertQuartoFile,
  })
}

function convertPercentToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'percent format notebook',
    converter: readAndConvertPercentFile,
  })
}

function convertMarimoToDeepnote(options: ConvertToDeepnoteOptions): Promise<string> {
  return convertSingleFileToDeepnote({
    ...options,
    formatName: 'Marimo notebook',
    converter: readAndConvertMarimoFile,
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
    const nbId = resolveSnapshotNotebookId(deepnoteFile)
    const snapshot = await loadLatestSnapshot(absolutePath, deepnoteFile.project.id, nbId ? { notebookId: nbId } : {})
    if (snapshot) {
      deepnoteFile = mergeSnapshotIntoSource(deepnoteFile, snapshot, { skipMismatched: true })
    }

    // Write merged content to a unique temporary directory for the converters
    const tempDir = await fs.mkdtemp(resolve(dirname(absolutePath), '.deepnote-merge-'))
    const tempFilename = `${filenameWithoutExtension}.merged.deepnote`
    const tempPath = resolve(tempDir, tempFilename)

    try {
      const mergedYaml = serializeDeepnoteFile(deepnoteFile)
      await fs.writeFile(tempPath, mergedYaml, 'utf-8')

      switch (outputFormat) {
        case 'jupyter':
          await convertDeepnoteFileToJupyterFiles(tempPath, { outputDir })
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
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }

    spinner.succeed(`${formatNames[outputFormat]} have been saved to ${chalk.bold(outputDir)}`)

    return outputDir
  } catch (error) {
    spinner.fail('Conversion failed')
    throw error
  }
}
