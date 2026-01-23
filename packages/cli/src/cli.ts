import chalk from 'chalk'
import { Command } from 'commander'
import { createInspectAction } from './commands/inspect'
import { createRunAction } from './commands/run'
import { createValidateAction } from './commands/validate'
import { generateCompletionScript } from './completions'
import { ExitCode } from './exit-codes'
import { getChalk, getOutputConfig, OUTPUT_FORMATS, output, setOutputConfig, shouldDisableColor } from './output'
import { createFormatValidator } from './utils/format-validator'
import { version } from './version'

/**
 * Global CLI options that apply to all commands.
 */
export interface GlobalOptions {
  color: boolean
  debug: boolean
  quiet: boolean
}

/**
 * Creates and configures the main CLI program.
 */
export function createProgram(): Command {
  const program = new Command()

  program
    .name('deepnote')
    .description(getWelcomeText())
    .version(version, '-v, --version', 'Display the CLI version')
    .helpOption('-h, --help', 'Display help information')
    .showHelpAfterError(false)
    .configureOutput({
      // Write errors to stderr with chalk styling
      outputError: (str, write) => write(chalk.red(str)),
    })
    // Global options
    .option('--no-color', 'Disable colored output (also respects NO_COLOR env var)')
    .option('--debug', 'Show debug information for troubleshooting')
    .option('-q, --quiet', 'Suppress non-essential output')
    .hook('preAction', (thisCommand, _actionCommand) => {
      const opts = thisCommand.opts<GlobalOptions>()

      // Configure output based on global options
      setOutputConfig({
        color: opts.color && !shouldDisableColor(),
        debug: opts.debug ?? false,
        quiet: opts.quiet ?? false,
      })

      // Update chalk level if color is disabled
      if (!getOutputConfig().color) {
        chalk.level = 0
      }
    })
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Examples:')}
  ${c.dim('# Run the first .deepnote file in current directory')}
  $ deepnote run

  ${c.dim('# Inspect a specific .deepnote file')}
  $ deepnote inspect my-project.deepnote

  ${c.dim('# Run a .deepnote file in a subdirectory')}
  $ deepnote run notebooks/

  ${c.dim('# Inspect with JSON output (for scripting)')}
  $ deepnote inspect -o json

  ${c.dim('# Run with TOON output (for LLMs)')}
  $ deepnote run -o toon

  ${c.dim('# Inspect with JSON output (for scripting)')}
  $ deepnote inspect --json

  ${c.dim('# Get help for a specific command')}
  $ deepnote help run

  ${c.dim('# Generate shell completions')}
  $ deepnote completion bash >> ~/.bashrc

${c.bold('Global Options:')}
  ${c.dim('--no-color')}    Disable colored output (respects NO_COLOR env var)
  ${c.dim('--debug')}       Show debug information for troubleshooting
  ${c.dim('-q, --quiet')}   Suppress non-essential output

${c.bold('Environment Variables:')}
  ${c.dim('NO_COLOR')}      Set to any value to disable colored output
  ${c.dim('FORCE_COLOR')}   Set to 1 to force colors, 0 to disable

${c.bold('Exit Codes:')}
  ${c.dim('0')}  Success
  ${c.dim('1')}  General error (runtime failures)
  ${c.dim('2')}  Invalid usage (bad arguments, file not found)
`
    })

  // Register all commands
  registerCommands(program)

  return program
}

/**
 * Registers all available commands on the program.
 */
function registerCommands(program: Command): void {
  // Inspect command - for inspecting and displaying .deepnote file metadata
  program
    .command('inspect')
    .description('Inspect and display metadata from a .deepnote file')
    .argument('[path]', 'Path to a .deepnote file or directory (defaults to current directory)')
    .option('-o, --output <format>', 'Output format: json, toon', createFormatValidator(OUTPUT_FORMATS))
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Output:')}
  Displays structured information about the .deepnote file including:
  - File path and project name
  - Project ID and file format version
  - Creation, modification, and export timestamps
  - Number of notebooks and total blocks
  - List of notebooks with their block counts

${c.bold('Smart File Discovery:')}
  If no path is provided, finds the first .deepnote file in the current directory.
  If a directory is provided, finds the first .deepnote file in that directory.

${c.bold('Examples:')}
  ${c.dim('# Inspect first .deepnote file in current directory')}
  $ deepnote inspect

  ${c.dim('# Inspect a specific .deepnote file')}
  $ deepnote inspect my-project.deepnote

  ${c.dim('# Inspect first .deepnote file in a subdirectory')}
  $ deepnote inspect notebooks/

  ${c.dim('# Output as JSON for scripting')}
  $ deepnote inspect -o json

  ${c.dim('# Output as TOON for LLM consumption (30-60% fewer tokens)')}
  $ deepnote inspect -o toon

  ${c.dim('# Use with jq for specific fields')}
  $ deepnote inspect -o json | jq '.project.name'
`
    })
    .action(createInspectAction(program))

  // Run command - execute a .deepnote file
  program
    .command('run')
    .description('Run a .deepnote file')
    .argument('[path]', 'Path to a .deepnote file or directory (defaults to current directory)')
    .option('--python <path>', 'Path to Python (executable, bin directory, or venv root)')
    .option('--cwd <path>', 'Working directory for execution (defaults to file directory)')
    .option('--notebook <name>', 'Run only the specified notebook')
    .option('--block <id>', 'Run only the specified block')
    .option(
      '-i, --input <key=value>',
      'Set input variable value (can be repeated)',
      (val, prev: string[]) => {
        prev.push(val)
        return prev
      },
      []
    )
    .option('--list-inputs', 'List all input variables in the notebook without running')
    .option('-o, --output <format>', 'Output format: json, toon', createFormatValidator(OUTPUT_FORMATS))
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Smart File Discovery:')}
  If no path is provided, finds the first .deepnote file in the current directory.
  If a directory is provided, finds the first .deepnote file in that directory.

${c.bold('Examples:')}
  ${c.dim('# Run first .deepnote file in current directory')}
  $ deepnote run

  ${c.dim('# Run a specific .deepnote file')}
  $ deepnote run my-project.deepnote

  ${c.dim('# Run first .deepnote file in a subdirectory')}
  $ deepnote run notebooks/

  ${c.dim('# Run with a specific Python virtual environment')}
  $ deepnote run --python path/to/venv

  ${c.dim('# Run only a specific notebook')}
  $ deepnote run --notebook "Data Analysis"

  ${c.dim('# Run only a specific block')}
  $ deepnote run --block abc123

  ${c.dim('# List input variables needed by the notebook')}
  $ deepnote run my-project.deepnote --list-inputs

  ${c.dim('# Set input values for input blocks')}
  $ deepnote run my-project.deepnote --input name="Alice" --input count=42

  ${c.dim('# Input values support JSON for complex types')}
  $ deepnote run my-project.deepnote -i 'config={"debug": true}'

  ${c.dim('# Output results as JSON for CI/CD pipelines')}
  $ deepnote run -o json

  ${c.dim('# Output results as TOON for LLM consumption (30-60% fewer tokens)')}
  $ deepnote run -o toon

${c.bold('Exit Codes:')}
  ${c.dim('0')}  Success
  ${c.dim('1')}  Runtime error (code execution failed)
  ${c.dim('2')}  Invalid usage (missing file, bad arguments, missing required inputs)
`
    })
    .action(createRunAction(program))

  // Validate command - validate a .deepnote file against the schema
  program
    .command('validate')
    .description('Validate a .deepnote file against the schema')
    .argument('<path>', 'Path to a .deepnote file to validate')
    // Validate command only supports JSON output (no TOON)
    .option('-o, --output <format>', 'Output format: json', createFormatValidator(['json']))
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Output:')}
  Reports whether the .deepnote file is valid and lists any schema violations.
  Uses the Zod schemas from @deepnote/blocks to validate the file structure.

${c.bold('Exit Codes:')}
  ${c.dim('0')}  File is valid
  ${c.dim('1')}  File is invalid (schema violations found)
  ${c.dim('2')}  Invalid usage (file not found, not a .deepnote file)

${c.bold('Examples:')}
  ${c.dim('# Validate a .deepnote file')}
  $ deepnote validate my-project.deepnote

  ${c.dim('# Validate with JSON output for CI/CD')}
  $ deepnote validate my-project.deepnote -o json

  ${c.dim('# Validate and check exit code in scripts')}
  $ deepnote validate my-project.deepnote && echo "Valid!"

  ${c.dim('# Parse JSON output with jq')}
  $ deepnote validate my-project.deepnote -o json | jq '.valid'
`
    })
    .action(createValidateAction(program))

  // Completion command - generate shell completions
  program
    .command('completion')
    .description('Generate shell completion scripts')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Supported Shells:')}
  bash    Bourne Again Shell
  zsh     Z Shell
  fish    Friendly Interactive Shell

${c.bold('Installation:')}
  ${c.dim('# Bash (add to ~/.bashrc or ~/.bash_profile)')}
  $ deepnote completion bash >> ~/.bashrc
  $ source ~/.bashrc

  ${c.dim('# Zsh (add to ~/.zshrc)')}
  $ deepnote completion zsh >> ~/.zshrc
  $ source ~/.zshrc

  ${c.dim('# Fish (save to completions directory)')}
  $ deepnote completion fish > ~/.config/fish/completions/deepnote.fish

${c.bold('Examples:')}
  ${c.dim('# Preview bash completions without installing')}
  $ deepnote completion bash

  ${c.dim('# Install zsh completions')}
  $ deepnote completion zsh >> ~/.zshrc && source ~/.zshrc
`
    })
    .action((shell: string) => {
      const completionScript = generateCompletionScript(shell, program)
      if (completionScript) {
        output(completionScript)
      } else {
        program.error(`Unsupported shell: ${shell}. Supported shells: bash, zsh, fish`, {
          exitCode: ExitCode.InvalidUsage,
        })
      }
    })
}

/**
 * Returns the welcome text displayed in help output.
 */
function getWelcomeText(): string {
  return `${chalk.bold.cyan('Deepnote CLI')} - Run Deepnote projects from the command line

${chalk.dim('Run .deepnote files locally or on Deepnote Cloud for data science workflows,')}
${chalk.dim('automation, CI/CD pipelines, and interactive development.')}

${chalk.dim('Documentation:')} ${chalk.underline('https://deepnote.com/docs/getting-started')}
${chalk.dim('Repository:')}    ${chalk.underline('https://github.com/deepnote/deepnote')}`
}

/**
 * Parses command line arguments and runs the CLI.
 * This is the main entry point for the CLI.
 */
export function run(argv?: string[]): void {
  const program = createProgram()
  program.parse(argv ?? process.argv)
}
