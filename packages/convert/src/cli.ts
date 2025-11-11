import fs from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import chalk from 'chalk'
import ora from 'ora'
import { convertDeepnoteFileToIpynb, convertIpynbFilesToDeepnoteFile } from '.'

interface ConvertOptions {
  inputPath: string
  projectName?: string
  outputPath?: string
  cwd?: string
}

export async function convert(options: ConvertOptions): Promise<string> {
  const { inputPath, projectName: customProjectName, outputPath: customOutputPath, cwd = process.cwd() } = options

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

  if (ext === '.ipynb') {
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

  if (ext === '.deepnote') {
    const spinner = ora('Converting the Deepnote project to Jupyter Notebooks...').start()

    try {
      const filenameWithoutExtension = basename(absolutePath, ext)

      let outputDir: string
      if (customOutputPath) {
        const absoluteOutputPath = resolve(cwd, customOutputPath)
        const stat = await fs.stat(absoluteOutputPath).catch(() => null)

        if (stat?.isDirectory()) {
          outputDir = absoluteOutputPath
        } else {
          // If output path is a file or doesn't exist, use its parent directory
          outputDir = dirname(absoluteOutputPath)
        }
      } else {
        // Create a directory with the project name in the current working directory
        outputDir = resolve(cwd, filenameWithoutExtension)
      }

      await convertDeepnoteFileToIpynb(absolutePath, { outputDir })

      spinner.succeed(`The Jupyter Notebooks have been saved to ${chalk.bold(outputDir)}`)

      return outputDir
    } catch (error) {
      spinner.fail('Conversion failed')
      throw error
    }
  }

  throw new Error(
    'Unsupported file type. Please provide a .ipynb file, directory of .ipynb files, or a .deepnote file.'
  )
}
