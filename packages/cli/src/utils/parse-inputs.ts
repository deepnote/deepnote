/**
 * Parse --input flags into a Record<string, unknown>.
 * Supports: key=value, key=123 (number), key=true/false (boolean), key=null
 *
 * Shared by the local `run` command and the cloud `run --cloud` path. Kept in its
 * own module so `run-cloud.ts` can reuse it without importing `run.ts` (which would
 * create a circular dependency).
 */
export function parseInputs(inputFlags: string[] | undefined): Record<string, unknown> {
  if (!inputFlags || inputFlags.length === 0) {
    return {}
  }

  const inputs: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const flag of inputFlags) {
    const eqIndex = flag.indexOf('=')
    if (eqIndex === -1) {
      throw new Error(`Invalid input format: "${flag}". Expected key=value`)
    }

    const key = flag.slice(0, eqIndex).trim()
    const rawValue = flag.slice(eqIndex + 1)

    if (!key) {
      throw new Error(`Invalid input: empty key in "${flag}"`)
    }

    // Try to parse as JSON for numbers, booleans, null, arrays, objects
    // Fall back to string if not valid JSON
    let value: unknown
    try {
      value = JSON.parse(rawValue)
    } catch {
      // Not valid JSON, treat as string
      value = rawValue
    }

    inputs[key] = value
  }

  return inputs
}
