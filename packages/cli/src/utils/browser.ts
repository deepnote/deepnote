import { exec } from 'node:child_process'
import { platform } from 'node:os'
import { debug } from '../output'

/**
 * Opens a URL in the default browser.
 *
 * @param url - The URL to open
 * @returns Promise that resolves when the browser command is executed
 * @throws Error if the browser cannot be opened
 */
export async function openInBrowser(url: string): Promise<void> {
  const command = getOpenCommand(url)
  debug(`Opening browser with command: ${command}`)

  return new Promise((resolve, reject) => {
    exec(command, error => {
      if (error) {
        reject(new Error(`Failed to open browser: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}

/**
 * Gets the platform-specific command to open a URL.
 */
function getOpenCommand(url: string): string {
  const escapedUrl = url.replace(/"/g, '\\"')

  switch (platform()) {
    case 'darwin':
      return `open "${escapedUrl}"`
    case 'win32':
      return `start "" "${escapedUrl}"`
    default:
      // Linux and other Unix-like systems
      return `xdg-open "${escapedUrl}"`
  }
}
