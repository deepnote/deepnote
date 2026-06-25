import fs from 'node:fs/promises'
import path from 'node:path'
import { decodeUtf8NoBom } from '@deepnote/blocks'
import {
  DEFAULT_INTEGRATIONS_FILE,
  type IntegrationsParseResult,
  parseIntegrations,
} from '@deepnote/database-integrations'
import { readDotEnv } from '../utils/dotenv'
import { isErrnoENOENT } from '../utils/file-resolver'

/**
 * Get the default path for the integrations file relative to a directory.
 */
export function getDefaultIntegrationsFilePath(deepnoteFileDir: string): string {
  return path.join(deepnoteFileDir, DEFAULT_INTEGRATIONS_FILE)
}

/**
 * Parse an integrations YAML file from disk.
 *
 * Reads and decodes the file, then delegates to the pure `parseIntegrations`.
 * `env:` references are resolved against (in priority order): an explicit
 * `options.env` map, else `process.env` overlaid on a `.env` file at
 * `options.envFilePath` (real environment variables win over `.env`), else
 * `process.env` alone.
 *
 * A missing file is not an error — it yields an empty result.
 */
export async function parseIntegrationsFile(
  filePath: string,
  options: { env?: Record<string, string | undefined>; envFilePath?: string } = {}
): Promise<IntegrationsParseResult> {
  let content: string
  try {
    const rawBytes = await fs.readFile(filePath)
    content = decodeUtf8NoBom(rawBytes)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      // File doesn't exist - return empty result (not an error, integrations are optional)
      return { integrations: [], issues: [] }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      integrations: [],
      issues: [{ path: '', message: `Failed to read integrations file: ${message}`, code: 'file_read_error' }],
    }
  }

  let env = options.env
  if (!env) {
    if (options.envFilePath) {
      const fileEnv = await readDotEnv(options.envFilePath)
      env = { ...fileEnv, ...process.env }
    } else {
      env = process.env
    }
  }

  return parseIntegrations({ yaml: content, env })
}
