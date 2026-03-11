import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { getBlockDependencies } from './ast-analyzer'

describe('AstAnalyzer', () => {
  describe('getBlockDependencies', () => {
    it('should return empty array for empty input', async () => {
      const result = await getBlockDependencies([])
      expect(result).toEqual([])
    })

    it('should filter out unsupported cell types', async () => {
      const mockBlocks = [
        { id: '1', type: 'unsupported', content: 'a = 1', blockGroup: 'a', sortingKey: 'a' },
      ] as unknown as DeepnoteBlock[]

      const result = await getBlockDependencies(mockBlocks)
      expect(result).toEqual([])
    })

    it('should return parsed results', async () => {
      const mockBlocks = [
        { id: '1', type: 'code', content: 'a = 1', blockGroup: 'a', sortingKey: 'a' },
        { id: '2', type: 'sql', content: 'SELECT * FROM users WHERE id = {{ a }}', blockGroup: 'a', sortingKey: 'b' },
      ] as DeepnoteBlock[]

      const result = await getBlockDependencies(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({
          id: '1',
          definedVariables: ['a'],
          usedVariables: [],
          order: 0,
        }),
        expect.objectContaining({
          id: '2',
          usedVariables: ['a', 'users'],
          order: 1,
        }),
      ])
    })

    it('should handle syntax errors in code blocks', async () => {
      const mockBlocks = [
        { id: '1', type: 'code', content: 'a = ', blockGroup: 'a', sortingKey: 'a' },
      ] as DeepnoteBlock[]

      const result = await getBlockDependencies(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({
          id: '1',
          error: expect.objectContaining({
            type: 'SyntaxError',
          }),
        }),
      ])
    })

    it('should handle multiple blocks with dependencies', async () => {
      const mockBlocks = [
        { id: '1', type: 'code', content: 'x = 10', blockGroup: 'a', sortingKey: 'a' },
        { id: '2', type: 'code', content: 'y = x + 5', blockGroup: 'a', sortingKey: 'b' },
        { id: '3', type: 'code', content: 'print(y)', blockGroup: 'a', sortingKey: 'c' },
      ] as DeepnoteBlock[]

      const result = await getBlockDependencies(mockBlocks)

      expect(result).toEqual([
        expect.objectContaining({ id: '1', definedVariables: ['x'], usedVariables: [] }),
        expect.objectContaining({ id: '2', definedVariables: ['y'], usedVariables: ['x'] }),
        expect.objectContaining({ id: '3', definedVariables: [], usedVariables: ['y'] }),
      ])
    })

    it('should throw error when python interpreter is not found', async () => {
      const mockBlocks = [{ id: '1', type: 'code', content: 'a = 1' }] as DeepnoteBlock[]
      await expect(getBlockDependencies(mockBlocks, { pythonInterpreter: 'non-existent-python' })).rejects.toThrow(
        /Failed to run AST analyzer process/
      )
    })
  })
})
