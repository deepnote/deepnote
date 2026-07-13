import type { SnapshotBlock, SnapshotView } from './snapshot-view'
import { parseSnapshot } from './snapshot-view'

/**
 * A browser viewer for a `.deepnote` snapshot: fetch the file, parse it, render the blocks and
 * their outputs. No server, no Python, no kernel — a snapshot already contains the outputs.
 */

export interface MountOptions {
  /** Snapshot to load, relative to the page. Defaults to `./snapshot.deepnote`. */
  src?: string
}

/**
 * Render the snapshot at `options.src` into `container`.
 *
 * If the snapshot cannot be fetched — most commonly because the page was opened via `file://`,
 * where browsers block `fetch` of sibling files — a file picker is shown instead, so the viewer
 * still works without a web server.
 */
export async function mountSnapshotViewer(container: HTMLElement, options: MountOptions = {}): Promise<void> {
  const src = options.src ?? './snapshot.deepnote'

  try {
    const response = await fetch(src)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    renderSnapshot(container, parseSnapshot(await response.text()))
  } catch {
    renderFilePicker(container, src)
  }
}

/** Render an already-parsed snapshot. */
export function renderSnapshot(container: HTMLElement, view: SnapshotView): void {
  container.textContent = ''
  container.append(header(view))

  for (const notebook of view.notebooks) {
    if (view.notebooks.length > 1) {
      container.append(el('h2', 'dn-notebook', notebook.name))
    }
    for (const block of notebook.blocks) {
      const rendered = renderBlock(block)
      if (rendered) {
        container.append(rendered)
      }
    }
  }
}

function header(view: SnapshotView): HTMLElement {
  const wrap = el('header', 'dn-header')
  wrap.append(el('h1', 'dn-title', view.projectName))
  if (view.finishedAt) {
    wrap.append(el('p', 'dn-meta', `Run finished ${view.finishedAt}`))
  }
  return wrap
}

function renderBlock(block: SnapshotBlock): HTMLElement | null {
  // An input block has no output of its own, but its value is what produced everything below it.
  if (block.input) {
    const wrap = el('div', 'dn-block dn-input')
    wrap.append(el('code', 'dn-input-value', `${block.input.name} = ${JSON.stringify(block.input.value)}`))
    return wrap
  }

  const hasSource = block.content.trim() !== ''
  if (!hasSource && block.outputs.length === 0) {
    return null
  }

  const wrap = el('div', `dn-block dn-${block.type}`)

  if (hasSource) {
    if (block.type === 'markdown' || block.type === 'text') {
      // Kept as text rather than rendered: rendering markdown would mean shipping a markdown
      // parser (and its HTML) into the page, for a viewer whose job is showing outputs.
      wrap.append(el('div', 'dn-markdown', block.content))
    } else {
      const pre = el('pre', 'dn-source')
      pre.append(el('code', '', block.content))
      wrap.append(pre)
    }
  }

  for (const output of block.outputs) {
    const rendered = renderOutput(output as Record<string, unknown>)
    if (rendered) {
      wrap.append(rendered)
    }
  }

  return wrap
}

function renderOutput(output: Record<string, unknown>): HTMLElement | null {
  const type = output.output_type

  if (type === 'stream') {
    return el('pre', 'dn-output dn-stream', joinText(output.text))
  }

  if (type === 'error') {
    const traceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : ''
    const text = traceback.trim() !== '' ? traceback : `${String(output.ename)}: ${String(output.evalue)}`
    // Tracebacks carry ANSI color codes; strip them rather than print the escapes.
    return el('pre', 'dn-output dn-error', stripAnsi(text))
  }

  if (type !== 'display_data' && type !== 'execute_result') {
    return null
  }

  const data = (output.data ?? {}) as Record<string, unknown>

  for (const mime of ['image/png', 'image/jpeg', 'image/gif'] as const) {
    if (data[mime]) {
      const img = document.createElement('img')
      img.className = 'dn-output dn-image'
      img.src = `data:${mime};base64,${joinText(data[mime]).replace(/\s+/g, '')}`
      return img
    }
  }

  if (data['image/svg+xml']) {
    return sandbox(joinText(data['image/svg+xml']))
  }

  if (data['text/html']) {
    // Notebook HTML (pandas tables, chart embeds) is rendered in a sandboxed iframe with scripts
    // disabled, NOT injected with innerHTML. This page is meant to be shared, so a snapshot must
    // not be able to run script in the context of whoever opens it.
    return sandbox(joinText(data['text/html']))
  }

  if (data['text/plain']) {
    return el('pre', 'dn-output dn-text', joinText(data['text/plain']))
  }

  return null
}

/** Render untrusted notebook HTML in a script-less, origin-less iframe. */
function sandbox(html: string): HTMLElement {
  const frame = document.createElement('iframe')
  frame.className = 'dn-output dn-html'
  frame.setAttribute('sandbox', '')
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px system-ui,sans-serif}table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 8px}</style>${html}`
  return frame
}

function renderFilePicker(container: HTMLElement, src: string): void {
  container.textContent = ''
  const wrap = el('div', 'dn-picker')
  wrap.append(
    el(
      'p',
      '',
      `Could not load ${src}. Browsers block reading local files from file:// — serve this directory over HTTP, or choose the snapshot below.`
    )
  )

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.deepnote,.yaml,.yml'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (file) {
      renderSnapshot(container, parseSnapshot(await file.text()))
    }
  })

  wrap.append(input)
  container.append(wrap)
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

/** Jupyter output text is either a string or an array of lines. */
function joinText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join('')
  }
  return typeof value === 'string' ? value : ''
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes requires ESC (\x1b).
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}
