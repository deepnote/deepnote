import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import chalk from 'chalk'
import ora from 'ora'

import {
  convertDeepnoteFileToJupyter,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteFileToQuartoFiles,
  convertIpynbFilesToDeepnoteFile,
  convertMarimoFilesToDeepnoteFile,
  convertPercentFilesToDeepnoteFile,
  convertQuartoFilesToDeepnoteFile,
} from '.'

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

    // Check for different file types in directory
    const ipynbFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.ipynb'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    const percentFiles = entries
      .filter(entry => entry.isFile() && isPercentFile(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    const quartoFiles = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.qmd'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    const marimoFiles = entries
      .filter(entry => entry.isFile() && isMarimoFile(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    // Prioritize by file type
    if (ipynbFiles.length > 0) {
      return convertDirectory(absolutePath, ipynbFiles, 'jupyter', resolveProjectName, resolveOutputPath)
    }
    if (quartoFiles.length > 0) {
      return convertDirectory(absolutePath, quartoFiles, 'quarto', resolveProjectName, resolveOutputPath)
    }
    if (percentFiles.length > 0) {
      return convertDirectory(absolutePath, percentFiles, 'percent', resolveProjectName, resolveOutputPath)
    }
    if (marimoFiles.length > 0) {
      return convertDirectory(absolutePath, marimoFiles, 'marimo', resolveProjectName, resolveOutputPath)
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
        await convertDeepnoteFileToJupyter(absolutePath, { outputDir })
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

/** Check if a filename looks like a percent format file */
function isPercentFile(filename: string): boolean {
  // Percent files use .percent.py naming convention for directory scanning
  return filename.toLowerCase().endsWith('.percent.py')
}

/** Check if a filename looks like a Marimo file */
function isMarimoFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.marimo.py')
}

/** Check if file content is Marimo format */
function isMarimoContent(content: string): boolean {
  // Check for marimo import at line start (not in comments/strings)
  // Avoid false positives from triple-quoted strings containing the markers
  return (
    /^import marimo\b/m.test(content) &&
    /@app\.cell\b/.test(content) &&
    !/^\s*['"]{3}[\s\S]*?import marimo/m.test(content)
  )
}

/** Check if file content is percent format */
function isPercentContent(content: string): boolean {
  // Ensure the marker appears outside of string literals
  // Simple heuristic: check it's not inside triple-quoted strings
  return /^# %%/m.test(content) && !/^\s*['"]{3}[\s\S]*?# %%/m.test(content)
}
