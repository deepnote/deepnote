import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  runToDeepnoteConversion,
  SOURCE_NOTEBOOK_FORMAT_EXTENSIONS,
  type SourceNotebookFormat,
  tryDetectFormat,
} from '@deepnote/convert'

export async function listNotebookFilesInDirectory(dirPath: string, format: SourceNotebookFormat): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const targetExt = SOURCE_NOTEBOOK_FORMAT_EXTENSIONS[format]
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(targetExt))
    .map(entry => resolve(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b))

  if (format === 'percent' || format === 'marimo') {
    const fileContents = await Promise.all(files.map(file => fs.readFile(file, 'utf-8')))
    return files.filter((file, index) => tryDetectFormat(file, fileContents[index]) === format)
  }

  return files
}

export async function convertDirectoryToDeepnote(params: {
  inputDir: string
  format: SourceNotebookFormat
  outputDir: string
  projectName: string
  projectId?: string
}): Promise<{
  inputFiles: string[]
  outputFiles: string[]
  outputDir: string
  projectName: string
  projectId: string
}> {
  const inputFiles = await listNotebookFilesInDirectory(params.inputDir, params.format)
  if (inputFiles.length === 0) {
    throw new Error(`No input files found for format "${params.format}" in directory: ${params.inputDir}`)
  }

  await fs.mkdir(params.outputDir, { recursive: true })

  const projectId = params.projectId ?? randomUUID()
  const outputFiles: string[] = []

  for (const inputFile of inputFiles) {
    const outputName = basename(inputFile, extname(inputFile))
    const outputPath = resolve(params.outputDir, `${outputName}.deepnote`)
    await runToDeepnoteConversion(params.format, inputFile, {
      projectName: params.projectName,
      projectId,
      outputPath,
    })
    outputFiles.push(outputPath)
  }

  return {
    inputFiles,
    outputFiles,
    outputDir: params.outputDir,
    projectName: params.projectName,
    projectId,
  }
}

export async function resolveConvertToOutputPath(
  outputPathRaw: string | undefined,
  absoluteInput: string
): Promise<string> {
  if (!outputPathRaw) {
    const ext = extname(absoluteInput)
    return ext ? `${absoluteInput.slice(0, -ext.length)}.deepnote` : `${absoluteInput}.deepnote`
  }

  const resolvedOutputPath = resolve(outputPathRaw)

  try {
    const outputStat = await fs.stat(resolvedOutputPath)
    if (outputStat.isDirectory()) {
      return resolve(resolvedOutputPath, `${basename(absoluteInput, extname(absoluteInput))}.deepnote`)
    }
  } catch {
    // path may not exist yet
  }

  if (resolvedOutputPath.toLowerCase().endsWith('.deepnote')) {
    return resolvedOutputPath
  }

  return `${resolvedOutputPath}.deepnote`
}

export function resolveConvertToOutputDir(outputPathRaw: string | undefined, absoluteInputDir: string): string {
  return outputPathRaw ? resolve(outputPathRaw) : absoluteInputDir
}
