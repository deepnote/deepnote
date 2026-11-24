// Narrow the data a request sees: a quick model call picks the sources whose tables the request
// would use, from each source's table and column names alone. With many notebooks connected, a
// shorter description makes planning and writing faster. Any failure falls back to all sources.
import { complete } from './llm.mjs'
import { loadSources } from './prompts.mjs'

const SYSTEM =
  'You choose which data sources an app needs. Reply with only the source names, comma-separated: the 1 to 4 sources whose data the request would use. Nothing else.'

/** One line per source: its values and tables with their columns. */
export function sourceSummary(named) {
  return Object.entries(named)
    .map(
      ([name, data]) =>
        `${name}: ${Object.entries(data ?? {})
          .map(([k, v]) =>
            Array.isArray(v)
              ? `${k}(${Object.keys(v[0] ?? {}).join(', ')})`
              : v && typeof v === 'object'
                ? `${k}{${Object.keys(v).join(', ')}}`
                : k
          )
          .join('; ')}`
    )
    .join('\n')
}

/**
 * Pick the sources a request needs. Returns the description of just those, or null to keep all
 * (few sources, no known source picked, or the call failed).
 */
export async function focusedDescription({ request, named, model = 'haiku' }) {
  const names = Object.keys(named)
  if (names.length <= 4) return null
  const r = await complete({
    system: SYSTEM,
    user: `Sources and their tables (columns):\n${sourceSummary(named)}\n\nRequest: ${request}`,
    model,
  })
  const picked = names.filter(n => new RegExp(`\\b${n}\\b`).test(r.text))
  if (!picked.length) return null
  return loadSources({ named: Object.fromEntries(picked.map(n => [n, named[n]])) }).description
}
