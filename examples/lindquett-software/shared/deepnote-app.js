// Runs this app's notebook and hands back its JSON output, the same way on your machine and in Deepnote.
//
// - Locally, `local/serve.mjs` serves the page with `serveStatic` from @deepnote/local-runner, and
//   `POST /api/run` runs the notebook in a local kernel.
// - Published as a data app, the page runs inside Deepnote. It asks the Deepnote shell for a short-lived
//   viewer token over postMessage, starts a run with the runs API and polls it for the run's
//   `snapshotBlocks`. The token can only read inputs, start runs and read the viewer's own runs.
//
// Either way the notebook's `application/json` outputs are merged into one object, so a notebook can
// return its data in several outputs (the agent's note arrives in its own).

const SHELL_ORIGIN = 'https://deepnote.com'
const embedded = window !== window.parent

/** The notebook this page runs in Deepnote, from `<meta name="deepnote-notebook-id">`. */
function notebookId() {
  const id = document.querySelector('meta[name="deepnote-notebook-id"]')?.content
  if (!id) throw new Error('Set <meta name="deepnote-notebook-id"> to the ID of the notebook this app runs.')
  return id
}

let credential = null

function requestToken() {
  return new Promise(resolve => {
    let done = null
    function onMessage(event) {
      // Only believe a token from the frame we asked, on the origin we expect.
      if (event.source !== window.parent || event.origin !== SHELL_ORIGIN) return
      if (event.data?.type !== 'deepnote-static-files-api-token-response') return
      const { token, apiOrigin, expiresAtSeconds } = event.data
      if (!token || !apiOrigin || !Number.isFinite(expiresAtSeconds)) return
      try {
        done({ token, apiOrigin: new URL(apiOrigin).origin, expiresAtSeconds })
      } catch {
        // An origin that doesn't parse is not a credential.
      }
    }
    window.addEventListener('message', onMessage)
    // The shell may register its listener after this page loads, so keep asking until it answers.
    const ask = () => window.parent.postMessage({ type: 'deepnote-static-files-api-token-request' }, SHELL_ORIGIN)
    const retry = setInterval(ask, 400)
    done = value => {
      clearInterval(retry)
      window.removeEventListener('message', onMessage)
      void resolve(value)
    }
    ask()
    setTimeout(() => done(null), 8000)
  })
}

async function api(path, options = {}) {
  if (!credential || credential.expiresAtSeconds - Date.now() / 1000 < 60) credential = await requestToken()
  if (!credential) throw new Error('Deepnote did not provide an API token. Open the app from Deepnote.')
  const send = () =>
    fetch(`${credential.apiOrigin}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.token}` },
    })
  let response = await send()
  if (response.status === 401) {
    credential = await requestToken()
    if (credential) response = await send()
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message ?? `Deepnote answered ${response.status}`)
  }
  return response.json()
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function runInDeepnote(inputs) {
  const started = await api('/v2/runs', { method: 'POST', body: JSON.stringify({ notebookId: notebookId(), inputs }) })
  const runId = (started.run ?? started).runId ?? (started.run ?? started).id
  const terminal = new Set(['success', 'error', 'internal_error', 'stopped'])
  for (let wait = 1500; ; wait = Math.min(wait * 1.3, 8000)) {
    await sleep(wait)
    const run = (await api(`/v2/runs/${encodeURIComponent(runId)}?snapshotDelivery=inline`)).run
    if (!terminal.has(run.status)) continue
    // Outputs are attached a moment after the run ends.
    if (!run.snapshotBlocks && run.snapshotStatus === 'pending') continue
    return { outputs: (run.snapshotBlocks ?? []).flatMap(block => block.outputs ?? []), runError: run.error }
  }
}

async function runLocally(inputs) {
  const response = await fetch('api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `The local runner answered ${response.status}`)
  return { outputs: (body.outputs ?? []).flatMap(block => block.outputs ?? []) }
}

/**
 * Run the notebook with `inputs` (strings and booleans, as input blocks hold them).
 *
 * @returns {Promise<{ data: Record<string, unknown>, error: string | null }>} the merged JSON outputs,
 *   and the first error, if a block failed. Outputs from blocks that ran before the failure are kept.
 */
export async function runNotebook(inputs) {
  const { outputs, runError } = embedded ? await runInDeepnote(inputs) : await runLocally(inputs)
  const data = {}
  let error = null
  for (const output of outputs) {
    const json = output.data?.['application/json']
    if (json && typeof json === 'object') Object.assign(data, json)
    if (output.output_type === 'error' && !error) error = `${output.ename}: ${output.evalue}`
  }
  if (!error && runError) error = typeof runError === 'string' ? runError : (runError.message ?? 'The run failed')
  return { data, error }
}

export const where = embedded ? 'deepnote' : 'local'
