import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In an installed app, import this from '@deepnote/local-runner'.
import { definePipeline, defineRunPolicy, orchestrate } from '../../../packages/local-runner/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '..', '..')

try {
  process.loadEnvFile()
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const target = process.env.DEEPNOTE_TOKEN ? 'cloud' : 'local'
const persistenceFile = process.env.ORCHESTRATION_STATE_FILE

const regionalRunPolicy = defineRunPolicy({
  idempotent: true,
  retry: { maxAttempts: 2, initialDelayMs: 250, backoffMultiplier: 2 },
})

const prepareRegions = definePipeline({
  name: 'Regional preparation',
  async run({ runWithPolicy, control, outputs }, { sourceSteps, target }) {
    const execute = step => runWithPolicy(step, regionalRunPolicy)
    // Ordinary JavaScript is the pipeline language. Local kernels can fan out freely. The first
    // cloud run is sequential so create-if-missing cannot race to create the same notebook twice.
    const [north, europe] =
      target === 'local'
        ? await Promise.all(sourceSteps.map(execute))
        : [await execute(sourceSteps[0]), await execute(sourceSteps[1])]

    const notes = await control(
      {
        id: 'combine-notes',
        kind: 'join',
        label: 'Combine regional notes',
        dependsOn: [north.policyNodeId ?? north.id, europe.policyNodeId ?? europe.id],
      },
      () => [outputs.allText(north).trim(), outputs.allText(europe).trim()].join('; ')
    )
    return {
      notes,
      preparation: [north.policyNodeId ?? north.id, europe.policyNodeId ?? europe.id],
    }
  },
})

const result = await orchestrate(
  async ({ run, control, invoke, outputs }) => {
    await control({ id: 'inputs', label: 'Pipeline inputs' }, () => ({ regions: 2 }))
    const sourceSteps = [
      {
        id: 'north-inputs',
        label: 'North America inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        inputs: { greeting: 'North America ready', count: 6, enabled: true },
      },
      {
        id: 'europe-inputs',
        label: 'Europe inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        inputs: { greeting: 'Europe ready', count: 9, enabled: true },
      },
    ]
    const preparation = await invoke({
      id: 'regional-preparation',
      pipeline: prepareRegions,
      input: { sourceSteps, target },
      dependsOn: ['inputs'],
    })

    // This notebook ends in an agent block. A missing model key becomes a failed step we can inspect
    // instead of losing the two successful preparation runs.
    const report = await run({
      id: 'executive-report',
      label: 'Executive report',
      notebook: join(examples, 'local-runner-showcase.deepnote'),
      dependsOn: ['regional-preparation'],
      concluding: true,
      inputs: {
        report_title: 'Orchestrated sales review',
        region: 'All regions',
        trailing_months: 6,
        analyst_notes: preparation.notes,
      },
      allowFailure: true,
    })

    return {
      preparation: preparation.preparation,
      reportSucceeded: report.success,
      executiveReadout: report.success ? outputs.lastAgentText(report) : null,
      error: report.error,
      snapshotPath: report.snapshotPath,
    }
  },
  {
    defaultTarget: target,
    local: { persistSnapshot: false },
    ...(persistenceFile ? { persistence: { file: persistenceFile } } : {}),
    onEvent(event) {
      if (event.type === 'step_started') {
        process.stdout.write(`→ ${event.stepId} (${event.target})\n`)
      } else if (event.type === 'step_completed') {
        process.stdout.write(`✓ ${event.stepId} in ${event.result.durationMs}ms\n`)
      } else if (event.type === 'step_failed') {
        process.stderr.write(`✗ ${event.stepId}: ${event.error}\n`)
      } else if (event.type === 'agent_event' && event.event.type === 'text_delta') {
        process.stdout.write(event.event.text)
      } else if (event.type === 'control_completed') {
        process.stdout.write(`◆ ${event.node.label} in ${event.node.durationMs}ms\n`)
      } else if (event.type === 'pipeline_completed') {
        process.stdout.write(`◇ ${event.node.label} in ${event.node.durationMs}ms\n`)
      }
    },
  }
)

process.stdout.write(`\nExecution target: ${target}\n\nPipeline result:\n`)
process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`)
process.stdout.write(`\nCaptured graph:\n${JSON.stringify(result.graph, null, 2)}\n`)
