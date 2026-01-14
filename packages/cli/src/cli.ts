import chalk from 'chalk'
import { Command } from 'commander'
import { version } from './version'

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
    .showHelpAfterError(true)
    .configureOutput({
      // Write errors to stderr with chalk styling
      outputError: (str, write) => write(chalk.red(str)),
    })

  // Register placeholder commands (to be implemented in future phases)
  registerCommands(program)

  return program
}

/**
 * Registers all available commands on the program.
 * Commands are placeholders for now - full implementation will come in later phases.
 */
function registerCommands(program: Command): void {
  // Run command - for executing .deepnote projects
  program
    .command('run')
    .description('Run a Deepnote project locally or on Deepnote Cloud')
    .argument('[path]', 'Path to .deepnote file or project URL')
    .option('--cloud', 'Run on Deepnote Cloud instead of locally')
    .action(() => {
      process.exit(1)
    })
}

/**
 * Returns the welcome text displayed in help output.
 */
function getWelcomeText(): string {
  return `${chalk.bold.cyan('Deepnote CLI')} - Run Deepnote projects from the command line

${chalk.dim('Run .deepnote files locally or on Deepnote Cloud for data science workflows,')}
${chalk.dim('automation, CI/CD pipelines, and interactive development.')}

${chalk.dim('Documentation:')} ${chalk.underline('https://docs.deepnote.com/cli')}
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
