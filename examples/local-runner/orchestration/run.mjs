import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In an installed app, import this from '@deepnote/local-runner'.
import { orchestrate } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '..', '..')

try {
  process.loadEnvFile()
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const target = process.env.DEEPNOTE_TOKEN ? 'cloud' : 'local'

const result = await orchestrate(
  async ({ run, outputs }) => {
    const sourceSteps = [
      {
        id: 'north-inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        inputs: { greeting: 'North America ready', count: 6, enabled: true },
      },
      {
        id: 'europe-inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        inputs: { greeting: 'Europe ready', count: 9, enabled: true },
      },
    ]

    // Ordinary JavaScript is the pipeline language. Local kernels can fan out freely. The first
    // cloud run is sequential so create-if-missing cannot race to create the same notebook twice.
    const [north, europe] =
      target === 'local'
        ? await Promise.all(sourceSteps.map(run))
        : [await run(sourceSteps[0]), await run(sourceSteps[1])]

    const notes = [outputs.allText(north).trim(), outputs.allText(europe).trim()].join('; ')

    // This notebook ends in an agent block. A missing model key becomes a failed step we can inspect
    // instead of losing the two successful preparation runs.
    const report = await run({
      id: 'executive-report',
      notebook: join(examples, 'local-runner-showcase.deepnote'),
      inputs: {
        report_title: 'Orchestrated sales review',
        region: 'All regions',
        trailing_months: 6,
        analyst_notes: notes,
      },
      allowFailure: true,
    })

    return {
      preparation: [north.id, europe.id],
      reportSucceeded: report.success,
      executiveReadout: report.success ? outputs.lastAgentText(report) : null,
      error: report.error,
      snapshotPath: report.snapshotPath,
    }
  },
  {
    defaultTarget: target,
    local: { persistSnapshot: false },
    onEvent(event) {
      if (event.type === 'step_started') {
        process.stdout.write(`→ ${event.stepId} (${event.target})\n`)
      } else if (event.type === 'step_completed') {
        process.stdout.write(`✓ ${event.stepId} in ${event.result.durationMs}ms\n`)
      } else if (event.type === 'step_failed') {
        process.stderr.write(`✗ ${event.stepId}: ${event.error}\n`)
      } else if (event.type === 'agent_event' && event.event.type === 'text_delta') {
        process.stdout.write(event.event.text)
      }
    },
  }
)

process.stdout.write(`\nExecution target: ${target}\n\nPipeline result:\n`)
process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`)
