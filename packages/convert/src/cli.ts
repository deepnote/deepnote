import fs from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { deepnoteFileSchema } from '@deepnote/blocks'
import chalk from 'chalk'
import ora from 'ora'
import { parse as parseYaml } from 'yaml'
import { convertIpynbFilesToDeepnoteFile } from '.'

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
    throw new Error('The .deepnote format is not supported for conversion yet.')
  }

  throw new Error('Unsupported file type. Please provide a .ipynb or .deepnote file.')
}

interface ValidateOptions {
  inputPath: string
  cwd?: string
}

/**
 * Recursively find all .deepnote files in a directory
 */
async function findDeepnoteFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue
      }
      files.push(...(await findDeepnoteFiles(fullPath)))
    } else if (entry.name.endsWith('.deepnote')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Validate a single .deepnote file
 */
async function validateSingleFile(filePath: string): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    // Read and parse the file
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = parseYaml(content)

    // Validate against the schema
    const result = deepnoteFileSchema.safeParse(parsed)

    if (result.success) {
      return { valid: true }
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
      return `  • ${path}: ${issue.message}`
    })

    return { valid: false, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { valid: false, errors: [`  • Parse error: ${message}`] }
  }
}

export async function validate(options: ValidateOptions): Promise<void> {
  const { inputPath, cwd = process.cwd() } = options

  const absolutePath = resolve(cwd, inputPath)
  const stat = await fs.stat(absolutePath)

  // If it's a directory, recursively find all .deepnote files
  if (stat.isDirectory()) {
    const spinner = ora('Searching for .deepnote files...').start()
    const deepnoteFiles = await findDeepnoteFiles(absolutePath)

    if (deepnoteFiles.length === 0) {
      spinner.warn('No .deepnote files found')
      return
    }

    spinner.succeed(`Found ${deepnoteFiles.length} .deepnote file(s)\n`)

    let allValid = true
    const results: Array<{ file: string; valid: boolean; errors?: string[] }> = []

    for (const file of deepnoteFiles) {
      const relativePath = basename(file)
      const result = await validateSingleFile(file)
      results.push({ file: relativePath, ...result })

      if (result.valid) {
        // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
        console.log(chalk.green(`✔ ${relativePath}`))
      } else {
        // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
        console.log(chalk.red(`✖ ${relativePath}`))
        if (result.errors) {
          for (const error of result.errors) {
            // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
            console.log(chalk.red(error))
          }
        }
        // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
        console.log('')
        allValid = false
      }
    }

    if (allValid) {
      // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
      console.log(chalk.green(`\n✔ All ${deepnoteFiles.length} file(s) are valid!`))
    } else {
      const failedCount = results.filter(r => !r.valid).length
      // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
      console.log(chalk.red(`\n✖ ${failedCount} of ${deepnoteFiles.length} file(s) failed validation`))
      process.exit(1)
    }

    return
  }

  // Single file validation
  const ext = extname(absolutePath).toLowerCase()

  if (ext !== '.deepnote') {
    throw new Error('Only .deepnote files can be validated. Please provide a .deepnote file or directory.')
  }

  const spinner = ora('Validating Deepnote file...').start()

  const result = await validateSingleFile(absolutePath)

  if (result.valid) {
    spinner.succeed(`${chalk.bold(basename(absolutePath))} is a valid Deepnote file!`)
  } else {
    spinner.fail(`${chalk.bold(basename(absolutePath))} is invalid`)

    // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
    console.error(chalk.red('\nValidation errors:'))
    if (result.errors) {
      for (const error of result.errors) {
        // biome-ignore lint/suspicious/noConsole: CLI output is appropriate
        console.error(chalk.red(error))
      }
    }

    process.exit(1)
  }
}
