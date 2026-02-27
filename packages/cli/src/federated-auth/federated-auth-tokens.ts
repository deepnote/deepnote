import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodeUtf8NoBom, parseYaml } from '@deepnote/blocks'
import { stringify } from 'yaml'
import type { ZodIssue } from 'zod'
import type { ValidationIssue } from '../commands/validate'
import { DEFAULT_FEDERATED_AUTH_TOKENS_FILE } from '../constants'
import { isErrnoENOENT } from '../utils/file-resolver'
import {
  baseTokensFileSchema,
  type FederatedAuthTokenEntry,
  federatedAuthTokenEntrySchema,
} from './federated-auth-tokens-schema'

/**
 * Get the default path for the federated auth tokens file.
 * Uses ~/.deepnote/federated-auth-tokens.yaml
 */
export function getDefaultTokensFilePath(): string {
  return path.join(os.homedir(), '.deepnote', DEFAULT_FEDERATED_AUTH_TOKENS_FILE)
}

export interface TokensParseResult {
  tokens: FederatedAuthTokenEntry[]
  issues: ValidationIssue[]
}

function formatZodIssues(issues: ZodIssue[], pathPrefix: string): ValidationIssue[] {
  return issues.map(issue => ({
    path: [pathPrefix, ...issue.path].filter(Boolean).join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Parse the federated auth tokens YAML file gracefully.
 * Returns all valid token entries and collects validation issues for invalid ones.
 */
export async function readTokensFile(filePath?: string): Promise<TokensParseResult> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const emptyTokens: FederatedAuthTokenEntry[] = []
  const issues: ValidationIssue[] = []

  let content: string
  try {
    const rawBytes = await fs.readFile(resolvedPath)
    content = decodeUtf8NoBom(rawBytes)
  } catch (error) {
    if (isErrnoENOENT(error)) {
      return { tokens: emptyTokens, issues }
    }
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Failed to read tokens file: ${message}`,
      code: 'file_read_error',
    })
    return { tokens: emptyTokens, issues }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push({
      path: '',
      message: `Invalid YAML in tokens file: ${message}`,
      code: 'yaml_parse_error',
    })
    return { tokens: emptyTokens, issues }
  }

  if (parsed === null || parsed === undefined) {
    return { tokens: emptyTokens, issues }
  }

  const fileResult = baseTokensFileSchema.safeParse(parsed)
  if (!fileResult.success) {
    issues.push(...formatZodIssues(fileResult.error.issues, ''))
    return { tokens: emptyTokens, issues }
  }

  const entries = fileResult.data.tokens
  const tokens: FederatedAuthTokenEntry[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const pathPrefix = `tokens[${i}]`

    const result = federatedAuthTokenEntrySchema.safeParse(entry)
    if (result.success) {
      tokens.push(result.data)
    } else {
      issues.push(...formatZodIssues(result.error.issues, pathPrefix))
    }
  }

  return { tokens, issues }
}

/**
 * Write token entries to the YAML file.
 */
export async function writeTokensFile(tokens: FederatedAuthTokenEntry[], filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const dir = path.dirname(resolvedPath)
  await fs.mkdir(dir, { recursive: true })

  const content = stringify({ tokens }, { lineWidth: 0 })
  await fs.writeFile(resolvedPath, content, 'utf-8')
}

/**
 * Get the token entry for a specific integration ID.
 * Iterates the file to find a matching entry.
 */
export async function getTokenForIntegration(
  integrationId: string,
  filePath?: string
): Promise<FederatedAuthTokenEntry | undefined> {
  const { tokens } = await readTokensFile(filePath)
  return tokens.find(t => t.integrationId === integrationId)
}

/**
 * Save or update a token entry for an integration.
 * Upserts by integrationId - replaces existing or appends.
 */
export async function saveTokenForIntegration(entry: FederatedAuthTokenEntry, filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? getDefaultTokensFilePath()
  const { tokens } = await readTokensFile(resolvedPath)

  const existingIndex = tokens.findIndex(t => t.integrationId === entry.integrationId)
  const updatedTokens =
    existingIndex >= 0
      ? [...tokens.slice(0, existingIndex), entry, ...tokens.slice(existingIndex + 1)]
      : [...tokens, entry]

  await writeTokensFile(updatedTokens, resolvedPath)
}
