import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { scheduleInCloud } from '@deepnote/local-runner'`.
import { scheduleInCloud } from '../../packages/local-runner/dist/index.js'

try {
  process.loadEnvFile()
} catch {}

const here = dirname(fileURLToPath(import.meta.url))
const notebookPath = join(here, '..', 'scheduled-cloud-run.deepnote')
const cron = process.env.DEEPNOTE_SCHEDULE_CRON ?? '0 9 * * 1-5'
const timezone = process.env.DEEPNOTE_SCHEDULE_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'

const result = await scheduleInCloud(notebookPath, cron, {
  token: process.env.DEEPNOTE_TOKEN,
  timezone,
  onCreateProgress: (created, total) => {
    // biome-ignore lint/suspicious/noConsole: This one-shot example reports create progress.
    console.log(`Creating cloud notebook: ${created}/${total} blocks`)
  },
})

// biome-ignore lint/suspicious/noConsole: This one-shot example prints its useful result.
console.log(`Scheduled "${result.schedule.notebookId}" with ${result.schedule.cron} (${result.schedule.timezone})`)
// biome-ignore lint/suspicious/noConsole: This one-shot example prints its useful result.
console.log(`Next run: ${result.schedule.nextRunAt}`)
if (result.viewUrl) {
  // biome-ignore lint/suspicious/noConsole: This one-shot example prints its useful result.
  console.log(`Open in Deepnote: ${result.viewUrl}`)
}
