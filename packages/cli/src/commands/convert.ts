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
  type NotebookFormat,
} from '@deepnote/convert'
import type { Command } from 'commander'
import ora from 'ora'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, getOutputConfig, error as logError, output } from '../output'
import { resolvePath } from '../utils/file-resolver'
import { openDeepnoteInCloud } from '../utils/open-in-cloud'

export interface ConvertOptions {
  output?: string
  name?: string
  format?: 'jupyter' | 'percent' | 'quarto' | 'marimo'
  open?: boolean
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

      // Handle --open flag: open the converted .deepnote file in Deepnote Cloud
      if (options.open && result.outputFormat === 'deepnote') {
        const c = getChalk()
        const quiet = getOutputConfig().quiet
        const openResult = await openDeepnoteInCloud(result.outputPath, { quiet })
        if (!quiet) {
          output(`${c.green('✓')} Opened in Deepnote Cloud`)
          output(`${c.dim('URL:')} ${openResult.url}`)
        }
      } else if (options.open && result.outputFormat !== 'deepnote') {
        const c = getChalk()
        logError(c.yellow('--open is only available when converting to .deepnote format'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError(message)
      process.exit(ExitCode.Error)
    }
  }
}

async function convertFile(inputPath: string, options: ConvertOptions): Promise<ConvertResult> {
  const { absolutePath, isDirectory, extension: ext } = await resolvePath(inputPath)

  // Determine input format
  const inputFormat = await determineInputFormat(absolutePath, isDirectory, ext)

  // Perform conversion
  if (inputFormat === 'deepnote') {
    const outputFormat = options.format ?? 'jupyter'
    return convertFromDeepnote(absolutePath, outputFormat, options)
  }
  return convertToDeepnote(absolutePath, inputFormat, isDirectory, options)
}

async function determineInputFormat(absolutePath: string, isDirectory: boolean, ext: string): Promise<NotebookFormat> {
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
    const format = detectFormat(absolutePath, content)
    if (format === 'marimo') return 'marimo'
    if (format === 'percent') return 'percent'
    throw new Error(
      'Unsupported Python file format. File must be a percent format (# %% markers) or Marimo notebook (@app.cell decorators).'
    )
  }

  if (isDirectory) {
    // Check directory contents to determine format
    const entries = await fs.readdir(absolutePath, { withFileTypes: true })
    const files = entries.filter(e => e.isFile()).map(e => e.name)

    if (files.some(f => f.toLowerCase().endsWith('.ipynb'))) return 'jupyter'
    if (files.some(f => f.toLowerCase().endsWith('.qmd'))) return 'quarto'

    // Check .py files for format
    const pyFiles = files.filter(f => f.toLowerCase().endsWith('.py'))
    for (const pyFile of pyFiles) {
      const pyFilePath = resolve(absolutePath, pyFile)
      const content = await fs.readFile(pyFilePath, 'utf-8')
      const format = detectFormat(pyFilePath, content)
      if (format === 'marimo') return 'marimo'
      if (format === 'percent') return 'percent'
    }

    throw new Error('No supported notebook files found in the directory (.ipynb, .qmd, .py)')
  }

  throw new Error('Unsupported file type. Please provide a .ipynb, .qmd, .py (percent/marimo), or .deepnote file.')
}

const VALID_OUTPUT_FORMATS = ['jupyter', 'percent', 'quarto', 'marimo'] as const
type OutputFormat = (typeof VALID_OUTPUT_FORMATS)[number]

function isValidOutputFormat(format: string): format is OutputFormat {
  return VALID_OUTPUT_FORMATS.includes(format as OutputFormat)
}

async function convertFromDeepnote(
  absolutePath: string,
  outputFormat: string,
  options: ConvertOptions
): Promise<ConvertResult> {
  // Validate format at runtime since commander accepts any string
  if (!isValidOutputFormat(outputFormat)) {
    throw new Error(
      `Invalid output format: "${outputFormat}". Supported formats are: ${VALID_OUTPUT_FORMATS.join(', ')}`
    )
  }

  const formatNames: Record<OutputFormat, string> = {
    jupyter: 'Jupyter Notebooks',
    percent: 'percent format files',
    quarto: 'Quarto documents',
    marimo: 'Marimo notebooks',
  }

  const quiet = getOutputConfig().quiet
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

    spinner?.succeed(`${formatNames[outputFormat]} saved to ${getChalk().bold(outputDir)}`)

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
  inputFormat: Exclude<NotebookFormat, 'deepnote'>,
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
  const quiet = getOutputConfig().quiet
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

    spinner?.succeed(`Deepnote project saved to ${getChalk().bold(outputPath)}`)

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

async function getFilesFromDirectory(dirPath: string, format: Exclude<NotebookFormat, 'deepnote'>): Promise<string[]> {
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

  // For .py files, filter by actual format using parallel reads
  if (format === 'percent' || format === 'marimo') {
    const fileContents = await Promise.all(files.map(file => fs.readFile(file, 'utf-8')))
    const filteredFiles = files.filter((file, index) => {
      const detectedFormat = detectFormat(file, fileContents[index])
      return detectedFormat === format
    })
    return filteredFiles
  }

  return files
}
