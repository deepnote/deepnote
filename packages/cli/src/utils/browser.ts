import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { debug } from '../output'

/**
 * Opens a URL in the default browser. Resolves once the opener process has been launched, not
 * once it exits — the Linux fallback (`xdg-open`) can run a terminal browser in the foreground for
 * its whole lifetime, and a caller must not be blocked on that.
 *
 * @param url - The URL to open
 * @returns Promise that resolves once the browser command has been launched
 * @throws Error if the browser command could not be spawned (e.g. `ENOENT`) — a non-zero exit from
 *   a successfully spawned opener is no longer observed, so callers should also print the URL
 */
export async function openInBrowser(url: string): Promise<void> {
  const { command, args } = getOpenCommand(url)
  debug(`Opening browser with command: ${command} ${args.join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })

    child.on('error', error => {
      reject(new Error(`Failed to open browser: ${error.message}`))
    })

    child.on('spawn', () => {
      // Otherwise this handle holds the event loop open for as long as the browser runs.
      child.unref()
      resolve()
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
      // cmd.exe re-parses its command line, so an unescaped `&` would split the URL into
      // separate commands; libuv only quotes args containing space, tab or quote.
      return { command: 'cmd', args: ['/c', 'start', '', url.replace(/&/g, '^&')] }
    default:
      // Linux and other Unix-like systems
      return { command: 'xdg-open', args: [url] }
  }
}
