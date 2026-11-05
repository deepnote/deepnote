/**
 * Compile error unless the passed array lists every member of `T` exactly.
 *
 * Use to keep a hand-written list in sync with a union that will grow.
 *
 * @example
 * type Fruit = 'apple' | 'banana'
 * const FRUITS = arrayOfAll<Fruit>()(['apple', 'banana'])
 */
export const arrayOfAll =
  <T>() =>
  <U extends readonly T[]>(values: U & ([T] extends [U[number]] ? unknown : 'Missing union member')) =>
    values
