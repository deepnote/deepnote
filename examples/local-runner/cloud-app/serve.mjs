// Previews the app the way Deepnote embeds it: as a viewer, with a short-lived viewer token and only
// the API calls a published app may make. Same thing as `deepnote publish <dir> --preview`.
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { serveViewerPreview } from '@deepnote/local-runner'` after installing it.
// This example isn't a workspace package, so it imports the built package directly.
import { serveViewerPreview } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

try {
  process.loadEnvFile()
} catch {}

const token = process.env.DEEPNOTE_TOKEN?.trim()
if (!token) {
  console.error('Set DEEPNOTE_TOKEN (or put it in .env): the preview forwards viewer calls to Deepnote with it.')
  process.exit(2)
}

// The page loads the client from next to itself, exactly as it will once published.
await copyFile(
  join(here, '..', '..', '..', 'packages', 'app-client', 'dist', 'app-client.iife.js'),
  join(here, 'app-client.js')
)

// With PROJECT_ID, Deepnote mints a real viewer token for that project (its app sharing and API access
// must be enabled). Without it, the viewer token is simulated locally.
const preview = await serveViewerPreview({
  dir: here,
  token,
  projectId: process.env.PROJECT_ID,
  apiUrl: process.env.DEEPNOTE_API_URL,
  tokenTtlSeconds: process.env.TOKEN_TTL ? Number(process.env.TOKEN_TTL) : undefined,
})
const notebookId = process.env.NOTEBOOK_ID
console.log(
  `\n  Deepnote app (viewer preview, ${preview.tokenSource} token) → ${preview.url}${notebookId ? `?notebookId=${encodeURIComponent(notebookId)}` : '?notebookId=<your-notebook-id>'}\n`
)
