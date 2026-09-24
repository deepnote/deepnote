/**
 * Run `worker` over `items` with at most `limit` calls in flight, starting items in order.
 *
 * Resolves once every item has been processed. A worker that rejects stops the pool from starting
 * further items, and the returned promise rejects with that error once the in-flight workers have
 * settled. Callers that want per-item failures to be isolated should catch inside `worker`.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`Concurrency limit must be a positive integer, got ${limit}`)
  }

  let nextIndex = 0
  let failure: { error: unknown } | undefined
  const lane = async (): Promise<void> => {
    while (failure === undefined && nextIndex < items.length) {
      const index = nextIndex++
      try {
        await worker(items[index] as T, index)
      } catch (error) {
        failure ??= { error }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  if (failure !== undefined) {
    throw failure.error
  }
}

/** What a {@link SuspendableTask} did next: finished, or stopped to wait for an answer. */
export type SuspendableTaskStep<TResult, TQuestion, TAnswer> =
  | { kind: 'done'; value: TResult }
  | { kind: 'question'; question: TQuestion; answer: (value: TAnswer) => void }

/** A running task that can pause itself on a question until its driver answers it. */
export interface SuspendableTask<TResult, TQuestion, TAnswer> {
  /** Resolves when the task finishes or asks a question; rejects if the task throws. */
  next(): Promise<SuspendableTaskStep<TResult, TQuestion, TAnswer>>
}

/**
 * Start `run` and hand control back to the caller whenever it asks a question, instead of letting it
 * answer the question itself. The caller decides when to answer (for example, only once every other
 * task has finished) and then calls `next()` again to wait for the task's next step.
 *
 * `run` receives an `ask` function. Each call suspends the task until the driver passes an answer to
 * the step's `answer` callback.
 */
export function startSuspendableTask<TResult, TQuestion, TAnswer>(
  run: (ask: (question: TQuestion) => Promise<TAnswer>) => Promise<TResult>
): SuspendableTask<TResult, TQuestion, TAnswer> {
  type Step = SuspendableTaskStep<TResult, TQuestion, TAnswer> | { kind: 'failed'; error: unknown }
  const steps: Step[] = []
  let wake: (() => void) | undefined

  const emit = (step: Step): void => {
    steps.push(step)
    wake?.()
    wake = undefined
  }
  const ask = (question: TQuestion): Promise<TAnswer> =>
    new Promise<TAnswer>(resolve => emit({ kind: 'question', question, answer: resolve }))

  Promise.resolve()
    .then(() => run(ask))
    .then(
      value => emit({ kind: 'done', value }),
      (error: unknown) => emit({ kind: 'failed', error })
    )

  return {
    async next() {
      while (steps.length === 0) {
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
      const step = steps.shift() as Step
      if (step.kind === 'failed') {
        throw step.error
      }
      return step
    },
  }
}
