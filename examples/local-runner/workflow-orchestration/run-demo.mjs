const baseUrl = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000'
const timeoutMs = Number(process.env.DEMO_TIMEOUT_MS ?? 10 * 60 * 1000)

process.stdout.write(`
Deepnote durable decision pipeline
──────────────────────────────────
Scenario: 10% demand contraction
Injected incident: Asia Pacific source failure
Quality gate: 95%

Starting workflow...
`)

const started = await request('/api/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    demandShockPct: -10,
    qualityThreshold: 0.95,
    simulateFailureRegion: 'Asia Pacific',
  }),
})

process.stdout.write(`Run ID: ${started.runId}\n`)
process.stdout.write(
  'Watch the durable timeline: pnpm --filter @deepnote/example-workflow-orchestration exec workflow web\n\n'
)

const deadline = Date.now() + timeoutMs
let previousStatus
let completed
while (Date.now() < deadline) {
  const current = await request(started.statusUrl)
  if (current.status !== previousStatus) {
    process.stdout.write(`Workflow status: ${current.status}\n`)
    previousStatus = current.status
  } else {
    process.stdout.write('.')
  }

  if (current.status === 'completed') {
    completed = current.result
    break
  }
  if (current.status === 'failed' || current.status === 'cancelled') {
    throw new Error(`Workflow finished with status "${current.status}"${current.error ? `: ${current.error}` : '.'}`)
  }
  await delay(2_000)
}

if (!completed) {
  throw new Error(`Workflow did not complete within ${timeoutMs}ms.`)
}

const { workflowValue, portfolio } = completed
process.stdout.write(`

Why orchestration mattered
──────────────────────────
Regional analyses started: ${portfolio.regions.length}
Parallel fan-out branches: ${workflowValue.fanOut}
Failures contained:        ${list(workflowValue.initialFailures)}
Quality gates triggered:   ${list(workflowValue.qualityGateFailures)}
Regions recovered:         ${list(workflowValue.recoveredRegions)}
Durable notebook runs:     ${workflowValue.notebookRuns}
Agent completed:           ${workflowValue.agentCompleted ? 'yes' : 'no'}

Decision
────────
${completed.decision.toUpperCase()}
Forecast: ${money(portfolio.totals.forecastK)}
Target:   ${money(portfolio.totals.targetK)}
Variance: ${money(portfolio.totals.varianceK)}

Executive readout
─────────────────
${completed.executiveReadout ?? completed.reportError ?? 'No agent readout was produced.'}

Deepnote report: ${completed.reportViewUrl ?? 'not available'}
Workflow run:    ${started.runId}
`)

async function request(path, options) {
  const response = await fetch(new URL(path, baseUrl), options)
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`Request to ${path} failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return body
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function list(values) {
  return values.length > 0 ? values.join(', ') : 'none'
}

function money(value) {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString()}k`
}
