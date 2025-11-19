import { type DeepnoteRunFile, deepnoteRunFileSchema } from './deepnote-run-file-schema'
import { parseYaml } from './parse-yaml'

export function deserializeDeepnoteRunFile(yamlContent: string): DeepnoteRunFile {
  const parsed = parseYaml(yamlContent)
  const result = deepnoteRunFileSchema.safeParse(parsed)

  if (!result.success) {
    const issue = result.error.issues[0]

    if (!issue) {
      throw new Error('Invalid Deepnote run file.')
    }

    const path = issue.path.join('.')
    const message = path ? `${path}: ${issue.message}` : issue.message

    throw new Error(`Failed to parse the Deepnote run file: ${message}.`)
  }

  return result.data
}
