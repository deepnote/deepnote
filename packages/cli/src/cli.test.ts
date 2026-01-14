import { describe, expect, it } from 'vitest'
import { createProgram, run } from './cli'

describe('CLI', () => {
  describe('createProgram', () => {
    it('creates a program with correct name', () => {
      const program = createProgram()
      expect(program.name()).toBe('deepnote')
    })

    it('has version set', () => {
      const program = createProgram()
      expect(program.version()).toBe('0.1.0')
    })

    it('has expected commands registered', () => {
      const program = createProgram()
      const commandNames = program.commands.map(cmd => cmd.name())

      expect(commandNames).toContain('run')
    })
  })

  describe('commands', () => {
    it('run command has expected options', () => {
      const program = createProgram()
      const runCmd = program.commands.find(cmd => cmd.name() === 'run')

      expect(runCmd).toBeDefined()

      const optionNames = runCmd?.options.map(opt => opt.long) ?? []
      expect(optionNames).toContain('--cloud')
    })
  })

  describe('run', () => {
    it('is exported and callable', () => {
      expect(typeof run).toBe('function')
    })
  })
})
