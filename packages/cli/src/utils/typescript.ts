export function assertNever(value: never): never {
  throw new Error(`Unexpected auth method: ${value}`)
}
