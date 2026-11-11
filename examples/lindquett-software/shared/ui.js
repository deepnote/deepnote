// Small helpers the apps share: formatting, elements and the three chart forms of the story layout.
// No dependencies, so a published app loads nothing but its own files and fonts.

export const money = (value, digits = 1) => {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}
export const percent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`
export const signed = (value, unit = '', digits = 1) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}${unit}`

/** `h('div.card', { onclick }, child, ...)`: an element with classes, properties and children. */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.')
  const node = document.createElement(name)
  if (classes.length) node.className = classes.join(' ')
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key in node) node[key] = value
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child)
  return node
}

const SVG = 'http://www.w3.org/2000/svg'
function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  for (const child of children.flat()) if (child != null) node.append(child)
  return node
}

/**
 * A horizontal waterfall: each bar starts where the previous one ended. The first and last steps
 * are totals. `steps` is `[{ label, value }]`.
 */
export function waterfall(steps, { format = money } = {}) {
  let running = 0
  const bars = steps.map((step, i) => {
    const total = i === 0 || i === steps.length - 1
    const from = total ? 0 : running
    const to = total ? step.value : running + step.value
    running = to
    return { ...step, from, to, total }
  })
  const ends = bars.flatMap(bar => [bar.from, bar.to])
  const hi = Math.max(...ends)
  const lo = Math.min(...ends.filter(v => v > 0)) * 0.9
  const pct = v => `${((Math.max(v, lo) - lo) / (hi - lo)) * 100}%`
  return h(
    'div.waterfall',
    {},
    bars.flatMap(bar => {
      const kind = bar.total ? 'total' : bar.value >= 0 ? 'up' : 'down'
      const left = bar.total ? 0 : Math.min(bar.from, bar.to)
      const right = bar.total ? bar.value : Math.max(bar.from, bar.to)
      return [
        h('div.label', {}, bar.label),
        h(
          'div.track',
          {},
          h(`div.bar.${kind}`, {
            style: {
              left: bar.total ? '0%' : pct(left),
              width: `calc(${pct(right)} - ${bar.total ? '0%' : pct(left)})`,
            },
          })
        ),
        h(
          `div.value${kind === 'down' ? '.down' : ''}`,
          {},
          bar.total ? format(bar.value) : `${bar.value >= 0 ? '+' : ''}${format(bar.value)}`
        ),
      ]
    })
  )
}

/**
 * One small-multiple line chart. `points` is `[{ x, y }]`; `baseline` draws a dotted reference
 * line at that y; `on` highlights it; `gain` colors the highlight as a good thing.
 */
export function multiple(name, points, { end, caption, baseline, lo, hi, on = false, gain = false } = {}) {
  const ys = points.map(p => p.y)
  const low = lo ?? Math.min(...ys, baseline ?? Number.POSITIVE_INFINITY)
  const high = hi ?? Math.max(...ys, baseline ?? Number.NEGATIVE_INFINITY)
  const span = high - low || 1
  const x = i => 10 + (i / Math.max(1, points.length - 1)) * 200
  const y = v => 100 - ((v - low) / span) * 85
  const last = points.at(-1)
  return h(
    `figure.multiple${on ? '.on' : ''}${gain ? '.gain' : ''}`,
    {},
    h('div.head', {}, h('span.name', {}, name), h('span.end', {}, end ?? '')),
    s(
      'svg',
      { viewBox: '0 0 220 110', role: 'img', 'aria-label': `${name}: ${caption ?? ''}` },
      baseline === undefined ? null : s('line', { x1: 6, x2: 214, y1: y(baseline), y2: y(baseline), class: 'base' }),
      s('polyline', { class: 'line', points: points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ') }),
      s('circle', { class: 'dot', cx: x(points.length - 1), cy: y(last.y), r: on ? 5 : 4 })
    ),
    h('figcaption.caption', {}, caption ?? '')
  )
}

/**
 * Ranked horizontal bars. `rows` is `[{ name, value, faint }]`, in the order to show; a `rule: true`
 * row draws a divider. Bar length is relative to the largest absolute value.
 */
export function ranked(rows, { format = money } = {}) {
  const max = Math.max(...rows.filter(r => !r.rule).map(r => Math.abs(r.value)), 1)
  return h(
    'div.ranked',
    {},
    rows.flatMap(row => {
      if (row.rule) return [h('div.rule')]
      const kind = row.faint ? 'faint' : row.value < 0 ? 'down' : 'up'
      return [
        h('div.name', { title: row.name }, row.name),
        h(`div.bar.${kind}`, { style: { width: `${(Math.abs(row.value) / max) * 100}%` } }),
        h(`div.value${row.faint ? '.muted' : row.value < 0 ? '.down' : '.up'}`, {}, format(row.value)),
      ]
    })
  )
}
