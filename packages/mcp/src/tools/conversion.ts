import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { convertDirectoryToDeepnote, resolveConvertToOutputDir, resolveConvertToOutputPath } from '@deepnote/cli'
import {
  detectFormat,
  isSourceNotebookFormat,
  runFromDeepnoteConversion,
  runToDeepnoteConversion,
  SOURCE_NOTEBOOK_FORMATS,
  type SourceNotebookFormat,
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
          enum: [...SOURCE_NOTEBOOK_FORMATS, 'auto'],
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
          enum: [...SOURCE_NOTEBOOK_FORMATS],
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

const convertToFormatSchema = z.enum([...SOURCE_NOTEBOOK_FORMATS, 'auto'] as const)
const convertFromFormatSchema = z.enum(SOURCE_NOTEBOOK_FORMATS)

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

interface ConvertToSuccessPayload {
  inputPath: string
  outputPath: string
  detectedFormat: SourceNotebookFormat
  projectName: string
  inputFiles: string[]
  outputFiles: string[]
  outputIsDirectory: boolean
}

/** Converts one source notebook to a single-notebook `.deepnote` file. */
async function convertSingleFileToDeepnote(
  absoluteInput: string,
  format: SourceNotebookFormat,
  outputPath: string | undefined,
  projectName: string | undefined
): Promise<ConvertToSuccessPayload> {
  const finalOutputPath = await resolveConvertToOutputPath(outputPath, absoluteInput)
  const finalProjectName = projectName || path.basename(absoluteInput, path.extname(absoluteInput))

  await runToDeepnoteConversion(format, absoluteInput, {
    projectName: finalProjectName,
    outputPath: finalOutputPath,
  })

  return {
    inputPath: absoluteInput,
    outputPath: finalOutputPath,
    detectedFormat: format,
    projectName: finalProjectName,
    inputFiles: [absoluteInput],
    outputFiles: [finalOutputPath],
    outputIsDirectory: false,
  }
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

  if (format === 'auto' && inputIsFile) {
    const content = await fs.readFile(absoluteInput, 'utf-8')
    const detectedFormat = detectFormat(absoluteInput, content)
    if (detectedFormat === 'deepnote') {
      return toError('Input is already a .deepnote file; use deepnote_convert_from to export to other formats')
    }
    format = detectedFormat
  }

  if (!isSourceNotebookFormat(format)) {
    return toError(`Unknown format: ${format}`)
  }

  try {
    if (inputIsDirectory) {
      const outputDir = resolveConvertToOutputDir(outputPath, absoluteInput)
      const finalProjectName = projectName || path.basename(absoluteInput)

      let result: Awaited<ReturnType<typeof convertDirectoryToDeepnote>>
      try {
        result = await convertDirectoryToDeepnote({
          inputDir: absoluteInput,
          format,
          outputDir,
          projectName: finalProjectName,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return toError(message)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                inputPath: absoluteInput,
                outputPath: result.outputDir,
                detectedFormat: format,
                projectName: result.projectName,
                inputFiles: result.inputFiles,
                outputFiles: result.outputFiles,
                outputIsDirectory: true,
              } satisfies ConvertToSuccessPayload & { success: true },
              null,
              2
            ),
          },
        ],
      }
    }

    const payload = await convertSingleFileToDeepnote(absoluteInput, format, outputPath, projectName)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, ...payload }, null, 2),
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
    await runFromDeepnoteConversion(format, absoluteInput, { outputDir: finalOutputDir })

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
