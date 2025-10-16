import console from 'node:console'
import fs from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import chalk from 'chalk'
import { cli } from 'cleye'
import ora from 'ora'
import { convertIpynbFilesToDeepnoteFile } from '.'

async function main() {
  const argv = cli({
    name: 'deepnote-convert',

    // Define parameters
    parameters: ['<path>'],

    // Define flags/options
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

  const resolveProjectName = (possibleName?: string): string => {
    if (argv.flags.projectName) {
      return argv.flags.projectName
    }

    if (possibleName) {
      return possibleName
    }

    return 'Untitled project'
  }

  const resolveOutputPath = async (outputFilename: string): Promise<string> => {
    if (argv.flags.outputPath) {
      const absoluteOutputPath = resolve(argv.flags.outputPath)
      const stat = await fs.stat(absoluteOutputPath).catch(() => null)

      if (stat?.isDirectory()) {
        return resolve(absoluteOutputPath, outputFilename)
      }

      return absoluteOutputPath
    }

    return resolve(process.cwd(), outputFilename)
  }

  const inputPathRaw = argv._.path
  const absolutePath = resolve(inputPathRaw)

  const stat = await fs.stat(absolutePath)

  if (stat.isDirectory()) {
    const files = await fs.readdir(absolutePath)
    const ipynbFiles = files.filter(file => file.toLowerCase().endsWith('.ipynb'))

    if (ipynbFiles.length === 0) {
      throw new Error('No .ipynb files found in the specified directory.')
    }

    const spinner = ora('Converting Jupyter Notebooks to a Deepnote project...').start()

    const filenameWithoutExtension = basename(absolutePath)
    const projectName = resolveProjectName(filenameWithoutExtension)

    const outputFilename = `${filenameWithoutExtension}.deepnote`
    const outputPath = await resolveOutputPath(outputFilename)

    const inputFilePaths = ipynbFiles.map(file => resolve(absolutePath, file))

    await convertIpynbFilesToDeepnoteFile(inputFilePaths, { projectName, outputPath })

    spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
  } else {
    const extension = absolutePath.split('.').pop()?.toLowerCase().trim()

    if (extension === 'ipynb') {
      const spinner = ora('Converting the Jupyter Notebook to a Deepnote project...').start()

      const filenameWithoutExtension = basename(absolutePath, '.ipynb')
      const projectName = resolveProjectName(filenameWithoutExtension)

      const outputFilename = `${filenameWithoutExtension}.deepnote`
      const outputPath = await resolveOutputPath(outputFilename)

      await convertIpynbFilesToDeepnoteFile([absolutePath], { projectName, outputPath })

      spinner.succeed(`The Deepnote project has been saved to ${chalk.bold(outputPath)}`)
    } else if (extension === 'deepnote') {
      throw new Error('The .deepnote format is not supported for conversion yet.')
    } else {
      throw new Error('Unsupported file type. Please provide a .ipynb or .deepnote file.')
    }
  }
}

main().catch(error => {
  console.error(error)

  process.exit(1)
})
