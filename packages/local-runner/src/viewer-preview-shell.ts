import { TOKEN_REQUEST_MESSAGE, TOKEN_RESPONSE_MESSAGE } from '@deepnote/app-client'
import type { PreviewMode, TokenSource } from './viewer-preview'

interface ShellConfig {
  appOrigin: string
  mode: PreviewMode
  tokenSource: TokenSource | null
  tokenTtlSeconds: number
}

/**
 * The local stand-in for the Deepnote page that embeds a published app. It answers the app's token
 * handshake exactly as Deepnote does — same message types, pinned origins, silence when API access is
 * off — and adds what Deepnote can't: controls to expire or revoke the token, and a log of API calls.
 */
export function renderPreviewShell(config: ShellConfig): string {
  const script = JSON.stringify({
    ...config,
    requestType: TOKEN_REQUEST_MESSAGE,
    responseType: TOKEN_RESPONSE_MESSAGE,
  }).replace(/</g, '\\u003c')
  const modeLabel = config.mode === 'viewer' ? 'Viewer preview' : 'Author preview'
  const modeHint =
    config.tokenSource === 'deepnote'
      ? 'The app has a real viewer token from Deepnote, which decides what it may do.'
      : config.tokenSource === 'simulated'
        ? 'Viewer token simulated locally from @deepnote/app-client’s scope. Pass --project-id for a real one.'
        : 'Every API call runs with your personal token. Viewers of the published app will not have this access.'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${modeLabel} · Deepnote app</title>
<style>
  :root { color-scheme: light dark; --line: #e4e3ec; --ink: #1b1a24; --dim: #6c6a7c; --bg: #f7f7fa; --accent: #5b3df5; --warn: #b35c00; --bad: #c23652; }
  @media (prefers-color-scheme: dark) { :root { --line: #2b2838; --ink: #ece9f7; --dim: #9a97ad; --bg: #121019; --accent: #a78bfa; --warn: #f0a050; --bad: #ff6b86; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font: 13px/1.4 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  body { display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .mode { font-weight: 650; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .mode.author { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
  .hint { color: var(--dim); }
  .spacer { flex: 1; }
  button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  #token { color: var(--dim); font-variant-numeric: tabular-nums; }
  iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: #fff; }
  footer { flex: none; border-top: 1px solid var(--line); max-height: 30vh; overflow: auto; }
  footer summary { padding: 6px 14px; cursor: pointer; color: var(--dim); }
  table { width: 100%; border-collapse: collapse; font: 12px ui-monospace, monospace; }
  td { padding: 3px 14px; border-top: 1px solid var(--line); white-space: nowrap; }
  td.msg { white-space: normal; color: var(--dim); }
  tr.denied td, tr.unauthorized td { color: var(--bad); }
  tr.failed td { color: var(--warn); }
  tr.mismatch td { background: color-mix(in srgb, var(--warn) 14%, transparent); }
  #mint-error { color: var(--bad); padding: 6px 14px; border-bottom: 1px solid var(--line); }
  #mint-error[hidden] { display: none; }
</style>
</head>
<body>
<header>
  <span class="mode ${config.mode}">${modeLabel}</span>
  <span class="hint">${modeHint}</span>
  <span class="spacer"></span>
  <span id="token">No token issued</span>
  <button id="expire" type="button" title="Expire every token issued so far; the app's next call gets a 401">Expire token</button>
  <button id="revoke" type="button" title="Stop answering the token handshake, like Deepnote with API access disabled">Revoke access</button>
</header>
<div id="mint-error" hidden></div>
<iframe id="app" title="App"></iframe>
<footer>
  <details id="log-panel">
    <summary id="log-summary">API calls</summary>
    <table><tbody id="log"></tbody></table>
  </details>
</footer>
<script type="module">
  const CONFIG = ${script}
  const frame = document.getElementById('app')
  const tokenLabel = document.getElementById('token')
  const revokeButton = document.getElementById('revoke')
  let expiresAtSeconds = null
  let revoked = false
  let pending = null

  // The app gets this page's query string, plus the shell origin it must pin.
  const src = new URL('/', CONFIG.appOrigin)
  for (const [key, value] of new URLSearchParams(location.search)) src.searchParams.set(key, value)
  src.searchParams.set('shellOrigin', location.origin)
  frame.src = src.href

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== CONFIG.appOrigin) return
    if (event.data?.type !== CONFIG.requestType) return
    // Revoked: stay silent without asking, which is what Deepnote does when the project's API access is off.
    if (revoked) return
    // The app asks every few hundred milliseconds until answered; one mint serves the burst.
    pending ??= fetch('/__preview/token', { method: 'POST' })
      .then((response) => (response.ok ? response.json() : null))
      .finally(() => { pending = null })
    pending.then((credential) => {
      // Refused: stay silent, as Deepnote does.
      if (!credential) return
      expiresAtSeconds = credential.expiresAtSeconds
      frame.contentWindow.postMessage({ type: CONFIG.responseType, ...credential }, CONFIG.appOrigin)
    })
  })

  document.getElementById('expire').onclick = () => post('/__preview/expire').then(() => { expiresAtSeconds = 0 })
  revokeButton.onclick = () => post(revoked ? '/__preview/restore' : '/__preview/revoke').then(refresh)

  function post(path) { return fetch(path, { method: 'POST' }) }

  setInterval(() => {
    if (revoked) { tokenLabel.textContent = 'Access revoked'; return }
    if (expiresAtSeconds === null) return
    const left = Math.round(expiresAtSeconds - Date.now() / 1000)
    tokenLabel.textContent = left > 0 ? 'Token expires in ' + Math.floor(left / 60) + 'm ' + (left % 60) + 's' : 'Token expired'
  }, 1000)

  async function refresh() {
    const state = await fetch('/__preview/state').then((response) => response.json()).catch(() => null)
    if (!state) return
    revoked = state.revoked
    revokeButton.textContent = revoked ? 'Restore access' : 'Revoke access'
    const mintError = document.getElementById('mint-error')
    mintError.hidden = !state.lastMintError
    mintError.textContent = state.lastMintError ?? ''
    const rows = state.events.slice().reverse()
    const denied = rows.filter((event) => event.outcome === 'denied' || event.outcome === 'unauthorized').length
    document.getElementById('log-summary').textContent =
      'API calls (' + rows.length + (denied ? ', ' + denied + ' refused' : '') + ')'
    if (denied) document.getElementById('log-panel').open = true
    const body = document.getElementById('log')
    body.replaceChildren(...rows.map((event) => {
      const row = document.createElement('tr')
      row.className = event.outcome + (event.scopeMismatch ? ' mismatch' : '')
      for (const text of [event.at.slice(11, 19), event.method, event.path, String(event.status), event.outcome, event.message ?? '']) {
        const cell = document.createElement('td')
        cell.textContent = text
        row.append(cell)
      }
      row.lastChild.className = 'msg'
      return row
    }))
  }
  refresh()
  setInterval(refresh, 1000)
</script>
</body>
</html>
`
}
