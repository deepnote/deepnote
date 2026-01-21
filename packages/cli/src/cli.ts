import chalk from 'chalk'
import { Command } from 'commander'
import { createDagDownstreamAction, createDagShowAction, createDagVarsAction } from './commands/dag'
import { createInspectAction } from './commands/inspect'
import { createRunAction } from './commands/run'
import { ExitCode } from './exit-codes'
import { getChalk, getOutputConfig, setOutputConfig, shouldDisableColor } from './output'
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
    .option('--python <path>', 'Path to Python virtual environment directory', 'python')
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

  ${c.dim('# Run with a specific Python interpreter')}
  $ deepnote run my-project.deepnote --python python3.11

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
        console.log(completionScript)
      } else {
        program.error(`Unsupported shell: ${shell}. Supported shells: bash, zsh, fish`, {
          exitCode: ExitCode.InvalidUsage,
        })
      }
    })
}

/**
 * Generate shell completion script for the given shell.
 */
function generateCompletionScript(shell: string, program: Command): string | null {
  const commands = program.commands.map(cmd => cmd.name()).filter(name => name !== 'help')

  switch (shell.toLowerCase()) {
    case 'bash':
      return generateBashCompletion(commands)
    case 'zsh':
      return generateZshCompletion()
    case 'fish':
      return generateFishCompletion()
    default:
      return null
  }
}

function generateBashCompletion(commands: string[]): string {
  return `# Bash completion for deepnote CLI
# Add this to ~/.bashrc or ~/.bash_profile

_deepnote_completions() {
    local cur prev commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="${commands.join(' ')} help"

    case "\${prev}" in
        deepnote)
            COMPREPLY=( $(compgen -W "\${commands} --help --version --no-color --debug --quiet" -- "\${cur}") )
            return 0
            ;;
        inspect)
            # Complete .deepnote files
            COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            return 0
            ;;
        run)
            # Complete .deepnote files
            COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            return 0
            ;;
        dag)
            COMPREPLY=( $(compgen -W "show vars downstream" -- "\${cur}") )
            return 0
            ;;
        show|vars|downstream)
            # Complete .deepnote files for dag subcommands
            COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            return 0
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
            return 0
            ;;
        help)
            COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
            return 0
            ;;
    esac

    # Default to file completion
    COMPREPLY=( $(compgen -f -- "\${cur}") )
}

complete -F _deepnote_completions deepnote
`
}

function generateZshCompletion(): string {
  return `#compdef deepnote
# Zsh completion for deepnote CLI
# Add this to ~/.zshrc

_deepnote() {
    local -a commands
    commands=(
        'inspect:Inspect and display metadata from a .deepnote file'
        'run:Run a .deepnote file'
        'dag:Analyze block dependencies and variable flow'
        'completion:Generate shell completion scripts'
        'help:Display help for command'
    )

    local -a global_options
    global_options=(
        '--help[Display help information]'
        '-h[Display help information]'
        '--version[Display the CLI version]'
        '-v[Display the CLI version]'
        '--no-color[Disable colored output]'
        '--debug[Show debug information]'
        '--quiet[Suppress non-essential output]'
        '-q[Suppress non-essential output]'
    )

    _arguments -C \\
        $global_options \\
        '1: :->command' \\
        '*:: :->args'

    case $state in
        command)
            _describe -t commands 'deepnote commands' commands
            ;;
        args)
            case $words[1] in
                inspect)
                    _arguments \\
                        '--json[Output in JSON format]' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                run)
                    _arguments \\
                        '--python[Path to Python interpreter]:python path:_files' \\
                        '--cwd[Working directory for execution]:cwd path:_files -/' \\
                        '--notebook[Run only the specified notebook]:notebook name:' \\
                        '--block[Run only the specified block]:block id:' \\
                        '--json[Output results in JSON format]' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                dag)
                    local -a subcommands
                    subcommands=(
                        'show:Show the dependency graph'
                        'vars:List variables defined and used by each block'
                        'downstream:Show blocks that need re-run if a block changes'
                    )
                    _arguments \\
                        '1: :->subcommand' \\
                        '*:: :->args'
                    case $state in
                        subcommand)
                            _describe -t subcommands 'dag subcommands' subcommands
                            ;;
                        args)
                            _arguments \\
                                '--json[Output in JSON format]' \\
                                '--dot[Output in DOT format for Graphviz]' \\
                                '--notebook[Analyze only a specific notebook]:notebook name:' \\
                                '--python[Path to Python interpreter]:python path:_files' \\
                                '--block[Block ID or label to analyze]:block:' \\
                                '*:deepnote file:_files -g "*.deepnote"'
                            ;;
                    esac
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
                help)
                    _describe -t commands 'commands' commands
                    ;;
            esac
            ;;
    esac
}

_deepnote
`
}

function generateFishCompletion(): string {
  return `# Fish completion for deepnote CLI
# Save to ~/.config/fish/completions/deepnote.fish

# Disable file completions by default
complete -c deepnote -f

# Global options
complete -c deepnote -l help -s h -d 'Display help information'
complete -c deepnote -l version -s v -d 'Display the CLI version'
complete -c deepnote -l no-color -d 'Disable colored output'
complete -c deepnote -l debug -d 'Show debug information'
complete -c deepnote -l quiet -s q -d 'Suppress non-essential output'

# Commands
complete -c deepnote -n __fish_use_subcommand -a inspect -d 'Inspect and display metadata from a .deepnote file'
complete -c deepnote -n __fish_use_subcommand -a run -d 'Run a .deepnote file'
complete -c deepnote -n __fish_use_subcommand -a dag -d 'Analyze block dependencies and variable flow'
complete -c deepnote -n __fish_use_subcommand -a completion -d 'Generate shell completion scripts'
complete -c deepnote -n __fish_use_subcommand -a help -d 'Display help for command'

# inspect subcommand
complete -c deepnote -n '__fish_seen_subcommand_from inspect' -l json -d 'Output in JSON format'
complete -c deepnote -n '__fish_seen_subcommand_from inspect' -F -a '*.deepnote'

# run subcommand
complete -c deepnote -n '__fish_seen_subcommand_from run' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l cwd -d 'Working directory for execution'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l notebook -d 'Run only the specified notebook'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l block -d 'Run only the specified block'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l json -d 'Output results in JSON format'
complete -c deepnote -n '__fish_seen_subcommand_from run' -F -a '*.deepnote'

# dag subcommand
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a show -d 'Show the dependency graph'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a vars -d 'List variables defined and used by each block'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a downstream -d 'Show blocks that need re-run if a block changes'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l json -d 'Output in JSON format'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l dot -d 'Output in DOT format for Graphviz'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l notebook -d 'Analyze only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l block -s b -d 'Block ID or label to analyze'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -F -a '*.deepnote'

# completion subcommand
complete -c deepnote -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# help subcommand
complete -c deepnote -n '__fish_seen_subcommand_from help' -a 'inspect run dag completion'
`
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
