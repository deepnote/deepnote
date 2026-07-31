// Shared reading helpers for the four gallery pages.
//
// This is page code, not library code: `@deepnote/local-runner` hands you a parsed `SnapshotView`
// and stops there, deliberately — what a snapshot should *look* like is the page's business. But
// four pages independently re-deriving "which output holds the dataframe" would drift, and the
// fiddly bits below (nbformat's string-or-array values, base64 whitespace) are easy to get subtly
// wrong. So: finding things lives here, showing things lives in each page.
//
// Everything here is defensive on purpose. A snapshot is a file someone else's notebook produced;
// blocks may be missing, stats may be absent, and no page should white-screen because of it.

/** nbformat lets a text/MIME value be a string *or* an array of strings. Both mean one string. */
export const joinText = t => (Array.isArray(t) ? t.join('') : (t ?? ''))

/** An input value may be a string, a bool, a numeric-looking string, or an array (date range). */
export const fmtValue = v => {
  if (Array.isArray(v)) return v.join(' → ')
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v ?? '')
}

export const firstNotebook = view => view?.notebooks?.[0] ?? { name: '', blocks: [] }

/** Every output of every block, flattened — most lookups here are "find the one that has X". */
const allOutputs = view => firstNotebook(view).blocks.flatMap(b => b.outputs ?? [])

/** The first output carrying `mime`, whatever block it came from. */
export const outputsByMime = (view, mime) => allOutputs(view).filter(o => o?.data?.[mime] !== undefined)

/**
 * The run's dataframe, or null.
 *
 * Found by MIME rather than by block position: which block happens to emit the table is the
 * notebook's business and could change tomorrow. Null is a normal answer — a snapshot need not
 * contain a dataframe at all — so callers show an empty state rather than throwing.
 */
export function findDataframe(view) {
  const output = outputsByMime(view, 'application/vnd.deepnote.dataframe.v3+json')[0]
  const df = output?.data?.['application/vnd.deepnote.dataframe.v3+json']
  if (!df || !Array.isArray(df.columns) || !Array.isArray(df.rows)) return null
  return df
}

/** The row label column pandas writes for the index — the region names here, not a real column. */
export const INDEX_COLUMN = '_deepnote_index_column'

/** Data columns, i.e. everything the user would call a column. */
export const dataColumns = df => df.columns.filter(c => c.name !== INDEX_COLUMN)

/** A row's label (its index value), or ''. */
export const rowLabel = row => String(row?.[INDEX_COLUMN] ?? '')

/** The first PNG in the run, as a data URI, or null. Base64 arrives folded across YAML lines. */
export function findImage(view) {
  const png = outputsByMime(view, 'image/png')[0]?.data?.['image/png']
  return png ? `data:image/png;base64,${joinText(png).replace(/\s+/g, '')}` : null
}

/** The agent block's readout. It writes a stream locally and display_data in the cloud — take both. */
export function agentText(view) {
  const agent = firstNotebook(view).blocks.find(b => b.type === 'agent')
  if (!agent) return ''
  return agent.outputs
    .map(o =>
      o.output_type === 'stream' ? joinText(o.text) : joinText(o.data?.['text/markdown'] ?? o.data?.['text/plain'])
    )
    .join('')
    .trim()
}

/** The values this run actually executed with, in document order. */
export const inputs = view =>
  firstNotebook(view)
    .blocks.filter(b => b.input)
    .map(b => ({ type: b.type, ...b.input }))

/** One input's value by variable name, or undefined. */
export const inputValue = (view, name) => inputs(view).find(i => i.name === name)?.value

/** stdout across the run, minus the agent's own readout (which pages show separately). */
export function streamText(view) {
  return firstNotebook(view)
    .blocks.filter(b => b.type !== 'agent')
    .flatMap(b => b.outputs ?? [])
    .filter(o => o.output_type === 'stream')
    .map(o => joinText(o.text))
    .join('')
    .trim()
}

/**
 * Load and parse `./snapshot.deepnote`, then hand the view to `render`.
 *
 * Two failure modes, one path. Over `file://` a browser refuses to fetch a sibling file, and
 * `parseSnapshot` throws on anything that isn't a snapshot — both end at the same picker, so the
 * pages work opened straight off disk as well as served. `render` runs identically either way.
 */
export async function loadSnapshot(render, onError) {
  const show = yaml => {
    let view
    try {
      view = DeepnoteSnapshot.parseSnapshot(yaml)
    } catch (err) {
      picker(`Not a readable snapshot: ${err.message}`)
      return
    }
    render(view)
  }

  const picker = message => {
    if (onError) onError(message, show)
  }

  try {
    const res = await fetch('./snapshot.deepnote')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    show(await res.text())
  } catch {
    picker('Open a .deepnote snapshot to render it. (Serving over http:// loads it automatically.)')
  }
}

/**
 * A file picker for the `file://` case, wired to the same render path.
 *
 * Written as static markup with the message set via textContent — see the note in each page: nothing
 * derived from a snapshot, including an error message quoting it, is ever interpolated into HTML.
 */
export function filePicker(root, message, show) {
  root.replaceChildren()
  const wrap = document.createElement('div')
  wrap.className = 'picker'
  const p = document.createElement('p')
  p.textContent = message
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.deepnote,.yaml,.yml,text/yaml'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (file) show(await file.text())
  }
  wrap.append(p, input)
  root.append(wrap)
}
