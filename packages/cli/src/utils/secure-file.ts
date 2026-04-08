import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Write content to a file with restricted permissions (0o600 = owner read/write only).
 * Creates parent directories as needed.
 */
export async function writeSecureFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 })
}
