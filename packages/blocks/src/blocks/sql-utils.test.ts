import { describe, expect, it } from 'vitest'
import { convertToEnvironmentVariableName } from './sql-utils'

describe('convertToEnvironmentVariableName', () => {
  it.each([
    ['3e2bed0f-e89b', '_3E2BED0F_E89B'],
    ['a.b/c', 'A_B_C'],
    ['', ''],
    ['é', '_'],
  ])('converts %j to %j', (input, expected) => {
    expect(convertToEnvironmentVariableName(input)).toBe(expected)
  })
})
