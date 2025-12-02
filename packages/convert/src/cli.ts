import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import chalk from 'chalk'
import ora from 'ora'

import { convertDeepnoteFileToJupyter, convertIpynbFilesToDeepnoteFile } from '.'

interface ConvertOptions {
  cwd?: string
  format?: 'deepnote' | 'ipynb'
  inputPath: string
  outputPath?: string
  projectName?: string
}

export async function convert(options: ConvertOptions): Promise<string> {
  const {
    inputPath,
    projectName: customProjectName,
    outputPath: customOutputPath,
    format,
    cwd = process.cwd(),
  } = options

  // Validate format option
  if (format !== undefined && format !== 'deepnote' && format !== 'ipynb') {
    throw new Error(`Invalid format "${format}". Must be "deepnote" or "ipynb".`)
  }

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

    if (ipynbFiles.length === 0) {
      throw new Error('No .ipynb files found in the specified directory.')
    }

    const spinner = ora('Converting Jupyter Notebooks to a Deepnote project...').start()

    try {
      const filenameWithoutExtension = basename(absolutePath)
      const projectName = resolveProjectName(filenameWithoutExtension)

      const outputFilename = `${filenameWithoutExtension}.deepnote`
      const outputPath = await resolveOutputPath(outputFilename)

      const inputFilePaths = ipynbFiles.map(file => resolve(absolutePath, file))

      await convertIpynbFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })

      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)

      return outputPath
    } catch (error) {
      spinner.fail('Conversion failed')
      throw error
    }
  }

  const ext = extname(absolutePath).toLowerCase()

  // Validate format vs input extension
  if (format === 'ipynb' && ext === '.ipynb') {
    throw new Error('Cannot convert .ipynb to .ipynb. Input is already in ipynb format.')
  }
  if (format === 'deepnote' && ext === '.deepnote') {
    throw new Error('Cannot convert .deepnote to .deepnote. Input is already in deepnote format.')
  }

  // Determine target format: use explicit format or auto-detect from extension
  const targetFormat = format ?? (ext === '.ipynb' ? 'deepnote' : ext === '.deepnote' ? 'ipynb' : undefined)

  if (ext === '.ipynb' && targetFormat === 'deepnote') {
    const spinner = ora('Converting the Jupyter Notebook to a Deepnote project...').start()

    try {
      const filenameWithoutExtension = basename(absolutePath, ext)
      const projectName = resolveProjectName(filenameWithoutExtension)

      const outputFilename = `${filenameWithoutExtension}.deepnote`
      const outputPath = await resolveOutputPath(outputFilename)

      await convertIpynbFilesToDeepnoteFile([absolutePath], { projectName, outputPath })

      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)

      return outputPath
    } catch (error) {
      spinner.fail('Conversion failed')
      throw error
    }
  }

  if (ext === '.deepnote' && targetFormat === 'ipynb') {
    const spinner = ora('Converting Deepnote project to Jupyter Notebooks...').start()

    try {
      const filenameWithoutExtension = basename(absolutePath, ext)
      const outputDirName = filenameWithoutExtension
      const outputDir = customOutputPath ? resolve(cwd, customOutputPath) : resolve(cwd, outputDirName)

      await convertDeepnoteFileToJupyter(absolutePath, { outputDir })

      spinner.succeed(`Jupyter Notebooks have been saved to ${chalk.bold(outputDir)}`)

      return outputDir
    } catch (error) {
      spinner.fail('Conversion failed')
      throw error
    }
  }

  throw new Error('Unsupported file type. Please provide a .ipynb or .deepnote file.')
}
