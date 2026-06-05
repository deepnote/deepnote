import fs from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Create a temporary .deepnote file with the given content.
 * Returns the absolute path to the created file.
 */
export async function createTempFile(content: string, prefix = 'deepnote-test-'): Promise<string> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), prefix))
  const filePath = join(tempDir, 'test.deepnote')
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

/**
 * Clean up a temporary file and its parent directory.
 * Silently ignores errors (best-effort cleanup).
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
    await fs.rmdir(dirname(filePath))
  } catch {
    // Ignore cleanup errors
  }
}
