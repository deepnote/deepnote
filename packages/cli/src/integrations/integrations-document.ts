import fs from 'node:fs/promises'
import path from 'node:path'
import { parseIntegrationsDocument, serializeIntegrationsDocument } from '@deepnote/database-integrations'
import type { Document } from 'yaml'
import { isErrnoENOENT } from '../utils/file-resolver'

/**
 * Read an integrations YAML file as a `yaml` Document (preserving comments and
 * formatting). Returns `null` if the file doesn't exist or is empty.
 */
export async function readIntegrationsDocument(filePath: string): Promise<Document | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseIntegrationsDocument(content)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return null
    }
    throw error
  }
}

/**
 * Write an integrations Document to a YAML file, creating parent directories if needed.
 */
export async function writeIntegrationsFile(filePath: string, doc: Document): Promise<void> {
  const yamlContent = serializeIntegrationsDocument(doc)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, yamlContent, 'utf-8')
}
