#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noConsole: CLI tool requires console output

/**
 * CLI utility for testing MCP tools directly.
 *
 * Usage:
 *   pnpm test:tool <tool-name> '<json-arguments>'
 *
 * Examples:
 *   pnpm test:tool deepnote_read '{"path": "example.deepnote"}'
 *   pnpm test:tool deepnote_create '{"outputPath": "/tmp/test.deepnote", "projectName": "Demo", "notebooks": [{"name":"Notebook","blocks":[{"type":"code","content":"print(1)"}]}]}'
 *   pnpm test:tool deepnote_convert_to '{"inputPath": "notebook.ipynb"}'
 */

import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { conversionTools } from './tools/conversion'
import { executionTools } from './tools/execution'
import { readingTools } from './tools/reading'
import { snapshotTools } from './tools/snapshots'
import { writingTools } from './tools/writing'

const toolGroups: Array<{ label: string; tools: string[] }> = [
  { label: 'Reading', tools: readingTools.map(tool => tool.name) },
  { label: 'Writing', tools: writingTools.map(tool => tool.name) },
  { label: 'Conversion', tools: conversionTools.map(tool => tool.name) },
  { label: 'Execution', tools: executionTools.map(tool => tool.name) },
  { label: 'Snapshots', tools: snapshotTools.map(tool => tool.name) },
]

function formatAvailableTools(): string {
  return toolGroups.map(group => `  ${group.label}: ${group.tools.join(', ')}`).join('\n')
}

async function testTool(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log(`
Deepnote MCP Tool Tester

Usage: pnpm test:tool <tool-name> '<json-arguments>'

Examples:
  pnpm test:tool deepnote_read '{"path": "example.deepnote"}'
  pnpm test:tool deepnote_create '{"outputPath": "/tmp/test.deepnote", "projectName": "Demo", "notebooks": [{"name":"Notebook","blocks":[{"type":"code","content":"print(1)"}]}]}'
  pnpm test:tool deepnote_convert_to '{"inputPath": "notebook.ipynb"}'
  pnpm test:tool deepnote_run '{"path": "notebook.deepnote", "dryRun": true}'
  pnpm test:tool deepnote_snapshot_list '{"path": "notebook.deepnote"}'

Available tools:
${formatAvailableTools()}
`)
    process.exit(1)
  }

  const toolName = args[0]
  const toolArgsString = args[1]

  if (!toolArgsString) {
    console.error('Error: Missing JSON arguments')
    process.exit(1)
  }

  let toolArgs: Record<string, unknown>

  try {
    toolArgs = JSON.parse(toolArgsString)
  } catch (error) {
    console.error('Error: Invalid JSON arguments')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  // Create MCP request for calling a tool
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs,
    },
  }

  return new Promise((resolve, reject) => {
    // Resolve bin.js relative to this script's location (process.argv[1])
    const scriptDir = path.dirname(process.argv[1] || '')
    const serverPath = path.join(scriptDir, 'bin.js')
    const child = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => {
      stdout += data.toString()
    })

    child.stderr.on('data', data => {
      stderr += data.toString()
    })

    child.on('error', err => {
      reject(err)
    })

    child.on('close', code => {
      if (stderr) {
        console.error('Server stderr:', stderr)
      }

      if (code !== 0 && code !== null) {
        reject(new Error(`Server exited with code ${code}`))
        return
      }

      try {
        // Parse the JSON-RPC response
        const lines = stdout.trim().split('\n')
        const responseLine = lines.find(line => {
          try {
            const parsed = JSON.parse(line)
            return parsed.id === 1 && (parsed.result || parsed.error)
          } catch {
            return false
          }
        })

        if (responseLine) {
          const response = JSON.parse(responseLine)

          if (response.error) {
            console.error('Error:', response.error.message || response.error)
            process.exit(1)
          }

          // Pretty print the result
          const result = response.result
          if (result?.content?.[0]?.text) {
            try {
              // Try to parse and pretty-print JSON content
              const parsed = JSON.parse(result.content[0].text)
              console.log(JSON.stringify(parsed, null, 2))
            } catch {
              // Not JSON, print as-is
              console.log(result.content[0].text)
            }
          } else {
            console.log(JSON.stringify(result, null, 2))
          }
        } else {
          console.log('Raw output:', stdout)
        }
        resolve()
      } catch (error) {
        reject(error)
      }
    })

    // Send the tool call request
    child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
}

testTool().catch(error => {
  console.error('Error:', error.message || error)
  process.exit(1)
})
