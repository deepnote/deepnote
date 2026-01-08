import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const oldSchema = z.preprocess(
  val => (val === null ? undefined : val),
  z.union([z.string(), z.array(z.string())]).optional()
)
const newSchema = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform(val => (val === null ? undefined : val))

describe('deepnote file schema', () => {
  it.each([
    [null, undefined],
    [undefined, undefined],
    ['abc', 'abc'],
    [
      ['abc', 'def'],
      ['abc', 'def'],
    ],
  ])('should parse the deepnote file schema', (input, expected) => {
    const oldResult = oldSchema.safeParse(input)
    const newResult = newSchema.safeParse(input)
    expect(oldResult.success).toBe(true)
    expect(oldResult.data).toBe(expected)
    expect(oldResult.success).toStrictEqual(newResult.success)
    expect(oldResult.data).toStrictEqual(newResult.data)
  })
})
