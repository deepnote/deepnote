/** Run `worker` over `items` with at most `limit` in flight, preserving order in the result. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}
