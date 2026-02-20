import type { DeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { analyzeProject, buildBlockMap, checkForIssues, computeProjectStats, diagnoseBlockFailure } from './analysis'

// Helper to create a minimal DeepnoteFile for testing
function createTestFile(
  blocks: Array<{ id: string; type: string; content?: string; metadata?: Record<string, unknown> }>,
  options?: { notebookName?: string }
): DeepnoteFile {
  return {
    version: '1',
    project: {
      id: 'test-project-id',
      name: 'Test Project',
      notebooks: [
        {
          id: 'test-notebook-id',
          name: options?.notebookName ?? 'Test Notebook',
          blocks: blocks.map((block, index) => ({
            id: block.id,
            type: block.type,
            content: block.content ?? '',
            metadata: block.metadata ?? {},
            sortingKey: String(index).padStart(5, '0'),
          })),
        },
      ],
    },
  } as DeepnoteFile
}

describe('analysis utilities', () => {
  describe('computeProjectStats', () => {
    it('computes stats for empty project', () => {
      const file = createTestFile([])
      const stats = computeProjectStats(file)

      expect(stats.projectName).toBe('Test Project')
      expect(stats.projectId).toBe('test-project-id')
      expect(stats.notebookCount).toBe(1)
      expect(stats.totalBlocks).toBe(0)
      expect(stats.totalLinesOfCode).toBe(0)
      expect(stats.imports).toEqual([])
    })

    it('computes stats for project with code blocks', () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'import pandas as pd\nx = 1\ny = 2' },
        { id: 'block2', type: 'code', content: 'print(x + y)' },
      ])
      const stats = computeProjectStats(file)

      expect(stats.totalBlocks).toBe(2)
      expect(stats.totalLinesOfCode).toBe(4)
      // Note: computeProjectStats returns empty imports; analyzeProject populates them from DAG
      expect(stats.imports).toEqual([])
    })

    it('computes stats for project with SQL blocks', () => {
      const file = createTestFile([
        { id: 'block1', type: 'sql', content: 'SELECT * FROM users\n-- comment\nWHERE id = 1' },
      ])
      const stats = computeProjectStats(file)

      expect(stats.totalBlocks).toBe(1)
      expect(stats.totalLinesOfCode).toBe(2) // Comment excluded
      expect(stats.blockTypesSummary).toContainEqual(expect.objectContaining({ type: 'sql', count: 1 }))
    })

    it('filters by notebook name', () => {
      const file: DeepnoteFile = {
        version: '1',
        project: {
          id: 'test-id',
          name: 'Test',
          notebooks: [
            {
              id: 'nb1',
              name: 'Notebook 1',
              blocks: [{ id: 'b1', type: 'code', content: 'x = 1', metadata: {}, sortingKey: '00000' }],
            },
            {
              id: 'nb2',
              name: 'Notebook 2',
              blocks: [{ id: 'b2', type: 'code', content: 'y = 2', metadata: {}, sortingKey: '00000' }],
            },
          ],
        },
      } as DeepnoteFile

      const stats = computeProjectStats(file, { notebook: 'Notebook 1' })
      expect(stats.notebookCount).toBe(1)
      expect(stats.totalBlocks).toBe(1)
    })
  })

  describe('checkForIssues', () => {
    it('returns no issues for clean project', async () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'x = 1' },
        { id: 'block2', type: 'code', content: 'print(x)' },
      ])
      const { lint } = await checkForIssues(file)

      expect(lint.success).toBe(true)
      expect(lint.issueCount.errors).toBe(0)
      expect(lint.issueCount.warnings).toBe(0)
    })

    it('detects unused variables', async () => {
      const file = createTestFile([{ id: 'block1', type: 'code', content: 'unused_var = 42' }])
      const { lint } = await checkForIssues(file)

      // Unused variable warnings should be detected
      expect(lint.issues.some(i => i.code === 'unused-variable')).toBe(true)
    })

    it('detects missing integrations', async () => {
      // Isolate env vars to ensure deterministic test
      const envVars = ['SQL_MY_DATABASE', 'SQL_MY_DB']
      const saved = envVars.map(k => [k, process.env[k]] as const)
      for (const k of envVars) delete process.env[k]
      try {
        const file = createTestFile([
          {
            id: 'block1',
            type: 'sql',
            content: 'SELECT 1',
            metadata: { sql_integration_id: 'my-database' },
          },
        ])
        const { lint } = await checkForIssues(file)

        expect(lint.issues.some(i => i.code === 'missing-integration')).toBe(true)
        expect(lint.integrations?.missing).toContain('my-database')
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    })

    it('detects missing input values', async () => {
      const file = createTestFile([
        {
          id: 'block1',
          type: 'input-text',
          metadata: {
            deepnote_variable_name: 'my_input',
            deepnote_variable_value: '', // Empty value
          },
        },
      ])
      const { lint } = await checkForIssues(file)

      expect(lint.issues.some(i => i.code === 'missing-input')).toBe(true)
      expect(lint.inputs?.needingValues).toContain('my_input')
    })

    it('returns DAG with edges', async () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'x = 1' },
        { id: 'block2', type: 'code', content: 'y = x + 1' },
      ])
      const { dag } = await checkForIssues(file)

      expect(dag.nodes.length).toBe(2)
      expect(dag.edges.length).toBeGreaterThan(0)
    })
  })

  describe('analyzeProject', () => {
    it('combines stats, lint, and dag analysis', async () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'x = 1' },
        { id: 'block2', type: 'code', content: 'y = x + 1' },
      ])
      const result = await analyzeProject(file)

      expect(result.stats).toBeDefined()
      expect(result.stats.totalBlocks).toBe(2)
      expect(result.lint).toBeDefined()
      expect(result.lint.success).toBe(true)
      expect(result.dag).toBeDefined()
      expect(result.dag.nodes.length).toBe(2)
    })

    it('extracts package names from Python import statements', async () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'import pandas as pd\nimport numpy as np' },
        { id: 'block2', type: 'code', content: 'from sklearn import metrics' },
      ])
      const result = await analyzeProject(file)

      expect(result.stats.imports).toContain('pandas')
      expect(result.stats.imports).toContain('numpy')
      expect(result.stats.imports).toContain('sklearn')
      expect(result.stats.imports).toHaveLength(3)

      expect(result.stats.packageAliases).toEqual({ pandas: 'pd', numpy: 'np' })
    })
  })

  describe('buildBlockMap', () => {
    it('builds map with block info', () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'x = 1' },
        { id: 'block2', type: 'sql', content: 'SELECT 1' },
      ])
      const blockMap = buildBlockMap(file)

      expect(blockMap.size).toBe(2)
      expect(blockMap.get('block1')).toMatchObject({
        id: 'block1',
        type: 'code',
        notebookName: 'Test Notebook',
      })
    })

    it('filters by notebook', () => {
      const file: DeepnoteFile = {
        version: '1',
        project: {
          id: 'test-id',
          name: 'Test',
          notebooks: [
            {
              id: 'nb1',
              name: 'Notebook 1',
              blocks: [{ id: 'b1', type: 'code', content: '', metadata: {}, sortingKey: '00000' }],
            },
            {
              id: 'nb2',
              name: 'Notebook 2',
              blocks: [{ id: 'b2', type: 'code', content: '', metadata: {}, sortingKey: '00000' }],
            },
          ],
        },
      } as DeepnoteFile

      const blockMap = buildBlockMap(file, { notebook: 'Notebook 1' })
      expect(blockMap.size).toBe(1)
      expect(blockMap.has('b1')).toBe(true)
      expect(blockMap.has('b2')).toBe(false)
    })
  })

  describe('diagnoseBlockFailure', () => {
    it('finds upstream dependencies', async () => {
      const file = createTestFile([
        { id: 'block1', type: 'code', content: 'x = 1' },
        { id: 'block2', type: 'code', content: 'y = x + 1' },
      ])
      const { lint, dag } = await checkForIssues(file)
      const blockMap = buildBlockMap(file)

      const diagnosis = diagnoseBlockFailure('block2', dag, lint, blockMap)

      expect(diagnosis.blockId).toBe('block2')
      expect(diagnosis.upstream.length).toBeGreaterThan(0)
      expect(diagnosis.upstream[0].id).toBe('block1')
      expect(diagnosis.usedVariables).toContain('x')
    })

    it('finds related lint issues', async () => {
      // Isolate env vars to ensure deterministic test
      const envVars = ['SQL_MY_DB', 'SQL_MY_DATABASE']
      const saved = envVars.map(k => [k, process.env[k]] as const)
      for (const k of envVars) delete process.env[k]
      try {
        // Use missing integration which is detected without AST analysis
        const file = createTestFile([
          {
            id: 'block1',
            type: 'sql',
            content: 'SELECT 1',
            metadata: { sql_integration_id: 'my-db' },
          },
        ])
        const { lint, dag } = await checkForIssues(file)
        const blockMap = buildBlockMap(file)

        const diagnosis = diagnoseBlockFailure('block1', dag, lint, blockMap)

        expect(diagnosis.relatedIssues.length).toBeGreaterThan(0)
        expect(diagnosis.relatedIssues[0].code).toBe('missing-integration')
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    })
  })
})
