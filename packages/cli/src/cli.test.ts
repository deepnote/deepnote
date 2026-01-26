import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram, run } from './cli'
import { resetOutputConfig } from './output'
import { version } from './version'

describe('CLI', () => {
  beforeEach(() => {
    resetOutputConfig()
  })

  afterEach(() => {
    resetOutputConfig()
  })

  describe('createProgram', () => {
    it('creates a program with correct name', () => {
      const program = createProgram()
      expect(program.name()).toBe('deepnote')
    })

    it('has version set', () => {
      const program = createProgram()
      expect(program.version()).toBe(version)
    })

    it('has expected commands registered', () => {
      const program = createProgram()
      const commandNames = program.commands.map(cmd => cmd.name())

      expect(commandNames).toContain('inspect')
      expect(commandNames).toContain('run')
      expect(commandNames).toContain('validate')
      expect(commandNames).toContain('completion')
    })
  })

  describe('commands', () => {
    it('inspect command is properly configured', () => {
      const program = createProgram()
      const inspectCmd = program.commands.find(cmd => cmd.name() === 'inspect')

      expect(inspectCmd).toBeDefined()
      expect(inspectCmd?.description()).toBe('Inspect and display metadata from a .deepnote file')

      const optionFlags = inspectCmd?.options.map(o => o.flags)
      expect(optionFlags).toContain('-o, --output <format>')
    })

    it('run command is properly configured', () => {
      const program = createProgram()
      const runCmd = program.commands.find(cmd => cmd.name() === 'run')

      expect(runCmd).toBeDefined()
      expect(runCmd?.description()).toBe('Run a .deepnote file')

      const optionFlags = runCmd?.options.map(o => o.flags)
      expect(optionFlags).toContain('--python <path>')
      expect(optionFlags).toContain('--cwd <path>')
      expect(optionFlags).toContain('--notebook <name>')
      expect(optionFlags).toContain('--block <id>')
      expect(optionFlags).toContain('-o, --output <format>')
    })

    it('validate command is properly configured', () => {
      const program = createProgram()
      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate')

      expect(validateCmd).toBeDefined()
      expect(validateCmd?.description()).toBe('Validate a .deepnote file against the schema')

      const optionFlags = validateCmd?.options.map(o => o.flags)
      expect(optionFlags).toContain('-o, --output <format>')
    })

    it('completion command is properly configured', () => {
      const program = createProgram()
      const completionCmd = program.commands.find(cmd => cmd.name() === 'completion')

      expect(completionCmd).toBeDefined()
      expect(completionCmd?.description()).toBe('Generate shell completion scripts')
    })
  })

  describe('global options', () => {
    it('has --no-color option', () => {
      const program = createProgram()
      const options = program.options.map(o => o.flags)
      expect(options).toContain('--no-color')
    })

    it('has --debug option', () => {
      const program = createProgram()
      const options = program.options.map(o => o.flags)
      expect(options).toContain('--debug')
    })

    it('has --quiet option', () => {
      const program = createProgram()
      const options = program.options.map(o => o.flags)
      expect(options).toContain('-q, --quiet')
    })
  })

  describe('completion command', () => {
    it('generates bash completion script', async () => {
      const program = createProgram()
      program.exitOverride() // Prevent process.exit
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await program.parseAsync(['completion', 'bash'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalled()
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('_deepnote_completions()')
      expect(output).toContain('COMPREPLY')
      consoleSpy.mockRestore()
    })

    it('generates zsh completion script', async () => {
      const program = createProgram()
      program.exitOverride()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await program.parseAsync(['completion', 'zsh'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalled()
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('#compdef deepnote')
      expect(output).toContain('_deepnote()')
      consoleSpy.mockRestore()
    })

    it('generates fish completion script', async () => {
      const program = createProgram()
      program.exitOverride()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await program.parseAsync(['completion', 'fish'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalled()
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('complete -c deepnote')
      consoleSpy.mockRestore()
    })

    it('errors for unsupported shell', async () => {
      const program = createProgram()
      program.exitOverride()

      await expect(program.parseAsync(['completion', 'powershell'], { from: 'user' })).rejects.toThrow(
        'Unsupported shell'
      )
    })
  })

  describe('run', () => {
    it('is exported and callable', () => {
      expect(typeof run).toBe('function')
    })

    it('calls createProgram and parse', () => {
      const originalArgv = process.argv
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        process.argv = ['node', 'deepnote', '--version']
        // run() will call process.exit when displaying version
        expect(() => run()).toThrow('process.exit called')
        // Verify process.exit was called with 0 (success)
        expect(exitSpy).toHaveBeenCalledWith(0)
      } finally {
        process.argv = originalArgv
        exitSpy.mockRestore()
      }
    })
  })

  describe('help text', () => {
    it('completion command shows installation help', () => {
      const program = createProgram()
      const completionCmd = program.commands.find(cmd => cmd.name() === 'completion')

      // The helpInformation includes the afterHelp callback output
      const helpInfo = completionCmd?.helpInformation() ?? ''

      expect(helpInfo).toContain('bash')
      expect(helpInfo).toContain('zsh')
      expect(helpInfo).toContain('fish')
    })
  })

  describe('output format option', () => {
    it('errors when invalid output format is used with inspect', async () => {
      const program = createProgram()
      program.exitOverride()

      await expect(program.parseAsync(['inspect', 'test.deepnote', '-o', 'invalid'], { from: 'user' })).rejects.toThrow(
        'Invalid output format'
      )
    })

    it('errors when invalid output format is used with run', async () => {
      const program = createProgram()
      program.exitOverride()

      await expect(program.parseAsync(['run', 'test.deepnote', '-o', 'yaml'], { from: 'user' })).rejects.toThrow(
        'Invalid output format'
      )
    })

    it('errors when invalid output format is used with validate', async () => {
      const program = createProgram()
      program.exitOverride()

      // Validate only supports json
      await expect(program.parseAsync(['validate', 'test.deepnote', '-o', 'toon'], { from: 'user' })).rejects.toThrow(
        'Invalid output format'
      )
    })
  })
})
