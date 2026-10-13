import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './map-with-concurrency'

function gate() {
  let open!: () => void
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  return { opened, open }
}

describe('mapWithConcurrency', () => {
  it('returns results in input order when workers finish out of order', async () => {
    const gates = [gate(), gate(), gate()]

    const result = mapWithConcurrency([0, 1, 2], 3, async index => {
      await gates[index].opened
      return `item-${index}`
    })
    gates[2].open()
    gates[0].open()
    gates[1].open()

    expect(await result).toEqual(['item-0', 'item-1', 'item-2'])
  })

  it('never has more than `limit` workers in flight and processes every item', async () => {
    let inFlight = 0
    let peak = 0

    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async item => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      inFlight--
      return item * 10
    })

    expect(peak).toBe(3)
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70])
  })

  it('runs one at a time when the limit is below one', async () => {
    let inFlight = 0
    let peak = 0

    const result = await mapWithConcurrency([1, 2, 3], 0, async item => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      inFlight--
      return item
    })

    expect(peak).toBe(1)
    expect(result).toEqual([1, 2, 3])
  })

  it('returns an empty array without calling the worker for no items', async () => {
    let calls = 0

    const result = await mapWithConcurrency([], 4, async () => {
      calls++
    })

    expect(result).toEqual([])
    expect(calls).toBe(0)
  })

  it('rejects with the error of a failing worker', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async item => {
        if (item === 2) {
          throw new Error('boom')
        }
        return item
      })
    ).rejects.toThrow('boom')
  })
})
