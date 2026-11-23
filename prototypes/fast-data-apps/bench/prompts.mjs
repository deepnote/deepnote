import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRoot, describeRoot, parseCsv } from '../runtime/data.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SPEC_SYSTEM = readFileSync(join(root, 'prompt/system.md'), 'utf8')

// Approximation of today's in-app instructions (deepnote-internal
// deepnote-agent.ts getDataAppInstructions): hand-written single-page app,
// Tailwind CDN, any chart lib, Deepnote theme block copied into the page.
export const BASELINE_SYSTEM = `You build data apps as a single self-contained index.html (HTML, CSS, vanilla JS).
Output only the complete file contents, no prose, no code fences.
- Load Tailwind with <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script> and include this theme block verbatim inside <style type="text/tailwindcss">:
@theme {
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --color-background: #f6f7f9; --color-surface: #ffffff; --color-foreground: #16181d;
  --color-muted: #5d6370; --color-border: #e4e6eb; --color-primary: #3b5bdb;
  --color-primary-foreground: #ffffff; --color-success: #12b886; --color-warning: #f59f00;
  --color-danger: #e64980; --color-chart-1: #3b5bdb; --color-chart-2: #12b886;
  --color-chart-3: #f59f00; --color-chart-4: #e64980; --color-chart-5: #7048e8;
  --color-chart-6: #15aabf; --color-chart-7: #82c91e; --color-chart-8: #868e96;
  --radius-card: 10px; --radius-control: 8px; --shadow-card: 0 1px 2px rgb(0 0 0 / 0.04);
}
@media (prefers-color-scheme: dark) { :root { --color-background: #0f1115; --color-surface: #171a20; --color-foreground: #e9ebef; --color-muted: #9aa1ad; --color-border: #2a2f38; } }
- Pick any chart library from a CDN; read chart colours from the CSS variables.
- Load data in the page: CSV datasets with fetch('data/<dataset>.csv'); a notebook output snapshot with fetch('snapshot.json'), which returns the JSON object described (values at their paths, datasets as arrays).
- Layout: title, filters, a KPI row, 1-3 charts, then a table. Responsive, polished, accessible.
- Filters must update every KPI, chart and table.`

/**
 * Load an app's data sources. snapshot: name of a notebook output snapshot in snapshots/;
 * tables: CSV dataset ids in data/. Returns { root, datasets, description }.
 */
export function loadSources({ snapshot, snapshots, named, tables = [] }) {
  // Several snapshots: each sits under its own name (revenue_review.kpis.nrr, account_health.accounts).
  // named: { name: snapshotData } already read from disk (the studio's data sources).
  const names = named ? Object.keys(named) : (snapshots ?? (snapshot ? [snapshot] : []))
  const read = n => JSON.parse(readFileSync(join(root, 'snapshots', `${n}.json`), 'utf8'))
  const snap =
    named ??
    (snapshots ? Object.fromEntries(names.map(n => [n.replaceAll('-', '_'), read(n)])) : snapshot ? read(snapshot) : {})
  const tbls = Object.fromEntries(
    tables.map(id => [id, parseCsv(readFileSync(join(root, 'data', `${id}.csv`), 'utf8'))])
  )
  const built = buildRoot(snap, tbls)
  const description = [
    snapshots || named
      ? `Stored output snapshots of ${names.length} notebooks (already run), each under its name: ${names.map(n => n.replaceAll('-', '_')).join(', ')}.`
      : snapshot
        ? `Notebook output snapshot "${snapshot}" (the notebook has already run; this is its stored output):`
        : null,
    describeRoot(snap, built.datasets),
  ]
    .filter(Boolean)
    .join('\n')
  return { ...built, snapshot: snap, snapshotNames: names, description }
}

export function userPrompt({ request, sources, currentSpec }) {
  return [`Data:\n${sources.description}`, currentSpec ? `Current spec:\n${currentSpec}` : null, `Request: ${request}`]
    .filter(Boolean)
    .join('\n\n')
}
