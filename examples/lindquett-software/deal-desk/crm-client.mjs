// What a CRM, or any backend, does to get a renewal quote from the deal desk's "Renewal quote" notebook,
// the same notebook the Renewal deal desk app runs.
//
//   node examples/lindquett-software/deal-desk/crm-client.mjs ACC-1001 3 --local
//   DEEPNOTE_TOKEN=... NOTEBOOK_ID=... node examples/lindquett-software/deal-desk/crm-client.mjs ACC-1001 3
//
// With --local the notebook runs in a local kernel through `local/run.mjs`. Otherwise it runs in
// Deepnote through the runs API: start a detached run with the inputs, wait for it, and read the
// `quote` from the notebook's `application/json` outputs.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [accountId = 'ACC-1001', termYears = '1', ...flags] = process.argv.slice(2)
const inputs = { account_id: accountId, term_years: termYears }

function quoteFrom(blocks) {
  for (const block of blocks) {
    for (const output of block.outputs ?? []) {
      const quote = output.data?.['application/json']?.quote
      if (quote) return quote
    }
  }
  throw new Error('The notebook returned no quote')
}

function quoteLocally() {
  const run = join(dirname(fileURLToPath(import.meta.url)), '..', 'local', 'run.mjs')
  const args = Object.entries(inputs).flatMap(([name, value]) => ['--input', `${name}=${value}`])
  const result = spawnSync(process.execPath, [run, 'deal-desk', ...args, '-o', 'json'], { encoding: 'utf8' })
  const report = JSON.parse(result.stdout)
  if (!report.success) {
    const error = report.blocks.flatMap(block => block.outputs ?? []).find(output => output.output_type === 'error')
    throw new Error(error ? `${error.ename}: ${error.evalue}` : 'The notebook run failed')
  }
  return quoteFrom(report.blocks)
}

async function quoteInDeepnote() {
  const baseUrl = process.env.DEEPNOTE_API_URL ?? 'https://api.deepnote.com'
  const { DEEPNOTE_TOKEN: token, NOTEBOOK_ID: notebookId } = process.env
  if (!token || !notebookId) throw new Error('Set DEEPNOTE_TOKEN and NOTEBOOK_ID, or pass --local')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const start = await fetch(`${baseUrl}/v2/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notebookId, inputs, detachedRunStorageMode: 'readonly' }),
  })
  if (!start.ok) throw new Error(`Starting the run failed: ${start.status} ${await start.text()}`)
  const { runId } = await start.json()

  // Poll until the run ends and its outputs are stored. Outputs arrive a moment after the status.
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const response = await fetch(`${baseUrl}/v2/runs/${runId}?snapshotDelivery=blocks`, { headers })
    if (response.status === 429) continue
    if (!response.ok) throw new Error(`Reading run ${runId} failed: ${response.status}`)
    const { run } = await response.json()
    if (run.status === 'pending' || run.status === 'running') continue
    if (run.status !== 'success') throw new Error(run.error ?? `Run ${runId} ended with status ${run.status}`)
    if (run.snapshotStatus === 'pending') continue
    return quoteFrom(run.snapshotBlocks ?? [])
  }
  throw new Error(`Run ${runId} did not finish within five minutes`)
}

try {
  const quote = flags.includes('--local') ? quoteLocally() : await quoteInDeepnote()
  process.stdout.write(`${JSON.stringify(quote, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
