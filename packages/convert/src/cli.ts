import console from 'node:console'
import fs from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import chalk from 'chalk'
import { cli } from 'cleye'
import ora from 'ora'
import { convertIpynbFilesToDeepnoteFile } from '.'

interface ConvertOptions {
  inputPath: string
  projectName?: string
  outputPath?: string
  cwd?: string
  silent?: boolean
}

export async function convert(options: ConvertOptions): Promise<string> {
  const {
    inputPath,
    projectName: customProjectName,
    outputPath: customOutputPath,
    cwd = process.cwd(),
    silent = false,
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
      const absoluteOutputPath = resolve(customOutputPath)
      const stat = await fs.stat(absoluteOutputPath).catch(() => null)

      if (stat?.isDirectory()) {
        return resolve(absoluteOutputPath, outputFilename)
      }

      return absoluteOutputPath
    }

    return resolve(cwd, outputFilename)
  }

  const absolutePath = resolve(inputPath)

  const stat = await fs.stat(absolutePath)

  if (stat.isDirectory()) {
    const files = await fs.readdir(absolutePath)
    const ipynbFiles = files.filter(file => file.toLowerCase().endsWith('.ipynb'))

    if (ipynbFiles.length === 0) {
      throw new Error('No .ipynb files found in the specified directory.')
    }

    const spinner = silent ? null : ora('Converting Jupyter Notebooks to a Deepnote project...').start()

    const filenameWithoutExtension = basename(absolutePath)
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    const inputFilePaths = ipynbFiles.map(file => resolve(absolutePath, file))

    await convertIpynbFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })

    if (spinner) {
      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
    }

    return outputPath
  }

  const extension = absolutePath.split('.').pop()?.toLowerCase().trim()

  if (extension === 'ipynb') {
    const spinner = silent ? null : ora('Converting the Jupyter Notebook to a Deepnote project...').start()

    const filenameWithoutExtension = basename(absolutePath, '.ipynb')
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    await convertIpynbFilesToDeepnoteFile([absolutePath], { projectName, outputPath })

    if (spinner) {
      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
    }

    return outputPath
  }

  if (extension === 'deepnote') {
    throw new Error('The .deepnote format is not supported for conversion yet.')
  }

  throw new Error('Unsupported file type. Please provide a .ipynb or .deepnote file.')
}

async function main() {
  const argv = cli({
    name: 'deepnote-convert',
    parameters: ['<path>'],
    flags: {
      projectName: {
        description: 'The name of the Deepnote project.',
        type: String,
      },
      outputPath: {
        alias: 'o',
        description: 'The path where the .deepnote file will be saved.',
        type: String,
      },
    },
  })

  await convert({
    inputPath: argv._.path,
    projectName: argv.flags.projectName,
    outputPath: argv.flags.outputPath,
  })
}

// Only run main if not in test mode
if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
