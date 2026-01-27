import chalk from 'chalk'
import { Command } from 'commander'
import { createCatAction } from './commands/cat'
import { createConvertAction } from './commands/convert'
import { createInspectAction } from './commands/inspect'
import { createOpenAction } from './commands/open'
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

  ${c.dim('# Run the first .deepnote file in a subdirectory')}
  $ deepnote run notebooks/

  ${c.dim('# Inspect with JSON output (for scripting)')}
  $ deepnote inspect my-project.deepnote -o json

  ${c.dim('# Display block contents')}
  $ deepnote cat my-project.deepnote

  ${c.dim('# Run a .deepnote file')}
  $ deepnote run my-project.deepnote
  
  ${c.dim('# Run with TOON output (for LLMs)')}
  $ deepnote run my-project.deepnote -o toon

  ${c.dim('# Open a .deepnote file in Deepnote Cloud')}
  $ deepnote open my-project.deepnote

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

${getSmartFileDiscoveryHelp(c)}

${c.bold('Examples:')}
  ${c.dim('# Inspect first .deepnote file in current directory')}
  $ deepnote inspect

  ${c.dim('# Inspect a specific .deepnote file')}
  $ deepnote inspect my-project.deepnote

  ${c.dim('# Inspect first .deepnote file in a subdirectory')}
  $ deepnote inspect notebooks/

  ${c.dim('# Output as JSON for scripting')}
  $ deepnote inspect my-project.deepnote -o json

  ${c.dim('# Output as TOON for LLM consumption (30-60% fewer tokens)')}
  $ deepnote inspect my-project.deepnote -o toon

  ${c.dim('# Use with jq for specific fields')}
  $ deepnote inspect my-project.deepnote -o json | jq '.project.name'
`
    })
    .action(createInspectAction(program))

  // Cat command - display block contents from a .deepnote file
  program
    .command('cat')
    .description('Display block contents from a .deepnote file')
    .argument('<path>', 'Path to a .deepnote file')
    .option('--json', 'Output in JSON format for scripting')
    .option('--notebook <name>', 'Show only blocks from the specified notebook')
    .option('--type <type>', 'Filter blocks by type (code, sql, markdown, input, text)')
    .option('--tree', 'Show structure only without block content')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Block Types:')}
  ${c.dim('code')}        Python code blocks
  ${c.dim('sql')}         SQL query blocks
  ${c.dim('markdown')}    Markdown blocks
  ${c.dim('text')}        All text cell blocks (h1, h2, h3, p, bullet, etc.)
  ${c.dim('input')}       All input blocks (text, select, slider, etc.)

${c.bold('Examples:')}
  ${c.dim('# Display all blocks in a file')}
  $ deepnote cat my-project.deepnote

  ${c.dim('# Show only code blocks')}
  $ deepnote cat my-project.deepnote --type code

  ${c.dim('# Show blocks from a specific notebook')}
  $ deepnote cat my-project.deepnote --notebook "Data Analysis"

  ${c.dim('# Show structure without content (tree view)')}
  $ deepnote cat my-project.deepnote --tree

  ${c.dim('# Output as JSON for scripting')}
  $ deepnote cat my-project.deepnote --json

  ${c.dim('# Combine filters')}
  $ deepnote cat my-project.deepnote --notebook "Analysis" --type sql
`
    })
    .action(createCatAction(program))

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
    .option('--dry-run', 'Show what would be executed without running')
    .option('--top', 'Display resource usage (CPU, memory) during execution')
    .option('--profile', 'Show per-block timing and memory usage')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${getSmartFileDiscoveryHelp(c)}

${c.bold('Examples:')}
  ${c.dim('# Run first .deepnote file in current directory')}
  $ deepnote run

  ${c.dim('# Run a specific .deepnote file')}
  $ deepnote run my-project.deepnote

  ${c.dim('# Run first .deepnote file in a subdirectory')}
  $ deepnote run notebooks/

  ${c.dim('# Run with a specific Python virtual environment')}
  $ deepnote run my-project.deepnote --python path/to/venv

  ${c.dim('# Run only a specific notebook')}
  $ deepnote run my-project.deepnote --notebook "Data Analysis"

  ${c.dim('# Run only a specific block')}
  $ deepnote run my-project.deepnote --block abc123

  ${c.dim('# List input variables needed by the notebook')}
  $ deepnote run my-project.deepnote --list-inputs

  ${c.dim('# Set input values for input blocks')}
  $ deepnote run my-project.deepnote --input name="Alice" --input count=42

  ${c.dim('# Input values support JSON for complex types')}
  $ deepnote run my-project.deepnote -i 'config={"debug": true}'

  ${c.dim('# Monitor resource usage during execution')}
  $ deepnote run my-project.deepnote --top

  ${c.dim('# Profile blocks to identify slow/memory-intensive operations')}
  $ deepnote run my-project.deepnote --profile

  ${c.dim('# Output results as JSON for CI/CD pipelines')}
  $ deepnote run my-project.deepnote -o json

  ${c.dim('# Output results as TOON for LLM consumption (30-60% fewer tokens)')}
  $ deepnote run my-project.deepnote -o toon

  ${c.dim('# Preview what would be executed without running')}
  $ deepnote run my-project.deepnote --dry-run

${c.bold('Exit Codes:')}
  ${c.dim('0')}  Success
  ${c.dim('1')}  Runtime error (code execution failed)
  ${c.dim('2')}  Invalid usage (missing file, bad arguments, missing required inputs)
`
    })
    .action(createRunAction(program))

  // Open command - open a .deepnote file in deepnote.com
  program
    .command('open')
    .description('Open a .deepnote file in Deepnote Cloud')
    .argument('<path>', 'Path to a .deepnote file to open')
    .option('--domain <domain>', 'Deepnote domain (defaults to deepnote.com)')
    .option('-o, --output <format>', 'Output format: json', createFormatValidator(['json']))
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Description:')}
  Uploads the .deepnote file to Deepnote and opens it in your default browser.
  This is useful for quickly viewing or editing your local notebooks in Deepnote.
  Note: Files must be under 100 MB.

${c.bold('Output:')}
  On success, displays a confirmation message and the URL.
  The URL can be shared with others to view the notebook.

${c.bold('Examples:')}
  ${c.dim('# Open a .deepnote file in Deepnote')}
  $ deepnote open my-project.deepnote

  ${c.dim('# Open with JSON output (for scripting)')}
  $ deepnote open my-project.deepnote -o json

  ${c.dim('# Use a custom domain (e.g., single-tenants)')}
  $ deepnote open my-project.deepnote --domain deepnote.example.com

${c.bold('Exit Codes:')}
  ${c.dim('0')}  Success
  ${c.dim('1')}  Import error (upload or network failure)
  ${c.dim('2')}  Invalid usage (file not found, not a .deepnote file, file too large)
`
    })
    .action(createOpenAction(program))

  // Convert command - convert between notebook formats
  program
    .command('convert')
    .description('Convert between notebook formats (.ipynb, .qmd, .py, .deepnote)')
    .argument('<path>', 'Path to a file or directory to convert')
    .option('-o, --output <path>', 'Output path (file or directory)')
    .option('-n, --name <name>', 'Project name (for conversions to .deepnote)')
    .option(
      '-f, --format <format>',
      'Output format when converting from .deepnote (jupyter, percent, quarto, marimo)',
      'jupyter'
    )
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Supported Formats:')}
  ${c.dim('.ipynb')}     Jupyter Notebook
  ${c.dim('.qmd')}       Quarto document
  ${c.dim('.py')}        Percent format (# %%) or Marimo (@app.cell)
  ${c.dim('.deepnote')}  Deepnote project

${c.bold('Conversion Directions:')}
  ${c.dim('To Deepnote:')}   .ipynb, .qmd, .py → .deepnote
  ${c.dim('From Deepnote:')} .deepnote → .ipynb, .qmd, .py (percent/marimo)

${c.bold('Examples:')}
  ${c.dim('# Convert Jupyter notebook to Deepnote')}
  $ deepnote convert notebook.ipynb

  ${c.dim('# Convert directory of notebooks')}
  $ deepnote convert ./notebooks/

  ${c.dim('# Convert with custom output path')}
  $ deepnote convert notebook.ipynb -o my-project.deepnote

  ${c.dim('# Convert with custom project name')}
  $ deepnote convert notebook.ipynb -n "My Analysis"

  ${c.dim('# Convert Deepnote to Jupyter')}
  $ deepnote convert project.deepnote

  ${c.dim('# Convert Deepnote to Quarto')}
  $ deepnote convert project.deepnote -f quarto

  ${c.dim('# Convert Deepnote to Marimo')}
  $ deepnote convert project.deepnote -f marimo
`
    })
    .action(createConvertAction(program))

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
 * Returns shared help text for Smart File Discovery.
 */
function getSmartFileDiscoveryHelp(c: ReturnType<typeof getChalk>): string {
  return `${c.bold('Smart File Discovery:')}
  If no path is provided, finds the first .deepnote file in the current directory.
  If a directory is provided, finds the first .deepnote file in that directory.
  If multiple .deepnote files are found, the CLI picks the first file in alphabetical order (by filename) to ensure deterministic behavior.`
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
