import { describe, expect, it } from 'vitest'
import { createProgram, run } from './cli'
import { version } from './version'

describe('CLI', () => {
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
    })
  })

  describe('commands', () => {
    it('inspect command is properly configured', () => {
      const program = createProgram()
      const inspectCmd = program.commands.find(cmd => cmd.name() === 'inspect')

      expect(inspectCmd).toBeDefined()
      expect(inspectCmd?.description()).toBe('Inspect and display metadata from a .deepnote file')
    })

    it('run command is properly configured', () => {
      const program = createProgram()
      const runCmd = program.commands.find(cmd => cmd.name() === 'run')

      expect(runCmd).toBeDefined()
      expect(runCmd?.description()).toBe('Run a .deepnote file')

      const optionFlags = runCmd?.options.map(o => o.flags)
      expect(optionFlags).toContain('--python <path>')
      expect(optionFlags).toContain('--notebook <name>')
      expect(optionFlags).toContain('--block <id>')
    })
  })

  describe('run', () => {
    it('is exported and callable', () => {
      expect(typeof run).toBe('function')
    })
  })
})
