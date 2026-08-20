import { describe, expect, it } from 'vitest'
import { BUILTIN_INTEGRATIONS, isBuiltinIntegration } from './constants'

describe('isBuiltinIntegration', () => {
  it('matches canonical lowercase built-in IDs', () => {
    for (const id of BUILTIN_INTEGRATIONS) {
      expect(isBuiltinIntegration(id)).toBe(true)
    }
  })

  it('matches built-in IDs case-insensitively', () => {
    expect(isBuiltinIntegration('Pandas-DataFrame')).toBe(true)
    expect(isBuiltinIntegration('PANDAS-DATAFRAME')).toBe(true)
    expect(isBuiltinIntegration('Deepnote-Dataframe-SQL')).toBe(true)
  })

  it('returns false for external integration IDs', () => {
    expect(isBuiltinIntegration('my-warehouse')).toBe(false)
    expect(isBuiltinIntegration('My-Warehouse')).toBe(false)
    expect(isBuiltinIntegration('')).toBe(false)
  })
})
