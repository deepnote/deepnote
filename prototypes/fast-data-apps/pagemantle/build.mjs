// Build the PageMantle notebooks from src/*.py and point a studio config at them.
//   node pagemantle/build.mjs            write notebooks + sources.pagemantle.json
//   node pagemantle/build.mjs --run      also run each notebook on the sample to write its snapshot
//
// Each notebook reads the raw PageMantle dataset (PAGEMANTLE_DATA, default ~/data/pagemantle) with
// DuckDB and outputs one JSON object for the apps. Its `dataset` input picks "sample" (fast, for
// checking apps) or "full"; the studio's "Run on full dataset" reruns them all with "full".
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const YAML = createRequire(join(root, '../../packages/database-integrations/package.json'))('yaml')
const id = (...parts) => createHash('sha1').update(parts.join('/')).digest('hex').slice(0, 32)
const uuid = (...parts) => {
  const h = id(...parts)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const prelude = readFileSync(join(here, 'src/_prelude.py'), 'utf8')
const names = readdirSync(join(here, 'src'))
  .filter(f => f.endsWith('.py') && !f.startsWith('_'))
  .map(f => f.replace(/\.py$/, ''))
const sources = []
mkdirSync(join(here, 'notebooks'), { recursive: true })
for (const name of names) {
  const src = readFileSync(join(here, 'src', `${name}.py`), 'utf8')
  const title = src.match(/^# title: (.+)$/m)?.[1] ?? name
  const description = src.match(/^# description: (.+)$/m)?.[1] ?? ''
  const body = src.replace(/^# (title|description): .+\n/gm, '').trim()
  const block = (n, type, content, metadata = {}) => ({
    id: id(name, 'block', n),
    blockGroup: id(name, 'group', n),
    sortingKey: String(n).padStart(6, '0'),
    type,
    content,
    metadata,
  })
  const doc = {
    metadata: { createdAt: '2026-11-24T09:00:00.000Z', modifiedAt: '2026-11-24T09:00:00.000Z' },
    project: {
      id: uuid(name, 'project'),
      name: `PageMantle: ${title}`,
      notebooks: [
        {
          blocks: [
            block(
              0,
              'markdown',
              `# ${title}\n\n${description}\n\nReads the PageMantle company dataset from \`PAGEMANTLE_DATA\` (default \`~/data/pagemantle\`). **Dataset** picks a fast sample or the full data.`
            ),
            block(1, 'input-select', '', {
              deepnote_variable_name: 'dataset',
              deepnote_input_label: 'Dataset',
              deepnote_variable_value: 'sample',
              deepnote_variable_default_value: 'sample',
              deepnote_variable_options: ['sample', 'full'],
              deepnote_variable_custom_options: ['sample', 'full'],
              deepnote_variable_selected_variable: '',
              deepnote_variable_select_type: 'from-options',
              deepnote_allow_multiple_values: false,
            }),
            block(2, 'code', prelude.trim()),
            block(3, 'code', body),
          ],
          executionMode: 'block',
          id: uuid(name, 'notebook'),
          name: title,
        },
      ],
    },
    version: '1.0.0',
  }
  writeFileSync(join(here, 'notebooks', `${name}.deepnote`), YAML.stringify(doc, { lineWidth: 0 }))
  sources.push({
    name,
    snapshot: `pagemantle/snapshots/${name}.json`,
    notebook: `pagemantle/notebooks/${name}.deepnote`,
    inputs: { dataset: 'sample' },
  })
}
writeFileSync(join(root, 'sources.pagemantle.json'), `${JSON.stringify(sources, null, 2)}\n`)
console.log(`wrote ${names.length} notebooks and sources.pagemantle.json`)

if (process.argv.includes('--run')) {
  process.env.SOURCES = 'sources.pagemantle.json'
  mkdirSync(join(here, 'snapshots'), { recursive: true })
  const { loadConfig, runSource } = await import('../bench/sources.mjs')
  const only = process.argv.slice(process.argv.indexOf('--run') + 1)
  for (const s of loadConfig().filter(s => !only.length || only.includes(s.name))) {
    try {
      const r = await runSource(s)
      console.log(`${s.name}: ${(r.ms / 1000).toFixed(1)}s${r.warning ? ` (warning: ${r.warning})` : ''}`)
    } catch (e) {
      console.error(`${s.name}: FAILED ${e.message.slice(0, 400)}`)
    }
  }
}
