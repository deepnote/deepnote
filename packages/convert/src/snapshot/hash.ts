import { createHash } from 'node:crypto'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'

/**
 * Computes a SHA-256 hash of the given content.
 *
 * @param content - The content to hash
 * @returns Hash string in format 'sha256:{hex}'
 */
export function computeContentHash(content: string): string {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex')
  return `sha256:${hash}`
}

/**
 * Computes a snapshot hash from the file's key properties.
 * The hash is based on: version, environment.hash, integrations, and all block contentHashes.
 *
 * @param file - The DeepnoteFile to compute hash for
 * @returns Hash string in format 'sha256:{hex}'
 */
export function computeSnapshotHash(file: DeepnoteFile): string {
  const parts: string[] = []

  // Version
  parts.push(`version:${file.version}`)

  // Environment hash
  if (file.environment?.hash) {
    parts.push(`env:${file.environment.hash}`)
  }

  // Integrations (sorted for determinism)
  const integrations = file.project.integrations ?? []
  const sortedIntegrations = [...integrations].sort((a, b) => a.id.localeCompare(b.id))
  for (const integration of sortedIntegrations) {
    parts.push(`integration:${integration.id}:${integration.type}`)
  }

  // All block content hashes (preserve notebook and block order)
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (block.contentHash) {
        parts.push(`block:${block.id}:${block.contentHash}`)
      }
    }
  }

  const combined = parts.join('\n')
  const hash = createHash('sha256').update(combined, 'utf-8').digest('hex')
  return `sha256:${hash}`
}

/**
 * Adds content hashes to all blocks in a DeepnoteFile that don't already have them.
 * Modifies the file in place and returns it for chaining.
 *
 * @param file - The DeepnoteFile to add hashes to
 * @returns The modified DeepnoteFile
 */
export function addContentHashes(file: DeepnoteFile): DeepnoteFile {
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!block.contentHash && block.content) {
        ;(block as DeepnoteBlock & { contentHash?: string }).contentHash = computeContentHash(block.content)
      }
    }
  }
  return file
}
