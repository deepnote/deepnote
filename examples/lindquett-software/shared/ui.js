// Small helpers the apps share: formatting, elements and two SVG chart types. No dependencies, so a
// published app loads nothing from outside the project.

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

/** A waterfall: the first and last bars are totals, the ones between are signed steps. */
export function waterfall(steps, { height = 220, format = money } = {}) {
  const width = 640
  const pad = { top: 18, right: 8, bottom: 34, left: 8 }
  let running = 0
  const bars = steps.map((step, i) => {
    const total = i === 0 || i === steps.length - 1
    const from = total ? 0 : running
    const to = total ? step.value : running + step.value
    running = to
    return { ...step, from, to, total }
  })
  const values = bars.flatMap(bar => [bar.from, bar.to])
  const max = Math.max(...values)
  const min = Math.min(...values.filter(v => v > 0)) * 0.92
  const y = v => pad.top + (1 - (Math.max(v, min) - min) / (max - min)) * (height - pad.top - pad.bottom)
  const band = (width - pad.left - pad.right) / bars.length
  return s(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' },
    bars.map((bar, i) => {
      const x = pad.left + i * band + band * 0.18
      const top = y(Math.max(bar.from, bar.to))
      const kind = bar.total ? 'total' : bar.value >= 0 ? 'up' : 'down'
      return s(
        'g',
        {},
        s('rect', {
          x,
          y: top,
          width: band * 0.64,
          height: Math.max(2, y(Math.min(bar.from, bar.to)) - top),
          class: `bar ${kind}`,
          rx: 3,
        }),
        s(
          'text',
          { x: x + band * 0.32, y: top - 6, class: 'value' },
          bar.total ? format(bar.value) : `${bar.value >= 0 ? '+' : ''}${format(bar.value)}`
        ),
        s('text', { x: x + band * 0.32, y: height - 12, class: 'label' }, bar.label)
      )
    })
  )
}

/** Lines over a shared x axis. `series` is `[{ name, points: [{ x, y }] }]`; the highlighted one is drawn on top. */
export function lines(series, { height = 220, highlight, format = v => v } = {}) {
  const width = 640
  const pad = { top: 14, right: 150, bottom: 30, left: 44 }
  const xs = [...new Set(series.flatMap(line => line.points.map(p => p.x)))]
  const ys = series.flatMap(line => line.points.map(p => p.y))
  const [lo, hi] = [Math.min(...ys), Math.max(...ys)]
  const span = hi - lo || 1
  const x = value => pad.left + (xs.indexOf(value) / Math.max(1, xs.length - 1)) * (width - pad.left - pad.right)
  const y = value => pad.top + (1 - (value - lo + span * 0.08) / (span * 1.16)) * (height - pad.top - pad.bottom)
  const ordered = [...series].sort((a, b) => (a.name === highlight) - (b.name === highlight))
  return s(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' },
    [lo, (lo + hi) / 2, hi].map(v => [
      s('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: pad.left - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(v)),
    ]),
    xs.map(v => s('text', { x: x(v), y: height - 8, class: 'axis', 'text-anchor': 'middle' }, v)),
    ordered.map(line => {
      const on = !highlight || line.name === highlight
      const last = line.points.at(-1)
      return s(
        'g',
        { class: on ? 'series on' : 'series' },
        s('polyline', { points: line.points.map(p => `${x(p.x)},${y(p.y)}`).join(' ') }),
        s('circle', { cx: x(last.x), cy: y(last.y), r: on ? 4 : 3 }),
        s('text', { x: x(last.x) + 8, y: y(last.y) + 4, class: 'end' }, `${line.name} ${format(last.y)}`)
      )
    })
  )
}
