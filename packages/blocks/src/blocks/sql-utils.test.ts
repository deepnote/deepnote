import { describe, expect, it } from 'vitest'
import { convertToEnvironmentVariableName, getSqlEnvVarName } from './sql-utils'

describe('convertToEnvironmentVariableName', () => {
  it.each([
    ['3e2bed0f-e89b', '_3E2BED0F_E89B'],
    ['My AlloyDB Connection', 'MY_ALLOYDB_CONNECTION'],
    ['a.b/c', 'A_B_C'],
    ['', ''],
    ['é', '_'],
  ])('converts %j to %j', (input, expected) => {
    expect(convertToEnvironmentVariableName(input)).toBe(expected)
  })
})

describe('getSqlEnvVarName', () => {
  it('prefixes the integration id with SQL_ without sanitizing it', () => {
    expect(getSqlEnvVarName('abc-def-123')).toBe('SQL_abc-def-123')
  })
})
