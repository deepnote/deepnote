import { spawn } from 'node:child_process'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

/**
 * Gets the minimal environment variables needed for child process execution.
 * These are system-level variables required for basic process functionality.
 */
function getMinimalProcessEnvironment(): Record<string, string> {
  // NOTE: These are system-level environment variables required for process execution,
  // not application configuration variables. They are accessed directly as they are
  // not part of the standard application config schema.
  /* eslint-disable no-process-env */
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || tmpdir(),
    PYTHONPATH: process.env.PYTHONPATH || '', // Required to locate Python packages
  }
  /* eslint-enable no-process-env */
}

/**
 * Safely executes a child process with input/output communication using temporary files.
 *
 * @param cmd - The command to execute
 * @param args - Array of command arguments
 * @param input - Input string to write to a temporary input file
 * @returns Promise that resolves to the content of the output file
 * @throws {Error} If the process fails or times out
 */
export async function safelyCallChildProcessWithInputOutput(
  cmd: string,
  args: string[],
  input: string
): Promise<string> {
  const randomId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  const inputPath = path.join(tmpdir(), `input-${randomId}.txt`)
  const outputPath = path.join(tmpdir(), `output-${randomId}.txt`)

  try {
    // Validate that the first arg is our entry script and log if it doesn't exist
    const scriptPathCandidate = args[0]
    if (scriptPathCandidate) {
      try {
        await access(scriptPathCandidate)
      } catch {
        throw new Error(`Child process entry script not found: ${scriptPathCandidate}`)
      }
    }

    // Write input to temporary file
    await writeFile(inputPath, input)

    const result = await new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
      // Pass input and output file paths as arguments to the command
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      const child = spawn(cmd, [...args, '--input', inputPath, '--output', outputPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: getMinimalProcessEnvironment(),
      })

      let stderrBuffer = ''
      if (child.stderr) {
        child.stderr.on('data', chunk => {
          try {
            stderrBuffer += String(chunk)
          } catch {}
        })
      }

      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Process timeout after 30 seconds for command: ${cmd}`))
      }, 30000)

      timeout.unref()

      child.on('close', code => {
        clearTimeout(timeout)
        resolve({ status: code, stderr: stderrBuffer })
      })

      child.on('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    if (result.status !== 0) {
      throw new Error(`Process exited with code ${result.status}${result.stderr ? `: ${result.stderr}` : ''}`)
    }

    // Read output from temporary file
    const outputData = await readFile(outputPath, 'utf8')
    return outputData
  } catch (error) {
    throw new Error(
      `Error while executing child process ${cmd}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  } finally {
    // Clean up temporary files
    try {
      await Promise.all([unlink(inputPath).catch(() => {}), unlink(outputPath).catch(() => {})])
    } catch {
      // Ignore cleanup errors
    }
  }
}
