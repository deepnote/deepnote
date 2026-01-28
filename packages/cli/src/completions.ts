import type { Command } from 'commander'
import { FILTERABLE_BLOCK_TYPES } from './commands/cat'

/**
 * Generate shell completion script for the given shell.
 */
export function generateCompletionScript(shell: string, program: Command): string | null {
  const commands = program.commands.map(cmd => cmd.name()).filter(name => name !== 'help')

  switch (shell.toLowerCase()) {
    case 'bash':
      return generateBashCompletion(commands)
    case 'zsh':
      return generateZshCompletion(commands)
    case 'fish':
      return generateFishCompletion(commands)
    default:
      return null
  }
}

function generateBashCompletion(commands: string[]): string {
  const blockTypes = FILTERABLE_BLOCK_TYPES.join(' ')

  return `# Bash completion for deepnote CLI
# Add this to ~/.bashrc or ~/.bash_profile

_deepnote_completions() {
    local cur prev commands subcommand word
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    commands="${commands.join(' ')} help"

    # Find the subcommand by scanning COMP_WORDS
    subcommand=""
    for word in "\${COMP_WORDS[@]:1}"; do
        case "\${word}" in
            inspect|cat|run|open|validate|convert|completion|help)
                subcommand="\${word}"
                break
                ;;
        esac
    done

    # Handle -o/--output option completion based on the subcommand
    if [[ "\${prev}" == "-o" || "\${prev}" == "--output" ]]; then
        case "\${subcommand}" in
            inspect|run)
                COMPREPLY=( $(compgen -W "json toon" -- "\${cur}") )
                return 0
                ;;
            cat|open|validate)
                COMPREPLY=( $(compgen -W "json" -- "\${cur}") )
                return 0
                ;;
        esac
    fi

    # Handle --type option completion for cat command
    if [[ "\${prev}" == "--type" ]]; then
        if [[ "\${subcommand}" == "cat" ]]; then
            COMPREPLY=( $(compgen -W "${blockTypes}" -- "\${cur}") )
            return 0
        fi
    fi

    # Handle -f/--format option completion for convert command
    if [[ "\${prev}" == "-f" || "\${prev}" == "--format" ]]; then
        if [[ "\${subcommand}" == "convert" ]]; then
            COMPREPLY=( $(compgen -W "jupyter percent quarto marimo" -- "\${cur}") )
            return 0
        fi
    fi

    case "\${prev}" in
        deepnote)
            COMPREPLY=( $(compgen -W "\${commands} --help --version --no-color --debug --quiet" -- "\${cur}") )
            return 0
            ;;
        inspect)
            # Complete -o/--output options and .deepnote files
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        cat)
            # Complete cat options and .deepnote files
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output --notebook --type --tree" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        run)
            # Complete .deepnote files and flags
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "--python --cwd --notebook --block --input -i --list-inputs -o --output --dry-run --top --profile" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        open)
            # Complete .deepnote files and flags
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "--domain -o --output" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        validate)
            # Complete -o/--output options and .deepnote files
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        convert)
            # Complete convert options and supported file types
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output -n --name -f --format" -- "\${cur}") )
            elif [[ "\${prev}" == "-o" || "\${prev}" == "--output" || "\${prev}" == "-n" || "\${prev}" == "--name" ]]; then
                COMPREPLY=( $(compgen -f -- "\${cur}") $(compgen -d -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.@(deepnote|ipynb|qmd|py)' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        dag)
            COMPREPLY=( $(compgen -W "show vars downstream" -- "\${cur}") )
            return 0
            ;;
        show|vars|downstream)
            # Complete .deepnote files and flags for dag subcommands
            if [[ "\${cur}" == -* ]]; then
                if [[ "\${prev}" == "downstream" ]]; then
                    COMPREPLY=( $(compgen -W "-o --output --notebook --python -b --block" -- "\${cur}") )
                else
                    COMPREPLY=( $(compgen -W "-o --output --notebook --python" -- "\${cur}") )
                fi
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        stats)
            # Complete .deepnote files and flags
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output --notebook" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
            return 0
            ;;
        lint)
            # Complete .deepnote files and flags
            if [[ "\${cur}" == -* ]]; then
                COMPREPLY=( $(compgen -W "-o --output --notebook --python" -- "\${cur}") )
            else
                COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            fi
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

/** Command descriptions for zsh completions */
const zshCommandDescriptions: Record<string, string> = {
  cat: 'Display block contents from a .deepnote file',
  convert: 'Convert between notebook formats',
  inspect: 'Inspect and display metadata from a .deepnote file',
  run: 'Run a .deepnote file',
  open: 'Open a .deepnote file in Deepnote',
  validate: 'Validate a .deepnote file against the schema',
  dag: 'Analyze block dependencies and variable flow',
  stats: 'Show statistics about a .deepnote file',
  lint: 'Check a .deepnote file for issues',
  completion: 'Generate shell completion scripts',
}

function generateZshCompletion(commands: string[]): string {
  const blockTypes = FILTERABLE_BLOCK_TYPES.join(' ')

  // Build the commands array for zsh
  const commandEntries = commands
    .map(cmd => `        '${cmd}:${zshCommandDescriptions[cmd] ?? cmd}'`)
    .concat("        'help:Display help for command'")
    .join('\n')

  // Build the help subcommand completions
  const helpCommands = commands.join(' ')

  return `#compdef deepnote
# Zsh completion for deepnote CLI
# Add this to ~/.zshrc

_deepnote() {
    local -a commands
    commands=(
${commandEntries}
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
                        '(-o --output)'{-o,--output}'[Output format]:format:(json toon)' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                cat)
                    _arguments \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json)' \\
                        '--notebook[Show only blocks from specified notebook]:notebook name:' \\
                        '--type[Filter blocks by type]:type:(${blockTypes})' \\
                        '--tree[Show structure only without block content]' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                run)
                    _arguments \\
                        '--python[Path to Python interpreter]:python path:_files' \\
                        '--cwd[Working directory for execution]:cwd path:_files -/' \\
                        '--notebook[Run only the specified notebook]:notebook name:' \\
                        '--block[Run only the specified block]:block id:' \\
                        '*'{-i,--input}'[Set input variable value]:key=value:' \\
                        '--list-inputs[List all input variables without running]' \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json toon)' \\
                        '--dry-run[Show what would be executed without running]' \\
                        '--top[Display resource usage during execution]' \\
                        '--profile[Show per-block timing and memory usage]' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                open)
                    _arguments \\
                        '--domain[Deepnote domain]:domain:' \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json)' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                validate)
                    _arguments \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json)' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                convert)
                    _arguments \\
                        '(-o --output)'{-o,--output}'[Output file or directory]:output path:_files' \\
                        '(-n --name)'{-n,--name}'[Project name for conversion]:project name:' \\
                        '(-f --format)'{-f,--format}'[Output format (jupyter, percent, quarto, marimo)]:format:(jupyter percent quarto marimo)' \\
                        '*:input file:_files -g "*.{deepnote,ipynb,qmd,py}"'
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
                            case $words[1] in
                                downstream)
                                    _arguments \\
                                        '(-o --output)'{-o,--output}'[Output format]:format:(json dot)' \\
                                        '--notebook[Analyze only a specific notebook]:notebook name:' \\
                                        '--python[Path to Python interpreter]:python path:_files' \\
                                        '(-b --block)'{-b,--block}'[Block ID or label to analyze]:block:' \\
                                        '*:deepnote file:_files -g "*.deepnote"'
                                    ;;
                                *)
                                    _arguments \\
                                        '(-o --output)'{-o,--output}'[Output format]:format:(json dot)' \\
                                        '--notebook[Analyze only a specific notebook]:notebook name:' \\
                                        '--python[Path to Python interpreter]:python path:_files' \\
                                        '*:deepnote file:_files -g "*.deepnote"'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                stats)
                    _arguments \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json)' \\
                        '--notebook[Analyze only a specific notebook]:notebook name:' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                lint)
                    _arguments \\
                        '(-o --output)'{-o,--output}'[Output format]:format:(json)' \\
                        '--notebook[Lint only a specific notebook]:notebook name:' \\
                        '--python[Path to Python interpreter]:python path:_files' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
                help)
                    _arguments "1:command:(${helpCommands})"
                    ;;
            esac
            ;;
    esac
}

_deepnote
`
}

/** Command descriptions for fish completions */
const fishCommandDescriptions: Record<string, string> = {
  cat: 'Display block contents from a .deepnote file',
  convert: 'Convert between notebook formats',
  inspect: 'Inspect and display metadata from a .deepnote file',
  run: 'Run a .deepnote file',
  open: 'Open a .deepnote file in Deepnote',
  validate: 'Validate a .deepnote file against the schema',
  dag: 'Analyze block dependencies and variable flow',
  stats: 'Show statistics about a .deepnote file',
  lint: 'Check a .deepnote file for issues',
  completion: 'Generate shell completion scripts',
}

function generateFishCompletion(commands: string[]): string {
  const blockTypes = FILTERABLE_BLOCK_TYPES.join(' ')

  // Build the command completions
  const commandCompletions = commands
    .map(cmd => `complete -c deepnote -n __fish_use_subcommand -a ${cmd} -d '${fishCommandDescriptions[cmd] ?? cmd}'`)
    .concat("complete -c deepnote -n __fish_use_subcommand -a help -d 'Display help for command'")
    .join('\n')

  // Build the help subcommand completions
  const helpCommands = commands.join(' ')

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
${commandCompletions}

# inspect subcommand
complete -c deepnote -n '__fish_seen_subcommand_from inspect' -s o -l output -d 'Output format' -xa 'json toon'
complete -c deepnote -n '__fish_seen_subcommand_from inspect' -F -a '*.deepnote'

# cat subcommand
complete -c deepnote -n '__fish_seen_subcommand_from cat' -s o -l output -d 'Output format' -xa 'json'
complete -c deepnote -n '__fish_seen_subcommand_from cat' -l notebook -d 'Show only blocks from specified notebook'
complete -c deepnote -n '__fish_seen_subcommand_from cat' -l type -d 'Filter blocks by type' -xa '${blockTypes}'
complete -c deepnote -n '__fish_seen_subcommand_from cat' -l tree -d 'Show structure only without block content'
complete -c deepnote -n '__fish_seen_subcommand_from cat' -F -a '*.deepnote'

# run subcommand
complete -c deepnote -n '__fish_seen_subcommand_from run' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l cwd -d 'Working directory for execution'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l notebook -d 'Run only the specified notebook'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l block -d 'Run only the specified block'
complete -c deepnote -n '__fish_seen_subcommand_from run' -s i -l input -d 'Set input variable value (can be repeated)'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l list-inputs -d 'List all input variables without running'
complete -c deepnote -n '__fish_seen_subcommand_from run' -s o -l output -d 'Output format' -xa 'json toon'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l dry-run -d 'Show what would be executed without running'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l top -d 'Display resource usage during execution'
complete -c deepnote -n '__fish_seen_subcommand_from run' -l profile -d 'Show per-block timing and memory usage'
complete -c deepnote -n '__fish_seen_subcommand_from run' -F -a '*.deepnote'

# open subcommand
complete -c deepnote -n '__fish_seen_subcommand_from open' -l domain -d 'Deepnote domain'
complete -c deepnote -n '__fish_seen_subcommand_from open' -s o -l output -d 'Output format' -xa 'json'
complete -c deepnote -n '__fish_seen_subcommand_from open' -F -a '*.deepnote'

# validate subcommand
complete -c deepnote -n '__fish_seen_subcommand_from validate' -s o -l output -d 'Output format' -xa 'json'
complete -c deepnote -n '__fish_seen_subcommand_from validate' -F -a '*.deepnote'

# convert subcommand
complete -c deepnote -n '__fish_seen_subcommand_from convert' -s o -l output -d 'Output file or directory'
complete -c deepnote -n '__fish_seen_subcommand_from convert' -s n -l name -d 'Project name for conversion'
complete -c deepnote -n '__fish_seen_subcommand_from convert' -s f -l format -d 'Output format' -xa 'jupyter percent quarto marimo'
complete -c deepnote -n '__fish_seen_subcommand_from convert' -F -a '*.deepnote' -a '*.ipynb' -a '*.qmd' -a '*.py'

# dag subcommand
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a show -d 'Show the dependency graph'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a vars -d 'List variables defined and used by each block'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -a downstream -d 'Show blocks that need re-run if a block changes'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -s o -l output -d 'Output format' -xa 'json dot'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l notebook -d 'Analyze only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from dag; and __fish_seen_subcommand_from downstream' -s b -l block -d 'Block ID or label to analyze'
complete -c deepnote -n '__fish_seen_subcommand_from dag' -F -a '*.deepnote'

# stats subcommand
complete -c deepnote -n '__fish_seen_subcommand_from stats' -s o -l output -d 'Output format' -xa 'json'
complete -c deepnote -n '__fish_seen_subcommand_from stats' -l notebook -d 'Analyze only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from stats' -F -a '*.deepnote'

# lint subcommand
complete -c deepnote -n '__fish_seen_subcommand_from lint' -s o -l output -d 'Output format' -xa 'json'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -l notebook -d 'Lint only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -F -a '*.deepnote'

# completion subcommand
complete -c deepnote -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# help subcommand
complete -c deepnote -n '__fish_seen_subcommand_from help' -a '${helpCommands}'
`
}
