import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import type { Resource } from '@modelcontextprotocol/sdk/types.js'

// Resource contents type following MCP spec
interface TextResourceContents {
  uri: string
  mimeType?: string
  text: string
}

interface BlobResourceContents {
  uri: string
  mimeType?: string
  blob: string // base64 encoded
}

type ResourceContents = TextResourceContents | BlobResourceContents

const DEEPNOTE_EXTENSION = '.deepnote'

/**
 * List all .deepnote files in a directory recursively
 */
async function findDeepnoteFiles(dir: string, maxDepth = 3, currentDepth = 0): Promise<string[]> {
  if (currentDepth >= maxDepth) return []

  const files: string[] = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const subFiles = await findDeepnoteFiles(fullPath, maxDepth, currentDepth + 1)
        files.push(...subFiles)
      } else if (entry.isFile() && entry.name.endsWith(DEEPNOTE_EXTENSION)) {
        files.push(fullPath)
      }
    }
  } catch (error) {
    // Directory not accessible, skip but log for debugging
    // biome-ignore lint/suspicious/noConsole: Intentional debug logging to stderr
    console.error(`[deepnote-mcp] Could not scan directory ${dir}:`, error instanceof Error ? error.message : error)
  }

  return files
}

/**
 * Parse a deepnote:// URI and extract the path
 */
function parseDeepnoteUri(uri: string): { type: 'file' | 'examples' | 'workspace'; path?: string } {
  if (uri.startsWith('deepnote://examples')) {
    return { type: 'examples' }
  }
  if (uri.startsWith('deepnote://workspace')) {
    return { type: 'workspace' }
  }
  if (uri.startsWith('deepnote://file/')) {
    return { type: 'file', path: uri.slice('deepnote://file/'.length) }
  }
  return { type: 'file', path: uri.replace('deepnote://', '') }
}

/**
 * List available resources
 */
export async function listResources(workspaceRoot?: string): Promise<Resource[]> {
  const resources: Resource[] = []

  // Add examples resource
  resources.push({
    uri: 'deepnote://examples',
    name: 'Example Notebooks',
    description: 'Built-in example notebooks showing Deepnote features',
    mimeType: 'application/json',
  })

  // Add workspace resource if available
  if (workspaceRoot) {
    resources.push({
      uri: 'deepnote://workspace',
      name: 'Workspace Notebooks',
      description: 'All .deepnote files in the current workspace',
      mimeType: 'application/json',
    })

    // Also list individual notebooks in workspace
    const workspaceFiles = await findDeepnoteFiles(workspaceRoot)
    for (const file of workspaceFiles) {
      const relativePath = path.relative(workspaceRoot, file)
      const name = path.basename(file, DEEPNOTE_EXTENSION)
      const encodedFilePath = encodeURIComponent(file)

      resources.push({
        uri: `deepnote://file/${encodedFilePath}`,
        name,
        description: `Notebook: ${relativePath}`,
        mimeType: 'application/x-deepnote',
      })
    }
  }

  return resources
}

/**
 * Read a resource's contents
 */
export async function readResource(uri: string, workspaceRoot?: string): Promise<ResourceContents[]> {
  const parsed = parseDeepnoteUri(uri)

  if (parsed.type === 'examples') {
    // Return list of example notebooks
    // @ts-expect-error -- import.meta.url works at runtime (ESM bundle), but tsconfig uses commonjs for type-checking
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const examplesDir = path.resolve(currentDir, '../../../examples')
    const files = await findDeepnoteFiles(examplesDir, 1)

    const examples = await Promise.all(
      files.map(async file => {
        try {
          const content = await fs.readFile(file, 'utf-8')
          const deepnote = deserializeDeepnoteFile(content)
          return {
            name: path.basename(file, DEEPNOTE_EXTENSION),
            path: file,
            projectName: deepnote.project.name,
            notebooks: deepnote.project.notebooks.length,
            blocks: deepnote.project.notebooks.reduce((sum, n) => sum + n.blocks.length, 0),
          }
        } catch {
          return {
            name: path.basename(file, DEEPNOTE_EXTENSION),
            path: file,
            error: 'Could not parse',
          }
        }
      })
    )

    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ examples }, null, 2),
      },
    ]
  }

  if (parsed.type === 'workspace') {
    if (!workspaceRoot) {
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: 'No workspace root configured' }),
        },
      ]
    }

    const files = await findDeepnoteFiles(workspaceRoot)
    const notebooks = await Promise.all(
      files.map(async file => {
        try {
          const content = await fs.readFile(file, 'utf-8')
          const deepnote = deserializeDeepnoteFile(content)
          return {
            path: path.relative(workspaceRoot, file),
            projectName: deepnote.project.name,
            notebooks: deepnote.project.notebooks.length,
            blocks: deepnote.project.notebooks.reduce((sum, n) => sum + n.blocks.length, 0),
          }
        } catch {
          return {
            path: path.relative(workspaceRoot, file),
            error: 'Could not parse',
          }
        }
      })
    )

    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ workspaceRoot, notebooks }, null, 2),
      },
    ]
  }

  if (parsed.type === 'file' && parsed.path) {
    try {
      const decodedPath = decodeURIComponent(parsed.path)
      const normalizedPath = path.normalize(decodedPath)
      const resolvedPath = path.resolve(normalizedPath)

      if (workspaceRoot) {
        const resolvedWorkspaceRoot = path.resolve(path.normalize(workspaceRoot))
        const relative = path.relative(resolvedWorkspaceRoot, resolvedPath)
        const outsideWorkspace = relative.startsWith('..') || path.isAbsolute(relative)

        if (outsideWorkspace) {
          return [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'Access denied: path outside workspace root' }),
            },
          ]
        }
      }

      const content = await fs.readFile(resolvedPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)

      // Return structured summary of the notebook
      const summary = {
        path: resolvedPath,
        projectName: deepnote.project.name,
        projectId: deepnote.project.id,
        version: deepnote.version,
        metadata: deepnote.metadata,
        notebooks: deepnote.project.notebooks.map(n => ({
          name: n.name,
          id: n.id,
          isModule: n.isModule || false,
          blocks: n.blocks.map(b => ({
            id: b.id,
            type: b.type,
            contentPreview: b.content?.slice(0, 200) || '',
            hasMetadata: Object.keys(b.metadata || {}).length > 0,
          })),
        })),
      }

      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(summary, null, 2),
        },
      ]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: message }),
        },
      ]
    }
  }

  return [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: 'Unknown resource type' }),
    },
  ]
}
