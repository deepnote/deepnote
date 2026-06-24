import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  detectFormat,
  isSourceNotebookFormat,
  type NotebookFormat,
  runFromDeepnoteConversion,
  runToDeepnoteConversion,
  SOURCE_NOTEBOOK_FORMATS,
  type SourceNotebookFormat,
} from '@deepnote/convert'
import type { Command } from 'commander'
import ora from 'ora'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, getOutputConfig, error as logError, output } from '../output'
import { resolvePath } from '../utils/file-resolver'
import { openDeepnoteFileInCloud } from '../utils/open-file-in-cloud'
import { convertDirectoryToDeepnote as convertDirectoryToDeepnoteCore } from '../utils/to-deepnote-conversion'

export interface ConvertOptions {
  output?: string
  name?: string
  format?: SourceNotebookFormat
  open?: boolean
}

export interface ConvertResult {
  success: boolean
  inputPath: string
  outputPath: string
  inputFormat: string
  outputFormat: string
  outputIsDirectory: boolean
}

export function createConvertAction(_program: Command): (inputPath: string, options: ConvertOptions) => Promise<void> {
  return async (inputPath, options) => {
    try {
      debug(`Converting: ${inputPath}`)
      debug(`Options: ${JSON.stringify(options)}`)
      const result = await convertFile(inputPath, options)

      // Handle --open flag: open the converted .deepnote file in Deepnote Cloud
      if (options.open) {
        const c = getChalk()
        if (result.outputFormat !== 'deepnote') {
          output(c.yellow('Warning: --open is only available when converting to .deepnote format'))
        } else if (result.outputIsDirectory) {
          output(
            c.yellow(
              'Warning: --open is not supported when converting a directory; open a file with `deepnote open <file>`'
            )
          )
        } else {
          const quiet = getOutputConfig().quiet
          const openResult = await openDeepnoteFileInCloud(result.outputPath, { quiet })
          if (!quiet) {
            output(`${c.green('✓')} Opened in Deepnote Cloud`)
            output(`${c.dim('URL:')} ${openResult.url}`)
          }
        }
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

async function convertFromDeepnote(
  absolutePath: string,
  outputFormat: string,
  options: ConvertOptions
): Promise<ConvertResult> {
  if (!isSourceNotebookFormat(outputFormat)) {
    throw new Error(
      `Invalid output format: "${outputFormat}". Supported formats are: ${SOURCE_NOTEBOOK_FORMATS.join(', ')}`
    )
  }

  const formatNames: Record<SourceNotebookFormat, string> = {
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

    await runFromDeepnoteConversion(outputFormat, absolutePath, { outputDir })

    spinner?.succeed(`${formatNames[outputFormat]} saved to ${getChalk().bold(outputDir)}`)

    return {
      success: true,
      inputPath: absolutePath,
      outputPath: outputDir,
      inputFormat: 'deepnote',
      outputFormat,
      outputIsDirectory: true,
    }
  } catch (error) {
    spinner?.fail('Conversion failed')
    throw error
  }
}

const INPUT_FORMAT_NAMES: Record<SourceNotebookFormat, string> = {
  jupyter: 'Jupyter Notebook',
  quarto: 'Quarto document',
  percent: 'percent format notebook',
  marimo: 'Marimo notebook',
}

async function convertToDeepnote(
  absolutePath: string,
  inputFormat: SourceNotebookFormat,
  isDirectory: boolean,
  options: ConvertOptions
): Promise<ConvertResult> {
  return isDirectory
    ? convertDirectoryToDeepnote(absolutePath, inputFormat, options)
    : convertSingleFileToDeepnote(absolutePath, inputFormat, options)
}

/** Converts one source notebook to a single-notebook `.deepnote` file. */
async function convertSingleFileToDeepnote(
  absolutePath: string,
  inputFormat: SourceNotebookFormat,
  options: ConvertOptions
): Promise<ConvertResult> {
  const quiet = getOutputConfig().quiet
  const spinner = quiet ? null : ora(`Converting ${INPUT_FORMAT_NAMES[inputFormat]} to Deepnote project...`).start()

  try {
    const ext = extname(absolutePath)
    const filenameWithoutExtension = basename(absolutePath, ext)
    const projectName = options.name ?? filenameWithoutExtension
    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = options.output ? resolve(process.cwd(), options.output) : resolve(process.cwd(), outputFilename)

    await runToDeepnoteConversion(inputFormat, absolutePath, { projectName, outputPath })

    spinner?.succeed(`Deepnote project saved to ${getChalk().bold(outputPath)}`)

    return {
      success: true,
      inputPath: absolutePath,
      outputPath,
      inputFormat,
      outputFormat: 'deepnote',
      outputIsDirectory: false,
    }
  } catch (error) {
    spinner?.fail('Conversion failed')
    throw error
  }
}

async function convertDirectoryToDeepnote(
  dirPath: string,
  inputFormat: SourceNotebookFormat,
  options: ConvertOptions
): Promise<ConvertResult> {
  const outputDir = options.output ? resolve(process.cwd(), options.output) : dirPath
  const projectName = options.name ?? basename(dirPath)
  const projectId = randomUUID()

  const quiet = getOutputConfig().quiet
  const spinner = quiet ? null : ora(`Converting ${INPUT_FORMAT_NAMES[inputFormat]} to Deepnote files...`).start()

  try {
    const result = await convertDirectoryToDeepnoteCore({
      inputDir: dirPath,
      format: inputFormat,
      outputDir,
      projectName,
      projectId,
    })

    spinner?.succeed(
      `${result.outputFiles.length} Deepnote file${result.outputFiles.length === 1 ? '' : 's'} saved to ${getChalk().bold(outputDir)}`
    )

    return {
      success: true,
      inputPath: dirPath,
      outputPath: outputDir,
      inputFormat,
      outputFormat: 'deepnote',
      outputIsDirectory: true,
    }
  } catch (error) {
    spinner?.fail('Conversion failed')
    throw error
  }
}
