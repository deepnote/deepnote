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

    describe('Python scoping', () => {
      // Block boundaries are not scope boundaries: a name that no enclosing function, lambda,
      // class body, or comprehension binds is a module-level read even when it appears deep
      // inside a body, and a name bound by one of those scopes never leaks out as a notebook
      // variable. See https://github.com/deepnote/deepnote/issues/512 and /issues/513.
      it.each([
        {
          name: 'reports a global read inside a function body',
          content: 'def read_source():\n    return source_value',
          definedVariables: ['read_source'],
          usedVariables: ['source_value'],
        },
        {
          name: 'reports a global read inside a method body',
          content: 'class C:\n    def m(self):\n        return source_value',
          definedVariables: ['C'],
          usedVariables: ['source_value'],
        },
        {
          name: 'reports a global read from an attribute access inside a function',
          content: 'def f():\n    return df.head()',
          definedVariables: ['f'],
          usedVariables: ['df'],
        },
        {
          name: 'does not report parameters or local assignments',
          content: 'def f(a):\n    x = a + 1\n    return x * k',
          definedVariables: ['f'],
          usedVariables: ['k'],
        },
        {
          name: 'treats a name assigned anywhere in a function as local throughout it',
          content: 'def f():\n    x = x + 1\n    return x',
          definedVariables: ['f'],
          usedVariables: [],
        },
        {
          name: 'treats a name declared global as a module-level read',
          content: 'def f():\n    global g\n    return g',
          definedVariables: ['f'],
          usedVariables: ['g'],
        },
        {
          name: 'records an assignment to a name declared global as a module-level definition',
          content: 'def f():\n    global g\n    g = 1',
          definedVariables: ['f', 'g'],
          usedVariables: [],
        },
        {
          name: 'evaluates decorators, defaults, and annotations in the enclosing scope',
          content: '@deco\ndef f(a=default_v, b: T = 1):\n    return a + b',
          definedVariables: ['f'],
          usedVariables: ['T', 'deco', 'default_v'],
        },
        {
          name: 'reports a global read in a class body but not the class attribute itself',
          content: 'class K:\n    attr = base',
          definedVariables: ['K'],
          usedVariables: ['base'],
        },
        {
          name: 'does not let class-body bindings shadow a global read inside a method',
          content: 'class C:\n    attr = 2\n    def m(self):\n        return attr',
          definedVariables: ['C'],
          usedVariables: ['attr'],
        },
        {
          name: 'keeps comprehension targets local inside a class body',
          content: 'class C:\n    xs = [a for a in items]',
          definedVariables: ['C'],
          usedVariables: ['items'],
        },
        {
          name: 'keeps comprehension targets local',
          content: 'squares = [o * o for o in items]',
          definedVariables: ['squares'],
          usedVariables: ['items'],
        },
        {
          name: 'reports a global read from a comprehension element',
          content: 'out = [a + b for a in items]',
          definedVariables: ['out'],
          usedVariables: ['b', 'items'],
        },
        {
          name: 'keeps nested comprehension and dict comprehension targets local',
          content: 'm = {k: [v for v in row] for k, row in table.items()}',
          definedVariables: ['m'],
          usedVariables: ['table'],
        },
        {
          name: 'keeps generator expression targets local',
          content: 'total = sum(i * w for i in items)',
          definedVariables: ['total'],
          usedVariables: ['items', 'w'],
        },
        {
          name: 'keeps set comprehension targets local and reports its condition reads',
          content: 'kept = {r for r in rows if r > threshold}',
          definedVariables: ['kept'],
          usedVariables: ['rows', 'threshold'],
        },
        {
          name: 'keeps lambda parameters local',
          content: 'double = lambda x: x * 2',
          definedVariables: ['double'],
          usedVariables: [],
        },
        {
          name: 'evaluates lambda defaults in the enclosing scope',
          content: 'f = lambda x, y=d: x + y',
          definedVariables: ['f'],
          usedVariables: ['d'],
        },
      ])('$name', async ({ content, definedVariables, usedVariables }) => {
        const mockBlocks = [{ id: '1', type: 'code', content, blockGroup: 'a', sortingKey: 'a' }] as DeepnoteBlock[]

        const result = await getBlockDependencies(mockBlocks)

        expect(result).toEqual([expect.objectContaining({ id: '1', definedVariables, usedVariables })])
      })
    })

    it('should throw error when python interpreter is not found', async () => {
      const mockBlocks = [{ id: '1', type: 'code', content: 'a = 1' }] as DeepnoteBlock[]
      await expect(getBlockDependencies(mockBlocks, { pythonInterpreter: 'non-existent-python' })).rejects.toThrow(
        /Failed to run AST analyzer process/
      )
    })
  })
})
