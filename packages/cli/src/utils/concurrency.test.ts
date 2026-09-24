import { describe, expect, it } from 'vitest'
import { runWithConcurrency, startSuspendableTask } from './concurrency'

/** A promise the test resolves by hand. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('runWithConcurrency', () => {
  it('never runs more than the limit at once, and does run that many', async () => {
    const gates = Array.from({ length: 10 }, () => deferred())
    let inFlight = 0
    let maxInFlight = 0
    const started: number[] = []

    const done = runWithConcurrency(gates, 3, async (gate, index) => {
      started.push(index)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await gate.promise
      inFlight--
    })

    await flush()
    expect(started).toEqual([0, 1, 2])
    for (const gate of gates) {
      gate.resolve()
      await flush()
    }
    await done

    expect(maxInFlight).toBe(3)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('handles fewer items than the limit and an empty list', async () => {
    const seen: string[] = []
    await runWithConcurrency(['a', 'b'], 8, async item => {
      seen.push(item)
    })
    await runWithConcurrency([], 8, async () => {
      throw new Error('never called')
    })
    expect(seen).toEqual(['a', 'b'])
  })

  it('stops starting new items after a worker throws, then rejects with that error', async () => {
    const started: number[] = []
    const boom = new Error('boom')

    await expect(
      runWithConcurrency([0, 1, 2, 3, 4], 1, async item => {
        started.push(item)
        if (item === 1) {
          throw boom
        }
      })
    ).rejects.toBe(boom)
    expect(started).toEqual([0, 1])
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects a limit of %s', async limit => {
    await expect(runWithConcurrency([1], limit, async () => {})).rejects.toThrow(RangeError)
  })
})

describe('startSuspendableTask', () => {
  it('reports the result of a task that never asks', async () => {
    const task = startSuspendableTask<string, string, boolean>(async () => 'finished')
    expect(await task.next()).toEqual({ kind: 'done', value: 'finished' })
  })

  it('suspends on each question until the driver answers it', async () => {
    const log: string[] = []
    const task = startSuspendableTask<string, string, number>(async ask => {
      log.push('start')
      const first = await ask('first?')
      log.push(`got ${first}`)
      const second = await ask('second?')
      log.push(`got ${second}`)
      return `sum ${first + second}`
    })

    const step1 = await task.next()
    if (step1.kind !== 'question') throw new Error('expected a question')
    expect(step1.question).toBe('first?')
    await flush()
    expect(log).toEqual(['start'])

    step1.answer(1)
    const step2 = await task.next()
    if (step2.kind !== 'question') throw new Error('expected a question')
    expect(step2.question).toBe('second?')

    step2.answer(2)
    expect(await task.next()).toEqual({ kind: 'done', value: 'sum 3' })
    expect(log).toEqual(['start', 'got 1', 'got 2'])
  })

  it('rejects next() when the task throws', async () => {
    const boom = new Error('boom')
    const task = startSuspendableTask(async () => {
      throw boom
    })
    await expect(task.next()).rejects.toBe(boom)
  })
})
