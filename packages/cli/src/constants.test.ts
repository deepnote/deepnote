import { describe, expect, it } from 'vitest'
import { isBuiltinIntegration } from './constants'

describe('isBuiltinIntegration', () => {
  it('recognizes a built-in integration in canonical lowercase casing', () => {
    expect(isBuiltinIntegration('pandas-dataframe')).toBe(true)
    expect(isBuiltinIntegration('deepnote-dataframe-sql')).toBe(true)
  })

  it('recognizes a built-in integration in all-uppercase casing', () => {
    expect(isBuiltinIntegration('PANDAS-DATAFRAME')).toBe(true)
    expect(isBuiltinIntegration('DEEPNOTE-DATAFRAME-SQL')).toBe(true)
  })

  it('recognizes a built-in integration in mixed casing', () => {
    expect(isBuiltinIntegration('Pandas-DataFrame')).toBe(true)
    expect(isBuiltinIntegration('Deepnote-DataFrame-SQL')).toBe(true)
  })

  it('returns false for a genuine external integration ID', () => {
    expect(isBuiltinIntegration('my-postgres')).toBe(false)
    expect(isBuiltinIntegration('pandas-dataframe-extended')).toBe(false)
  })
})
