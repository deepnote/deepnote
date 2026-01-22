import type { Command } from 'commander'

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
        stats)
            # Complete .deepnote files
            COMPREPLY=( $(compgen -f -X '!*.deepnote' -- "\${cur}") $(compgen -d -- "\${cur}") )
            return 0
            ;;
        lint)
            # Complete .deepnote files
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

/** Command descriptions for zsh completions */
const zshCommandDescriptions: Record<string, string> = {
  inspect: 'Inspect and display metadata from a .deepnote file',
  run: 'Run a .deepnote file',
  dag: 'Analyze block dependencies and variable flow',
  stats: 'Show statistics about a .deepnote file',
  lint: 'Check a .deepnote file for issues',
  completion: 'Generate shell completion scripts',
}

function generateZshCompletion(commands: string[]): string {
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
                stats)
                    _arguments \\
                        '--json[Output in JSON format]' \\
                        '--notebook[Analyze only a specific notebook]:notebook name:' \\
                        '*:deepnote file:_files -g "*.deepnote"'
                    ;;
                lint)
                    _arguments \\
                        '--json[Output in JSON format]' \\
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
  inspect: 'Inspect and display metadata from a .deepnote file',
  run: 'Run a .deepnote file',
  dag: 'Analyze block dependencies and variable flow',
  stats: 'Show statistics about a .deepnote file',
  lint: 'Check a .deepnote file for issues',
  completion: 'Generate shell completion scripts',
}

function generateFishCompletion(commands: string[]): string {
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

# stats subcommand
complete -c deepnote -n '__fish_seen_subcommand_from stats' -l json -d 'Output in JSON format'
complete -c deepnote -n '__fish_seen_subcommand_from stats' -l notebook -d 'Analyze only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from stats' -F -a '*.deepnote'

# lint subcommand
complete -c deepnote -n '__fish_seen_subcommand_from lint' -l json -d 'Output in JSON format'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -l notebook -d 'Lint only a specific notebook'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -l python -d 'Path to Python interpreter'
complete -c deepnote -n '__fish_seen_subcommand_from lint' -F -a '*.deepnote'

# completion subcommand
complete -c deepnote -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# help subcommand
complete -c deepnote -n '__fish_seen_subcommand_from help' -a '${helpCommands}'
`
}
