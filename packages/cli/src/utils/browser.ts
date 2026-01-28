import { spawn } from 'node:child_process'
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
  const { command, args } = getOpenCommand(url)
  debug(`Opening browser with command: ${command} ${args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })

    child.on('error', error => {
      reject(new Error(`Failed to open browser: ${error.message}`))
    })

    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Failed to open browser: process exited with code ${code}`))
      }
    })
  })
}

/**
 * Gets the platform-specific command and arguments to open a URL.
 */
function getOpenCommand(url: string): { command: string; args: string[] } {
  switch (platform()) {
    case 'darwin':
      return { command: 'open', args: [url] }
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', '', url] }
    default:
      // Linux and other Unix-like systems
      return { command: 'xdg-open', args: [url] }
  }
}
