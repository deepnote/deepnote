// Stream a completion through the `claude` CLI and time it.
// The CLI stands in for whatever model client the product uses; we report
// time-to-first-token separately so CLI startup is not counted against the format.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const emptyCwd = mkdtempSync(join(tmpdir(), 'fast-apps-'))

/**
 * @param {{system: string, user: string, model?: string, effort?: string, onText?: (chunk: string, tMs: number) => void}} opts
 * @returns {Promise<{text: string, t: {spawn: 0, firstToken: number|null, done: number}, usage: object|null, apiMs: number|null}>}
 */
export function complete({ system, user, model = 'sonnet', effort = 'low', onText = () => {}, signal }) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const args = [
      '-p',
      '--model',
      model,
      '--effort',
      effort,
      '--system-prompt',
      system,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ]
    const child = spawn('claude', args, { cwd: emptyCwd, stdio: ['pipe', 'pipe', 'pipe'] })
    signal?.addEventListener('abort', () => child.kill())
    let buf = ''
    let text = ''
    let firstToken = null
    let usage = null
    let apiMs = null
    let stderr = ''
    child.stdout.on('data', chunk => {
      buf += chunk
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (
          msg.type === 'stream_event' &&
          msg.event?.type === 'content_block_delta' &&
          msg.event.delta?.type === 'text_delta'
        ) {
          const now = performance.now() - t0
          firstToken ??= now
          text += msg.event.delta.text
          onText(msg.event.delta.text, now)
        } else if (msg.type === 'result') {
          usage = msg.usage ?? null
          apiMs = msg.duration_api_ms ?? null
          if (!text && typeof msg.result === 'string') text = msg.result
        }
      }
    })
    child.stderr.on('data', d => {
      stderr += d
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0 && !text) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`))
      resolve({ text, t: { spawn: 0, firstToken, done: performance.now() - t0 }, usage, apiMs })
    })
    child.stdin.end(user)
  })
}

/** Split a text stream into complete lines as they arrive. */
export function lineSplitter(onLine) {
  let buf = ''
  return {
    push(chunk, tMs) {
      buf += chunk
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        onLine(buf.slice(0, nl), tMs)
        buf = buf.slice(nl + 1)
      }
    },
    end(tMs) {
      if (buf.trim()) onLine(buf, tMs)
      buf = ''
    },
  }
}

/**
 * complete() with a hedge: if no text has arrived after hedgeMs, start a second identical
 * request and keep whichever streams first (the other is cancelled). Cuts tail latency
 * from slow starts for the cost of an occasional duplicate request.
 */
export function completeHedged(opts, hedgeMs = 1500) {
  return new Promise((resolve, reject) => {
    let winner = null
    const runs = []
    const start = i => {
      const ac = new AbortController()
      const p = complete({
        ...opts,
        signal: ac.signal,
        onText: (chunk, t) => {
          if (winner == null) {
            winner = i
            for (const [j, r] of runs.entries()) if (j !== i) r.ac.abort()
          }
          if (winner === i) opts.onText?.(chunk, t)
        },
      })
      runs.push({ ac, p })
      p.then(
        r => {
          // The winner's result; or, if no run ever wrote text (an empty answer), the first to finish.
          if (winner === i || winner == null) {
            winner ??= i
            for (const [j, x] of runs.entries()) if (j !== i) x.ac.abort()
            resolve({ ...r, hedged: runs.length > 1, wonBy: i })
          }
        },
        e => {
          if (winner === i || (winner == null && runs.length === 1)) reject(e)
        }
      )
    }
    start(0)
    const timer = setTimeout(() => {
      if (winner == null && !opts.signal?.aborted) start(1)
    }, hedgeMs)
    opts.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      for (const r of runs) r.ac.abort()
    })
  })
}
