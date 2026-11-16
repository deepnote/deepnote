import { describe, expect, it } from 'vitest'
import { compareSortingKeys, sortBlocksBySortingKey } from './sorting-key'

const keysOf = (blocks: { sortingKey: string }[]) => blocks.map(block => block.sortingKey)
const blocksWithKeys = (...keys: string[]) => keys.map(sortingKey => ({ sortingKey }))

describe('compareSortingKeys', () => {
  it('orders uppercase before lowercase', () => {
    expect(compareSortingKeys('Z', 'a')).toBe(-1)
    expect(compareSortingKeys('Z0U', 'Z0j')).toBe(-1)
  })

  it('orders a key before a longer key it prefixes', () => {
    expect(compareSortingKeys('a0', 'a00')).toBe(-1)
  })

  it('returns 1 when the second key sorts first', () => {
    expect(compareSortingKeys('b', 'a0')).toBe(1)
  })

  it('returns 0 for equal keys', () => {
    expect(compareSortingKeys('a0', 'a0')).toBe(0)
  })
})

describe('sortBlocksBySortingKey', () => {
  it('sorts digits, then uppercase, then lowercase', () => {
    const sorted = sortBlocksBySortingKey(blocksWithKeys('a0', 'Z0U', '000001', 'I', 'Z', 'm', 'Z0j'))
    expect(keysOf(sorted)).toEqual(['000001', 'I', 'Z', 'Z0U', 'Z0j', 'a0', 'm'])
  })

  it('leaves the input array unchanged', () => {
    const blocks = blocksWithKeys('b', 'a')
    sortBlocksBySortingKey(blocks)
    expect(keysOf(blocks)).toEqual(['b', 'a'])
  })

  it('keeps blocks with equal keys in their input order', () => {
    const blocks = [
      { id: 'first', sortingKey: 'a1' },
      { id: 'early', sortingKey: 'a0' },
      { id: 'second', sortingKey: 'a1' },
    ]
    expect(sortBlocksBySortingKey(blocks).map(block => block.id)).toEqual(['early', 'first', 'second'])
  })
})
