import { parse } from 'yaml'

export function parseYaml(yamlContent: string): unknown {
  try {
    const parsed = parse(yamlContent)

    return parsed
  } catch (_) {
    throw new Error('Failed to parse Deepnote file.')
  }
}
