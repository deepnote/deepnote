import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import * as outputModule from '../output'
import { createAnalyzeAction } from './analyze'

// Mock the output module
vi.mock('../output', async importOriginal => {
  const original = await importOriginal<typeof import('../output')>()
  return {
    ...original,
    output: vi.fn(),
    outputJson: vi.fn(),
    outputToon: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    getChalk: () => ({
      bold: Object.assign((s: string) => s, { cyan: (s: string) => s }),
      dim: (s: string) => s,
      green: (s: string) => s,
      yellow: (s: string) => s,
      red: (s: string) => s,
      cyan: (s: string) => s,
    }),
  }
})

describe('analyze command', () => {
  let program: Command
  let action: ReturnType<typeof createAnalyzeAction>
  let outputJsonSpy: MockInstance
  let outputToonSpy: MockInstance
  let outputSpy: MockInstance
  let processExitSpy: MockInstance

  beforeEach(() => {
    program = new Command()
    action = createAnalyzeAction(program)
    outputJsonSpy = vi.spyOn(outputModule, 'outputJson')
    outputToonSpy = vi.spyOn(outputModule, 'outputToon')
    outputSpy = vi.spyOn(outputModule, 'output')
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.clearAllMocks()
  })

  afterEach(() => {
    processExitSpy.mockRestore()
  })

  describe('analyzing valid .deepnote files', () => {
    it('outputs human-readable analysis by default', async () => {
      await action('examples/1_hello_world.deepnote', {})

      expect(outputSpy).toHaveBeenCalled()
      // Check that quality score is displayed
      expect(outputSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes('Quality Score'))).toBe(
        true
      )
    })

    it('outputs JSON when -o json option is used', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      expect(outputJsonSpy).toHaveBeenCalled()
      const result = outputJsonSpy.mock.calls[0][0]
      expect(result).toHaveProperty('path')
      expect(result).toHaveProperty('project')
      expect(result).toHaveProperty('quality')
      expect(result).toHaveProperty('structure')
      expect(result).toHaveProperty('dependencies')
      expect(result).toHaveProperty('suggestions')
    })

    it('outputs TOON when -o toon option is used', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'toon' })

      expect(outputToonSpy).toHaveBeenCalled()
      const result = outputToonSpy.mock.calls[0][0]
      expect(result).toHaveProperty('project')
      expect(result).toHaveProperty('quality')
    })

    it('includes project info in analysis', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.project.name).toBe('Hello world')
      expect(result.project.notebooks).toBe(1)
      expect(result.project.blocks).toBe(1)
    })

    it('includes quality score', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.quality.score).toBeGreaterThanOrEqual(0)
      expect(result.quality.score).toBeLessThanOrEqual(100)
      expect(typeof result.quality.errors).toBe('number')
      expect(typeof result.quality.warnings).toBe('number')
      expect(Array.isArray(result.quality.issues)).toBe(true)
    })

    it('includes structure information', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(Array.isArray(result.structure.entryPoints)).toBe(true)
      expect(Array.isArray(result.structure.exitPoints)).toBe(true)
      expect(typeof result.structure.longestChain).toBe('number')
    })

    it('includes dependency information', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(Array.isArray(result.dependencies.imports)).toBe(true)
      expect(result.dependencies.packageAliases).toBeDefined()
      expect(Array.isArray(result.dependencies.missingIntegrations)).toBe(true)
    })

    it('includes suggestions', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(Array.isArray(result.suggestions)).toBe(true)
    })
  })

  describe('analyzing project with multiple notebooks', () => {
    it('analyzes all notebooks by default', async () => {
      await action('examples/2_blocks.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.project.notebooks).toBe(2)
      expect(result.project.blocks).toBeGreaterThan(1)
    })

    it('filters to specific notebook with --notebook', async () => {
      await action('examples/2_blocks.deepnote', { output: 'json', notebook: '1. Text blocks' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.project.notebooks).toBe(1)
    })
  })

  describe('error handling', () => {
    it('outputs JSON error when file not found with -o json', async () => {
      await action('nonexistent.deepnote', { output: 'json' })

      expect(outputJsonSpy).toHaveBeenCalled()
      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(processExitSpy).toHaveBeenCalled()
    })

    it('outputs TOON error when file not found with -o toon', async () => {
      await action('nonexistent.deepnote', { output: 'toon' })

      expect(outputToonSpy).toHaveBeenCalled()
      const result = outputToonSpy.mock.calls[0][0]
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('quality scoring', () => {
    it('gives perfect score for clean project', async () => {
      await action('examples/1_hello_world.deepnote', { output: 'json' })

      const result = outputJsonSpy.mock.calls[0][0]
      expect(result.quality.score).toBe(100)
      expect(result.quality.errors).toBe(0)
      expect(result.quality.warnings).toBe(0)
    })
  })
})
