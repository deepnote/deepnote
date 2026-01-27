import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createDagDownstreamAction, createDagShowAction, createDagVarsAction } from './dag'

// Test file paths relative to project root (tests are run from root)
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')
const BLOCKS_FILE = join('examples', '2_blocks.deepnote')
const HOUSING_FILE = join('examples', 'housing_price_prediction.deepnote')

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('dag command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('dag show', () => {
    it('shows dependency graph for file with dependencies', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Dependency Graph')
    })

    it('handles files with no dependencies', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('No dependencies')
    })

    it('outputs JSON when -o json flag is set', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes).toBeDefined()
      expect(result.edges).toBeDefined()
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(Array.isArray(result.edges)).toBe(true)
    })

    it('outputs DOT format when -o dot flag is set', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { output: 'dot' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('digraph dependencies')
      expect(output).toContain('rankdir=TB')
      expect(output).toContain('->')
    })

    it('filters by notebook when --notebook is set', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), BLOCKS_FILE)

      // BLOCKS_FILE has notebooks "1. Text blocks" and "2. Input blocks"
      await action(filePath, { notebook: '1. Text blocks', output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      // All nodes should be from the filtered notebook
      for (const node of result.nodes) {
        expect(node.notebook).toBe('1. Text blocks')
      }
    })

    it('includes node metadata in JSON output', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes[0]).toHaveProperty('id')
      expect(result.nodes[0]).toHaveProperty('label')
      expect(result.nodes[0]).toHaveProperty('type')
      expect(result.nodes[0]).toHaveProperty('notebook')
      expect(result.nodes[0]).toHaveProperty('inputVariables')
      expect(result.nodes[0]).toHaveProperty('outputVariables')
    })

    it('includes edge metadata in JSON output', async () => {
      const action = createDagShowAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.edges.length).toBeGreaterThan(0)
      expect(result.edges[0]).toHaveProperty('from')
      expect(result.edges[0]).toHaveProperty('to')
      expect(result.edges[0]).toHaveProperty('variables')
    })
  })

  describe('dag vars', () => {
    it('lists variables for each block', async () => {
      const action = createDagVarsAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Variables by Block')
      expect(output).toContain('Defines:')
    })

    it('outputs JSON when -o json flag is set', async () => {
      const action = createDagVarsAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.blocks).toBeDefined()
      expect(Array.isArray(result.blocks)).toBe(true)
      expect(result.blocks[0]).toHaveProperty('defines')
      expect(result.blocks[0]).toHaveProperty('uses')
    })

    it('shows blocks with no variables', async () => {
      const action = createDagVarsAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Variables by Block')
    })

    it('shows uses for blocks that consume variables', async () => {
      const action = createDagVarsAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Uses:')
    })
  })

  describe('dag downstream', () => {
    // Block IDs from housing_price_prediction.deepnote:
    // - 87cd42344c68449a9f48384507bd155f: defines rng - has downstream blocks using it
    // - 37e66ec28ab74b84b8bb703b29e2509a: defines n - has downstream blocks using it
    const RNG_BLOCK_ID = '87cd42344c68449a9f48384507bd155f'
    const N_BLOCK_ID = '37e66ec28ab74b84b8bb703b29e2509a'
    // Block ID from hello_world.deepnote (print only, no downstream)
    const HELLO_WORLD_BLOCK_ID = '15bc86a3d6684d3aa0eaad3b0c42a1eb'

    it('shows downstream blocks for a given block', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { block: RNG_BLOCK_ID })

      const output = getOutput(consoleSpy)
      expect(output).toContain('Downstream Impact')
    })

    it('outputs JSON when -o json flag is set', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { block: RNG_BLOCK_ID, output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.source).toBeDefined()
      expect(result.downstream).toBeDefined()
      expect(result.count).toBeDefined()
    })

    it('reports error for non-existent block', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action(filePath, { block: 'non-existent', output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')

      exitSpy.mockRestore()
    })

    it('shows no downstream blocks when block has no dependents', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HELLO_WORLD_FILE)

      // hello_world.deepnote has a single block with just print(), nothing depends on it
      await action(filePath, { block: HELLO_WORLD_BLOCK_ID })

      const output = getOutput(consoleSpy)
      expect(output).toContain('No downstream blocks')
    })

    it('includes downstream count in JSON output', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      await action(filePath, { block: RNG_BLOCK_ID, output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.count).toBeGreaterThanOrEqual(0)
      expect(result.source.id).toBe(RNG_BLOCK_ID)
    })

    it('lists blocks that will re-run', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = resolve(process.cwd(), HOUSING_FILE)

      // Block n=300 defines 'n' which is used by downstream blocks
      await action(filePath, { block: N_BLOCK_ID })

      const output = getOutput(consoleSpy)
      expect(output).toContain('will need to re-run')
    })
  })

  describe('error handling', () => {
    it('reports error when file not found', async () => {
      const action = createDagShowAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', { output: 'json' })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()

      exitSpy.mockRestore()
    })
  })

  describe('path resolution', () => {
    it('accepts relative paths', async () => {
      const action = createDagShowAction(program)

      await action(HOUSING_FILE, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes).toBeDefined()
    })

    it('accepts absolute paths', async () => {
      const action = createDagShowAction(program)
      const absolutePath = resolve(process.cwd(), HOUSING_FILE)

      await action(absolutePath, { output: 'json' })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes).toBeDefined()
    })
  })
})
