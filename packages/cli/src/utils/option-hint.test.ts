import { describe, expect, it } from 'vitest'
import { cliFlagFor } from './option-hint'

describe('cliFlagFor', () => {
  it('turns syncRoot: false into the negated flag', () => {
    expect(cliFlagFor({ option: 'syncRoot', value: false })).toBe('--no-sync-root')
  })

  it('turns prune: true into the flag', () => {
    expect(cliFlagFor({ option: 'prune', value: true })).toBe('--prune')
  })
})
