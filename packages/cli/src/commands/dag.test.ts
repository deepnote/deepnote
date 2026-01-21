import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createDagDownstreamAction, createDagShowAction, createDagVarsAction } from './dag'

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(join(os.tmpdir(), 'deepnote-dag-test-'))
}

async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

// Simple deepnote file with dependencies
const DEEPNOTE_FILE_WITH_DEPS = `metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: nb-1
      name: Analysis
      blocks:
        - id: block-1
          type: code
          content: "x = 1\\ny = 2"
          blockGroup: bg-1
          sortingKey: a0
          metadata: {}
        - id: block-2
          type: code
          content: "z = x + y"
          blockGroup: bg-2
          sortingKey: a1
          metadata: {}
        - id: block-3
          type: code
          content: "result = z * 2"
          blockGroup: bg-3
          sortingKey: a2
          metadata: {}
version: "1.0.0"
`

const DEEPNOTE_FILE_NO_DEPS = `metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: nb-1
      name: Analysis
      blocks:
        - id: block-1
          type: code
          content: "print('hello')"
          blockGroup: bg-1
          sortingKey: a0
          metadata: {}
version: "1.0.0"
`

const DEEPNOTE_FILE_MULTI_NOTEBOOK = `metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: nb-1
      name: Analysis
      blocks:
        - id: block-1
          type: code
          content: "x = 1"
          blockGroup: bg-1
          sortingKey: a0
          metadata: {}
    - id: nb-2
      name: Processing
      blocks:
        - id: block-2
          type: code
          content: "y = 2"
          blockGroup: bg-2
          sortingKey: a0
          metadata: {}
version: "1.0.0"
`

describe('dag command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let tempDir: string

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    await cleanupTempDir(tempDir)
  })

  describe('dag show', () => {
    it('shows dependency graph for file with dependencies', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Dependency Graph')
    })

    it('handles files with no dependencies', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_NO_DEPS, 'utf-8')

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('No dependencies')
    })

    it('outputs JSON when --json flag is set', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes).toBeDefined()
      expect(result.edges).toBeDefined()
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(Array.isArray(result.edges)).toBe(true)
    })

    it('outputs DOT format when --dot flag is set', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { dot: true })

      const output = getOutput(consoleSpy)
      expect(output).toContain('digraph dependencies')
      expect(output).toContain('rankdir=TB')
      expect(output).toContain('->')
    })

    it('filters by notebook when --notebook is set', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_MULTI_NOTEBOOK, 'utf-8')

      await action(filePath, { notebook: 'Analysis', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].notebook).toBe('Analysis')
    })

    it('includes node metadata in JSON output', async () => {
      const action = createDagShowAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { json: true })

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
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { json: true })

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
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Variables by Block')
      expect(output).toContain('Defines:')
    })

    it('outputs JSON when --json flag is set', async () => {
      const action = createDagVarsAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.blocks).toBeDefined()
      expect(Array.isArray(result.blocks)).toBe(true)
      expect(result.blocks[0]).toHaveProperty('defines')
      expect(result.blocks[0]).toHaveProperty('uses')
    })

    it('shows blocks with no variables', async () => {
      const action = createDagVarsAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_NO_DEPS, 'utf-8')

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Variables by Block')
    })

    it('shows uses for blocks that consume variables', async () => {
      const action = createDagVarsAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, {})

      const output = getOutput(consoleSpy)
      expect(output).toContain('Uses:')
    })
  })

  describe('dag downstream', () => {
    it('shows downstream blocks for a given block', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { block: 'block-1' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('Downstream Impact')
    })

    it('outputs JSON when --json flag is set', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { block: 'block-1', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.source).toBeDefined()
      expect(result.downstream).toBeDefined()
      expect(result.count).toBeDefined()
    })

    it('reports error for non-existent block', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action(filePath, { block: 'non-existent', json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')

      exitSpy.mockRestore()
    })

    it('shows no downstream blocks when block has no dependents', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      // block-3 is the last block, nothing depends on it
      await action(filePath, { block: 'block-3' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('No downstream blocks')
    })

    it('includes downstream count in JSON output', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { block: 'block-1', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.count).toBeGreaterThanOrEqual(0)
      expect(result.source.id).toBe('block-1')
    })

    it('lists blocks that will re-run', async () => {
      const action = createDagDownstreamAction(program)
      const filePath = join(tempDir, 'test.deepnote')
      await fs.writeFile(filePath, DEEPNOTE_FILE_WITH_DEPS, 'utf-8')

      await action(filePath, { block: 'block-1' })

      const output = getOutput(consoleSpy)
      // block-1 defines x,y which are used by block-2
      expect(output).toContain('will need to re-run')
    })
  })

  describe('error handling', () => {
    it('reports error when file not found', async () => {
      const action = createDagShowAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.deepnote', { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()

      exitSpy.mockRestore()
    })
  })
})
