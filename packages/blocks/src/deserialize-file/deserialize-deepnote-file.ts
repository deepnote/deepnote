import { type DeepnoteFile, deepnoteFileSchema } from './deepnote-file-schema'
import { parseYaml } from './parse-yaml'

/**
 * Deserialize a YAML string into a DeepnoteFile object.
 */
export function deserializeDeepnoteFile(yamlContent: string): DeepnoteFile {
  const parsed = parseYaml(yamlContent)
  const result = deepnoteFileSchema.safeParse(parsed)

  if (!result.success) {
    const issue = result.error.issues[0]

    if (!issue) {
      throw new Error('Invalid Deepnote file.')
    }

    const path = issue.path.join('.')
    const message = path ? `${path}: ${issue.message}` : issue.message

    throw new Error(`Failed to parse the Deepnote file: ${message}.`)
  }

  return result.data
}
