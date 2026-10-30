// Compares VIEWER_SCOPE with Deepnote's published OpenAPI document. Run after building the package:
//   pnpm --filter @deepnote/app-client build && node packages/app-client/scripts/check-hosted-scope.mjs
// Exits 1 on errors (a route VIEWER_SCOPE or the preview relies on is gone); warnings do not fail.
import { checkHostedViewerScope } from '../dist/index.js'

const apiUrl = (process.env.DEEPNOTE_API_URL ?? 'https://api.deepnote.com').replace(/\/+$/, '')
const response = await fetch(`${apiUrl}/v2/openapi.json`)
if (!response.ok) {
  process.stderr.write(`Could not fetch ${apiUrl}/v2/openapi.json: HTTP ${response.status}\n`)
  process.exit(1)
}
const { errors, warnings } = checkHostedViewerScope(await response.json())
for (const warning of warnings) process.stdout.write(`::warning::${warning}\n`)
for (const error of errors) process.stdout.write(`::error::${error}\n`)
const summary =
  errors.length > 0
    ? `VIEWER_SCOPE has drifted from ${apiUrl}`
    : warnings.length > 0
      ? `Every route VIEWER_SCOPE and the preview use exists on ${apiUrl}; see the warnings above`
      : `VIEWER_SCOPE matches ${apiUrl}`
process.stdout.write(`${summary}\n`)
process.exit(errors.length === 0 ? 0 : 1)
