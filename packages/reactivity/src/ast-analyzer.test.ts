import { describe, expect, it } from 'vitest'
import { getBlocksContentDeps } from './ast-analyzer'

describe('AstAnalyzer', () => {
  describe('getBlocksContentDeps', () => {
    it('should return empty array for empty input', async () => {
      const result = await getBlocksContentDeps([])
      expect(result).toEqual([])
    })

    it('should filter out unsupported cell types', async () => {
      const mockBlocks = [{ cellId: '1', cell_type: 'unsupported', source: 'a = 1' }]

      const result = await getBlocksContentDeps(mockBlocks)
      expect(result).toEqual([])
    })

    it('should return parsed results', async () => {
      const mockBlocks = [
        { cellId: '1', cell_type: 'code', source: 'a = 1' },
        { cellId: '2', cell_type: 'sql', source: 'SELECT * FROM users WHERE id = {{ a }}' },
      ]

      const result = await getBlocksContentDeps(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({
          blockId: '1',
          definedVariables: ['a'],
          usedVariables: [],
          order: 0,
        }),
        expect.objectContaining({
          blockId: '2',
          usedVariables: expect.arrayContaining(['a']),
          order: 1,
        }),
      ])
    })

    it('should handle syntax errors in code blocks', async () => {
      const mockBlocks = [{ cellId: '1', cell_type: 'code', source: 'a = ' }]

      const result = await getBlocksContentDeps(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({
          blockId: '1',
          error: expect.objectContaining({
            type: 'SyntaxError',
          }),
        }),
      ])
    })

    it('should handle multiple blocks with dependencies', async () => {
      const mockBlocks = [
        { cellId: '1', cell_type: 'code', source: 'x = 10' },
        { cellId: '2', cell_type: 'code', source: 'y = x + 5' },
        { cellId: '3', cell_type: 'code', source: 'print(y)' },
      ]

      const result = await getBlocksContentDeps(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({ blockId: '1', definedVariables: ['x'], usedVariables: [] }),
        expect.objectContaining({ blockId: '2', definedVariables: ['y'], usedVariables: ['x'] }),
        expect.objectContaining({ blockId: '3', definedVariables: [], usedVariables: ['y'] }),
      ])
    })
  })
})
