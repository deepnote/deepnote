import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createInspectAction } from './inspect'

// Test file path relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('inspect command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
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
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath)

      expect(consoleSpy).toHaveBeenCalled()

      const output = getOutput(consoleSpy)
      expect(output).toContain(`Path: ${filePath}`)
      expect(output).toContain('Name: Hello world')
      expect(output).toContain('Project ID: 18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('Version: 1.0.0')
      expect(output).toContain('Created: 2025-11-04T00:31:57.544Z')
      expect(output).toContain('Notebooks count: 1')
      expect(output).toContain('Blocks: 1')
    })

    it('displays correct project metadata', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
      expect(output).toContain('18aaab73-3599-4bb5-b2ab-c05ac09f597d')
      expect(output).toContain('1.0.0')
    })

    it('displays notebook information', async () => {
      const action = createInspectAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Notebooks:')
      expect(output).toContain('1. Hello World - example')
      expect(output).toContain('1 blocks')
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createInspectAction(program)

      await action(HELLO_WORLD_FILE)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })

    it('accepts absolute paths', async () => {
      const action = createInspectAction(program)
      const absolutePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(absolutePath)

      expect(consoleSpy).toHaveBeenCalled()
      const output = getOutput(consoleSpy)
      expect(output).toContain('Hello world')
    })
  })
})
