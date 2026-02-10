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

async function handleConvertTo(args: Record<string, unknown>) {
  const inputPath = args.inputPath as string
  const outputPath = args.outputPath as string | undefined
  const projectName = args.projectName as string | undefined
  let format = (args.format as string) || 'auto'

  const absoluteInput = path.resolve(inputPath)

  // Auto-detect format if needed
  if (format === 'auto') {
    const content = await fs.readFile(absoluteInput, 'utf-8')
    format = detectFormat(absoluteInput, content)
  }

  // Determine output path
  const finalOutputPath = outputPath || absoluteInput.replace(/\.(ipynb|qmd|py)$/, '.deepnote')

  // Determine project name
  const finalProjectName = projectName || path.basename(absoluteInput).replace(/\.(ipynb|qmd|py)$/, '')

  try {
    switch (format) {
      case 'jupyter':
        await convertIpynbFilesToDeepnoteFile([absoluteInput], {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'quarto':
        await convertQuartoFilesToDeepnoteFile([absoluteInput], {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'percent':
        await convertPercentFilesToDeepnoteFile([absoluteInput], {
          projectName: finalProjectName,
          outputPath: finalOutputPath,
        })
        break
      case 'marimo':
        await convertMarimoFilesToDeepnoteFile([absoluteInput], {
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
  const inputPath = args.inputPath as string
  const outputDir = args.outputDir as string | undefined
  const format = (args.format as string) || 'jupyter'

  const absoluteInput = path.resolve(inputPath)
  const finalOutputDir = outputDir || path.dirname(absoluteInput)

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
