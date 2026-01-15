import { resolve } from 'node:path'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createInspectAction } from './inspect'

describe('inspect command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('createInspectAction', () => {
    it('returns a function', () => {
      const action = createInspectAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('inspecting valid .deepnote files', () => {
    it('inspects hello world example without errors', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), '../../examples/1_hello_world.deepnote')

      await action(filePath)

      expect(consoleSpy).toHaveBeenCalled()

      const output = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(output).toContain('Path:')
      expect(output).toContain('Name:')
      expect(output).toContain('Project ID:')
      expect(output).toContain('Version:')
      expect(output).toContain('Created:')
      expect(output).toContain('Notebooks count:')
      expect(output).toContain('Blocks:')
    })

    it('displays correct project metadata', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), '../../examples/1_hello_world.deepnote')

      await action(filePath)

      const output = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(output).toContain('Hello world')
      expect(output).toContain('18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('1.0.0')
    })

    it('displays notebook information', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), '../../examples/1_hello_world.deepnote')

      await action(filePath)

      const output = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(output).toContain('Notebooks:')
      expect(output).toContain('1. Hello World - example')
      expect(output).toContain('1 blocks')
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createInspectAction(program)

      await action('../../examples/1_hello_world.deepnote')

      expect(consoleSpy).toHaveBeenCalled()
      const output = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(output).toContain('Hello world')
    })

    it('accepts absolute paths', async () => {
      const action = createInspectAction(program)
      const absolutePath = resolve(process.cwd(), '../../examples/1_hello_world.deepnote')

      await action(absolutePath)

      expect(consoleSpy).toHaveBeenCalled()
      const output = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(output).toContain('Hello world')
    })
  })
})
