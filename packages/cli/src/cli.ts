import chalk from 'chalk'
import { Command } from 'commander'
import { createDagDownstreamAction, createDagShowAction, createDagVarsAction } from './commands/dag'
import { createInspectAction } from './commands/inspect'
import { createLintAction } from './commands/lint'
import { createRunAction } from './commands/run'
import { createStatsAction } from './commands/stats'
import { generateCompletionScript } from './completions'
import { ExitCode } from './exit-codes'
import { getChalk, getOutputConfig, output, setOutputConfig, shouldDisableColor } from './output'
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
    .hook('preAction', thisCommand => {
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
  ${c.dim('# Show this help message')}
  $ deepnote --help

  ${c.dim('# Show version')}
  $ deepnote --version

  ${c.dim('# Inspect a .deepnote file')}
  $ deepnote inspect my-project.deepnote

  ${c.dim('# Inspect with JSON output (for scripting)')}
  $ deepnote inspect my-project.deepnote --json

  ${c.dim('# Run a .deepnote file')}
  $ deepnote run my-project.deepnote

  ${c.dim('# Check for issues')}
  $ deepnote lint my-project.deepnote

  ${c.dim('# Show project statistics')}
  $ deepnote stats my-project.deepnote

  ${c.dim('# Get help for a specific command')}
  $ deepnote help inspect

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
    .argument('<path>', 'Path to a .deepnote file to inspect')
    .option('--json', 'Output in JSON format for scripting')
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

${c.bold('Examples:')}
  ${c.dim('# Inspect a local .deepnote file')}
  $ deepnote inspect my-project.deepnote

  ${c.dim('# Inspect a file in a subdirectory')}
  $ deepnote inspect notebooks/analysis.deepnote

  ${c.dim('# Output as JSON for scripting')}
  $ deepnote inspect my-project.deepnote --json

  ${c.dim('# Use with jq for specific fields')}
  $ deepnote inspect my-project.deepnote --json | jq '.project.name'
`
    })
    .action(createInspectAction(program))

  // Run command - execute a .deepnote file
  program
    .command('run')
    .description('Run a .deepnote file')
    .argument('<path>', 'Path to a .deepnote file to run')
    .option('--python <path>', 'Path to Python (executable, bin directory, or venv root)')
    .option('--cwd <path>', 'Working directory for execution (defaults to file directory)')
    .option('--notebook <name>', 'Run only the specified notebook')
    .option('--block <id>', 'Run only the specified block')
    .option('--json', 'Output results in JSON format for scripting')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Examples:')}
  ${c.dim('# Run all notebooks in a .deepnote file')}
  $ deepnote run my-project.deepnote

  ${c.dim('# Run with a specific Python virtual environment')}
  $ deepnote run my-project.deepnote --python path/to/venv

  ${c.dim('# Run only a specific notebook')}
  $ deepnote run my-project.deepnote --notebook "Data Analysis"

  ${c.dim('# Run only a specific block')}
  $ deepnote run my-project.deepnote --block abc123

  ${c.dim('# Output results as JSON for CI/CD pipelines')}
  $ deepnote run my-project.deepnote --json
`
    })
    .action(createRunAction(program))

  // DAG command - analyze block dependencies
  const dagCmd = program
    .command('dag')
    .description('Analyze block dependencies and variable flow')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Subcommands:')}
  show        Show the dependency graph between blocks
  vars        List variables defined and used by each block
  downstream  Show blocks that need re-run if a block changes

${c.bold('Output Formats:')}
  --json      Output as JSON for scripting
  --dot       Output as DOT format for Graphviz visualization

${c.bold('Examples:')}
  ${c.dim('# Show the dependency graph')}
  $ deepnote dag show my-project.deepnote

  ${c.dim('# List variables for each block')}
  $ deepnote dag vars my-project.deepnote

  ${c.dim('# Show what needs re-run if a block changes')}
  $ deepnote dag downstream my-project.deepnote --block "Load Data"

  ${c.dim('# Generate Graphviz visualization')}
  $ deepnote dag show my-project.deepnote --dot | dot -Tpng -o deps.png

  ${c.dim('# Analyze only a specific notebook')}
  $ deepnote dag show my-project.deepnote --notebook "Analysis"
`
    })

  dagCmd
    .command('show')
    .description('Show the dependency graph between blocks')
    .argument('<path>', 'Path to a .deepnote file')
    .option('--json', 'Output in JSON format for scripting')
    .option('--dot', 'Output in DOT format for Graphviz')
    .option('--notebook <name>', 'Analyze only a specific notebook')
    .option('--python <path>', 'Path to Python interpreter')
    .action(createDagShowAction(program))

  dagCmd
    .command('vars')
    .description('List variables defined and used by each block')
    .argument('<path>', 'Path to a .deepnote file')
    .option('--json', 'Output in JSON format for scripting')
    .option('--notebook <name>', 'Analyze only a specific notebook')
    .option('--python <path>', 'Path to Python interpreter')
    .action(createDagVarsAction(program))

  dagCmd
    .command('downstream')
    .description('Show blocks that need re-run if a block changes')
    .argument('<path>', 'Path to a .deepnote file')
    .requiredOption('-b, --block <id>', 'Block ID or label to analyze')
    .option('--json', 'Output in JSON format for scripting')
    .option('--notebook <name>', 'Analyze only a specific notebook')
    .option('--python <path>', 'Path to Python interpreter')
    .action(createDagDownstreamAction(program))

  // Stats command - show project statistics
  program
    .command('stats')
    .description('Show statistics about a .deepnote file')
    .argument('<path>', 'Path to a .deepnote file')
    .option('--json', 'Output in JSON format for scripting')
    .option('--notebook <name>', 'Analyze only a specific notebook')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Output:')}
  Displays statistics about the project including:
  - Total notebooks, blocks, and lines of code
  - Block types breakdown with counts
  - Imported modules list
  - Per-notebook breakdown

${c.bold('Examples:')}
  ${c.dim('# Show project statistics')}
  $ deepnote stats my-project.deepnote

  ${c.dim('# Output as JSON for scripting')}
  $ deepnote stats my-project.deepnote --json

  ${c.dim('# Show stats for a specific notebook')}
  $ deepnote stats my-project.deepnote --notebook "Data Analysis"
`
    })
    .action(createStatsAction(program))

  // Lint command - check for issues
  program
    .command('lint')
    .description('Check a .deepnote file for issues')
    .argument('<path>', 'Path to a .deepnote file')
    .option('--json', 'Output in JSON format for scripting')
    .option('--notebook <name>', 'Lint only a specific notebook')
    .option('--python <path>', 'Path to Python interpreter')
    .addHelpText('after', () => {
      const c = getChalk()
      return `
${c.bold('Checks:')}
  ${c.underline('Variables')}
  - undefined-variable: Variables used but never defined
  - circular-dependency: Blocks with circular dependencies
  - unused-variable: Variables defined but never used
  - shadowed-variable: Variables that shadow previous definitions
  - parse-error: Blocks that failed to parse

  ${c.underline('Integrations')}
  - missing-integration: SQL blocks using integrations that are not configured

  ${c.underline('Inputs')}
  - missing-input: Input blocks without default values

${c.bold('Exit Codes:')}
  0  No errors found (warnings may be present)
  1  One or more errors found
  2  Invalid usage (bad arguments, file not found)

${c.bold('Examples:')}
  ${c.dim('# Lint a .deepnote file')}
  $ deepnote lint my-project.deepnote

  ${c.dim('# Output as JSON for CI/CD')}
  $ deepnote lint my-project.deepnote --json

  ${c.dim('# Lint only a specific notebook')}
  $ deepnote lint my-project.deepnote --notebook "Analysis"

  ${c.dim('# Use in CI pipeline')}
  $ deepnote lint my-project.deepnote || exit 1
`
    })
    .action(createLintAction(program))

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
