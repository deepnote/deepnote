import * as fs from 'node:fs/promises'
import * as path from 'node:path'
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
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export const conversionTools: Tool[] = [
  {
    name: 'deepnote_convert_to',
    title: 'Convert To Deepnote',
    description: 'Convert Jupyter (.ipynb), Quarto (.qmd), Percent (.py), or Marimo (.py) files to .deepnote format.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the input file or directory. Format is auto-detected from content.',
        },
        outputPath: {
          type: 'string',
          description:
            'Path for the output .deepnote file. If not specified, uses input path with .deepnote extension.',
        },
        projectName: {
          type: 'string',
          description: 'Name for the Deepnote project. If not specified, derived from input filename.',
        },
        format: {
          type: 'string',
          enum: ['jupyter', 'quarto', 'percent', 'marimo', 'auto'],
          description: 'Input format. Use "auto" to detect from file content (default: auto).',
        },
      },
      required: ['inputPath'],
    },
  },
  {
    name: 'deepnote_convert_from',
    title: 'Convert From Deepnote',
    description: 'Convert a .deepnote file to Jupyter (.ipynb), Quarto (.qmd), Percent (.py), or Marimo (.py) format.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        outputDir: {
          type: 'string',
          description: 'Directory for output files. If not specified, uses same directory as input.',
        },
        format: {
          type: 'string',
          enum: ['jupyter', 'quarto', 'percent', 'marimo'],
          description: 'Output format (default: jupyter)',
        },
      },
      required: ['inputPath'],
    },
  },
]

function toError(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  } as const
}

const nonEmptyStringSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'expected a non-empty string',
})

const convertToFormatSchema = z.enum(['jupyter', 'quarto', 'percent', 'marimo', 'auto'])
const convertFromFormatSchema = z.enum(['jupyter', 'quarto', 'percent', 'marimo'])

const convertToArgsSchema = z.object({
  inputPath: nonEmptyStringSchema,
  outputPath: nonEmptyStringSchema.optional(),
  projectName: nonEmptyStringSchema.optional(),
  format: convertToFormatSchema.optional(),
})

const convertFromArgsSchema = z.object({
  inputPath: nonEmptyStringSchema,
  outputDir: nonEmptyStringSchema.optional(),
  format: convertFromFormatSchema.optional(),
})

function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid arguments'
  const issuePath = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${issuePath}${issue.message}`
}

async function listFilesByExtension(dirPath: string, extension: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map(entry => path.join(dirPath, entry.name))
}

function deriveDefaultDeepnoteOutputPath(inputPath: string, isDirectory: boolean): string {
  if (isDirectory) {
    return path.join(inputPath, `${path.basename(inputPath)}.deepnote`)
  }

  const ext = path.extname(inputPath)
  if (ext) {
    return `${inputPath.slice(0, -ext.length)}.deepnote`
  }
  return `${inputPath}.deepnote`
}

async function resolveConvertToOutputPath(
  outputPathRaw: string | undefined,
  absoluteInput: string,
  inputIsDirectory: boolean
): Promise<string> {
  if (!outputPathRaw) {
    return deriveDefaultDeepnoteOutputPath(absoluteInput, inputIsDirectory)
  }

  const resolvedOutputPath = path.resolve(outputPathRaw)

  try {
    const outputStat = await fs.stat(resolvedOutputPath)
    if (outputStat.isDirectory()) {
      return path.join(resolvedOutputPath, `${path.basename(absoluteInput, path.extname(absoluteInput))}.deepnote`)
    }
  } catch {
    // Output path may not exist yet; treat it as the intended file path.
  }

  if (resolvedOutputPath.toLowerCase().endsWith('.deepnote')) {
    return resolvedOutputPath
  }

  return `${resolvedOutputPath}.deepnote`
}

async function handleConvertTo(args: Record<string, unknown>) {
  const parsedArgs = convertToArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return toError(`Invalid arguments for deepnote_convert_to: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const { inputPath, outputPath, projectName } = parsedArgs.data
  let format = parsedArgs.data.format ?? 'auto'

  const absoluteInput = path.resolve(inputPath)

  let inputStat: Awaited<ReturnType<typeof fs.stat>>
  try {
    inputStat = await fs.stat(absoluteInput)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return toError(`Invalid inputPath: ${message}`)
  }

  if (!inputStat.isFile() && !inputStat.isDirectory()) {
    return toError('inputPath must point to a file or directory')
  }

  const inputIsDirectory = inputStat.isDirectory()
  const inputIsFile = inputStat.isFile()

  if (format === 'auto' && inputIsDirectory) {
    return toError('Auto-detect format is only supported for file inputs')
  }

  // Auto-detect format only for file inputs.
  if (format === 'auto' && inputIsFile) {
    const content = await fs.readFile(absoluteInput, 'utf-8')
    const detectedFormat = detectFormat(absoluteInput, content)
    if (detectedFormat === 'deepnote') {
      return toError('Input is already a .deepnote file; use deepnote_convert_from to export to other formats')
    }
    format = detectedFormat
  }

  let inputFiles: string[] = []
  if (inputIsFile) {
    inputFiles = [absoluteInput]
  } else {
    switch (format) {
      case 'jupyter':
        inputFiles = await listFilesByExtension(absoluteInput, '.ipynb')
        break
      case 'quarto':
        inputFiles = await listFilesByExtension(absoluteInput, '.qmd')
        break
      case 'percent':
      case 'marimo':
        inputFiles = await listFilesByExtension(absoluteInput, '.py')
        break
      default:
        return toError(`Unknown format: ${format}`)
    }
  }

  if (inputFiles.length === 0) {
    return toError(`No input files found for format "${format}" at: ${absoluteInput}`)
  }

  // Determine output path
  const finalOutputPath = await resolveConvertToOutputPath(outputPath, absoluteInput, inputIsDirectory)

  // Determine project name
  const finalProjectName = projectName || path.basename(absoluteInput, path.extname(absoluteInput))

  try {
    switch (format) {
      case 'jupyter':
        await convertIpynbFilesToDeepnoteFile(inputFiles, {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'quarto':
        await convertQuartoFilesToDeepnoteFile(inputFiles, {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'percent':
        await convertPercentFilesToDeepnoteFile(inputFiles, {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'marimo':
        await convertMarimoFilesToDeepnoteFile(inputFiles, {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      default:
        return {
          content: [{ type: 'text', text: `Unknown format: ${format}` }],
          isError: true,
        }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              inputPath: absoluteInput,
              outputPath: finalOutputPath,
              detectedFormat: format,
              projectName: finalProjectName,
              inputFiles,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Conversion failed: ${message}` }],
      isError: true,
    }
  }
}

async function handleConvertFrom(args: Record<string, unknown>) {
  const parsedArgs = convertFromArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return toError(`Invalid arguments for deepnote_convert_from: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const { inputPath, outputDir } = parsedArgs.data
  const format = parsedArgs.data.format ?? 'jupyter'

  const absoluteInput = path.resolve(inputPath)

  let inputStat: Awaited<ReturnType<typeof fs.stat>>
  try {
    inputStat = await fs.stat(absoluteInput)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return toError(`Invalid inputPath: ${message}`)
  }

  if (!inputStat.isFile()) {
    return toError('inputPath for deepnote_convert_from must point to a file')
  }

  const finalOutputDir = outputDir ? path.resolve(outputDir) : path.dirname(absoluteInput)

  try {
    switch (format) {
      case 'jupyter':
        await convertDeepnoteFileToJupyterFiles(absoluteInput, {
          outputDir: finalOutputDir,
        })
        break
      case 'quarto':
        await convertDeepnoteFileToQuartoFiles(absoluteInput, {
          outputDir: finalOutputDir,
        })
        break
      case 'percent':
        await convertDeepnoteFileToPercentFiles(absoluteInput, {
          outputDir: finalOutputDir,
        })
        break
      case 'marimo':
        await convertDeepnoteFileToMarimoFiles(absoluteInput, {
          outputDir: finalOutputDir,
        })
        break
      default:
        return {
          content: [{ type: 'text', text: `Unknown format: ${format}` }],
          isError: true,
        }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              inputPath: absoluteInput,
              outputFormat: format,
              outputDir: finalOutputDir,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Conversion failed: ${message}` }],
      isError: true,
    }
  }
}

export async function handleConversionTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_convert_to':
      return handleConvertTo(safeArgs)
    case 'deepnote_convert_from':
      return handleConvertFrom(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown conversion tool: ${name}` }],
        isError: true,
      }
  }
}
