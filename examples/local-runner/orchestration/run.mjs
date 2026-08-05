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

// Cloud when a token is present, unless ORCHESTRATION_TARGET says otherwise. The override keeps a
// local run reachable on a machine that has a token in `.env`.
const target = process.env.ORCHESTRATION_TARGET || (process.env.DEEPNOTE_TOKEN ? 'cloud' : 'local')

/**
 * Retry a notebook step, as ordinary control flow.
 *
 * Only worth doing for a step you know is safe to repeat — these notebooks just compute, so a second
 * attempt costs nothing. A notebook that writes to a warehouse or spends an agent budget is not
 * safe to retry blindly, which is why this is a decision at the call site rather than a flag.
 *
 * Under Workflow SDK the identical loop is durable: each attempt is a recorded step, so a crash
 * resumes at the attempt it reached instead of starting the notebook again.
 */
async function runWithRetry(run, step, { attempts = 2, delayMs = 250 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt === attempts
    try {
      const result = await run({
        ...step,
        id: attempts > 1 ? `${step.id}-attempt-${attempt}` : step.id,
        label: attempts > 1 ? `${step.label ?? step.id} · attempt ${attempt}/${attempts}` : step.label,
        dependsOn: attempt === 1 ? step.dependsOn : [{ id: `${step.id}-attempt-${attempt - 1}`, label: 'retry' }],
        // Hold a failure so this loop can decide, except on the final attempt, where the caller's
        // own `allowFailure` applies.
        allowFailure: last ? step.allowFailure : true,
      })
      if (result.success || last) return result
    } catch (error) {
      // Two distinct failures reach this loop, and both are worth retrying here. A notebook that
      // ran and failed comes back as `success: false` above. Infrastructure that never got the
      // notebook running — no Python environment, a dead toolkit server, an unreadable API
      // response — throws instead, and always throws, whatever `allowFailure` says.
      if (last) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delayMs * attempt))
  }
}

/**
 * A reusable sub-pipeline is just a function that takes the orchestration context.
 *
 * Callers scope child IDs by passing a prefix, so the component composes without collisions — and
 * it stays ordinary code you can read, test, and call directly.
 */
async function prepareRegions({ run, control, outputs }, { sourceSteps, target, prefix }) {
  const id = suffix => `${prefix}/${suffix}`
  // Local kernels each start their own toolkit server and can race for a port, so one retry keeps
  // the fan-out reliable. The first cloud run stays sequential so create-if-missing cannot race to
  // create the same notebook twice.
  const execute = step => runWithRetry(run, { ...step, id: id(step.id) })
  const [north, europe] =
    target === 'local'
      ? await Promise.all(sourceSteps.map(execute))
      : [await execute(sourceSteps[0]), await execute(sourceSteps[1])]

  const notes = await control(
    {
      id: id('combine-notes'),
      kind: 'join',
      label: 'Combine regional notes',
      dependsOn: [north.id, europe.id],
    },
    () => [outputs.allText(north).trim(), outputs.allText(europe).trim()].join('; ')
  )
  return { notes, preparation: [north.id, europe.id] }
}

const result = await orchestrate(
  async context => {
    const { run, outputs, control } = context
    await control({ id: 'inputs', label: 'Pipeline inputs' }, () => ({ regions: 2 }))
    const sourceSteps = [
      {
        id: 'north-inputs',
        label: 'North America inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        dependsOn: ['inputs'],
        inputs: { greeting: 'North America ready', count: 6, enabled: true },
      },
      {
        id: 'europe-inputs',
        label: 'Europe inputs',
        notebook: join(examples, '6_with_inputs.deepnote'),
        dependsOn: ['inputs'],
        inputs: { greeting: 'Europe ready', count: 9, enabled: true },
      },
    ]
    const preparation = await prepareRegions(context, {
      sourceSteps,
      target,
      prefix: 'regional-preparation',
    })

    // This notebook ends in an agent block. A missing model key becomes a failed step we can inspect
    // instead of losing the two successful preparation runs.
    const report = await run({
      id: 'executive-report',
      label: 'Executive report',
      notebook: join(examples, 'local-runner-showcase.deepnote'),
      dependsOn: preparation.preparation,
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
      }
    },
  }
)

process.stdout.write(`\nExecution target: ${target}\n\nPipeline result:\n`)
process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`)
process.stdout.write(`\nCaptured graph:\n${JSON.stringify(result.graph, null, 2)}\n`)
