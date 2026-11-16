/**
 * Compares two block sorting keys by UTF-16 code unit, with no locale or case folding, so digits
 * sort before uppercase letters and uppercase before lowercase. This is the order Deepnote Cloud
 * gives blocks.
 *
 * @returns `-1` when `a` sorts first, `1` when `b` sorts first, `0` when the keys are equal.
 */
export function compareSortingKeys(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Returns a new array of `blocks` in ascending `sortingKey` order, as {@link compareSortingKeys}
 * orders them. Blocks with equal keys keep their input order.
 */
export function sortBlocksBySortingKey<T extends { sortingKey: string }>(blocks: readonly T[]): T[] {
  return [...blocks].sort((a, b) => compareSortingKeys(a.sortingKey, b.sortingKey))
}
