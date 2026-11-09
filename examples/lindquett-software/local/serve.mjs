// Local preview of the "Revenue review" app in the Lindquett Software project.
//
//   pnpm example:lindquett      (from the repository root; builds the packages first)
//
// Builds a local copy of the app notebook with its module blocks replaced (see build.mjs), then
// serves an app-style page that runs it in a local deepnote-toolkit kernel. Put the agent block's
// key in `local/.env`: ANTHROPIC_API_KEY (default model claude-sonnet-5-5) or OPENAI_API_KEY.
// Without a key the dashboard still renders and only the agent block reports an error.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { serveStatic } from '@deepnote/local-runner'`.
import { serveStatic } from '../../../packages/local-runner/dist/index.js'
import { buildLocal } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
try {
  process.loadEnvFile(join(here, '.env'))
} catch {}

const agentModel = process.env.PREVIEW_AGENT_MODEL ?? (process.env.ANTHROPIC_API_KEY ? 'claude-sonnet-5-5' : undefined)
const keyVar = (agentModel ?? '').startsWith('claude-') ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'

const buildDir = join(here, 'build')
mkdirSync(buildDir, { recursive: true })
const notebookPath = join(buildDir, 'revenue-review.deepnote')
const info = buildLocal(join(here, '..', 'lindquett.deepnote'), notebookPath, {
  notebook: 'Revenue review',
  agentModel,
})

// The page shows the last run on load, like the app setting "Show last run results".
const snapshotsDir = join(buildDir, 'snapshots')
const latest = existsSync(snapshotsDir)
  ? readdirSync(snapshotsDir).find(name => name.includes(info.notebookId) && name.endsWith('_latest.snapshot.deepnote'))
  : undefined
writeFileSync(
  join(buildDir, 'preview.json'),
  JSON.stringify(
    {
      ...info,
      notebookFile: 'build/revenue-review.deepnote',
      latestSnapshot: latest ? `build/snapshots/${latest}` : null,
      agent: { model: agentModel ?? 'auto', keyVar, keySet: Boolean(process.env[keyVar]) },
    },
    null,
    2
  )
)

const { port } = await serveStatic({
  dir: here,
  notebookPath,
  runTarget: 'local',
  persistSnapshot: true,
  port: Number(process.env.PORT ?? 4747),
})

console.log(`\n  Lindquett Software · revenue review app → http://127.0.0.1:${port}`)
console.log(`  Agent block: ${agentModel ?? 'auto'} · ${keyVar} ${process.env[keyVar] ? '✓' : '— not set'}\n`)
