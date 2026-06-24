import { convertDeepnoteFileToJupyterFiles } from './deepnote-to-jupyter'
import { convertDeepnoteFileToMarimoFiles } from './deepnote-to-marimo'
import { convertDeepnoteFileToPercentFiles } from './deepnote-to-percent'
import { convertDeepnoteFileToQuartoFiles } from './deepnote-to-quarto'
import type { NotebookFormat } from './format-detection'
import { convertIpynbFileToDeepnoteFile } from './jupyter-to-deepnote'
import { convertMarimoFileToDeepnoteFile } from './marimo-to-deepnote'
import { convertPercentFileToDeepnoteFile } from './percent-to-deepnote'
import { convertQuartoFileToDeepnoteFile } from './quarto-to-deepnote'

export type SourceNotebookFormat = Exclude<NotebookFormat, 'deepnote'>

export const SOURCE_NOTEBOOK_FORMATS = [
  'jupyter',
  'percent',
  'quarto',
  'marimo',
] as const satisfies readonly SourceNotebookFormat[]

export const SOURCE_NOTEBOOK_FORMAT_EXTENSIONS: Record<SourceNotebookFormat, string> = {
  jupyter: '.ipynb',
  quarto: '.qmd',
  percent: '.py',
  marimo: '.py',
}

export function isSourceNotebookFormat(format: string): format is SourceNotebookFormat {
  return (SOURCE_NOTEBOOK_FORMATS as readonly string[]).includes(format)
}

export interface RunToDeepnoteConversionOptions {
  projectName: string
  projectId?: string
  outputPath: string
}

export async function runToDeepnoteConversion(
  format: SourceNotebookFormat,
  inputFile: string,
  opts: RunToDeepnoteConversionOptions
): Promise<void> {
  switch (format) {
    case 'jupyter':
      await convertIpynbFileToDeepnoteFile(inputFile, opts)
      break
    case 'quarto':
      await convertQuartoFileToDeepnoteFile(inputFile, opts)
      break
    case 'percent':
      await convertPercentFileToDeepnoteFile(inputFile, opts)
      break
    case 'marimo':
      await convertMarimoFileToDeepnoteFile(inputFile, opts)
      break
    default:
      format satisfies never
      throw new Error(`Unknown format: ${format}`)
  }
}

export interface RunFromDeepnoteConversionOptions {
  outputDir: string
}

export async function runFromDeepnoteConversion(
  format: SourceNotebookFormat,
  inputFile: string,
  opts: RunFromDeepnoteConversionOptions
): Promise<void> {
  switch (format) {
    case 'jupyter':
      await convertDeepnoteFileToJupyterFiles(inputFile, opts)
      break
    case 'percent':
      await convertDeepnoteFileToPercentFiles(inputFile, opts)
      break
    case 'quarto':
      await convertDeepnoteFileToQuartoFiles(inputFile, opts)
      break
    case 'marimo':
      await convertDeepnoteFileToMarimoFiles(inputFile, opts)
      break
    default:
      format satisfies never
      throw new Error(`Unknown format: ${format}`)
  }
}
