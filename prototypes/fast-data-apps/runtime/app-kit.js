// cspell:words cand maxbins tbls utcyear utcyearmonth utcyearmonthdate utcyearquarter utcyearweek wght
// Fast data app runtime. Renders an app spec (JSONL, see spec.js) on top of a
// notebook output snapshot. Pre-built once, so the LLM only writes the spec.
import { aggregate, bucketDate, buildRoot, groupBy, parseCsv } from './data.js'
import { evaluate, format, render } from './expr.js'
import { checkOp, commitOp, createContext, parseLine, toJsonl } from './spec.js'

const MAX_SERIES = 8
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtOf = spec => {
  const [kind, arg] = String(spec ?? '').split(':')
  return v => format(v, kind || undefined, arg)
}
const label = f => (f ? String(f).charAt(0).toUpperCase() + String(f).slice(1).replaceAll('_', ' ') : f)
const TONES = ['good', 'warn', 'bad', 'neutral']
function autoTone(text) {
  const t = String(text ?? '').toLowerCase()
  if (/^(pass|passing|healthy|ok|low|good|yes|up|active|won|on track)\b/.test(t)) return 'good'
  if (/^(warn|warning|medium|at risk|pending|late)\b/.test(t)) return 'warn'
  if (/^(fail|failing|failed|high|bad|error|churn|down|lost|critical|new this month)\b/.test(t)) return 'bad'
  return 'neutral'
}
const toneClass = t => (TONES.includes(t) ? t : autoTone(t))

function markdown(md) {
  const inline = s =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
  const out = []
  let list = null
  for (const line of md.split('\n')) {
    const li = line.match(/^\s*[-*]\s+(.*)/)
    if (li) {
      list ??= []
      list.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`)
      list = null
    }
    const h = line.match(/^(#{1,3})\s+(.*)/)
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`)
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`)
  return out.join('')
}

// ---------- theme ----------
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
function vegaConfig() {
  const axis = cssVar('--chart-axis') || cssVar('--fg-muted')
  const grid = cssVar('--chart-grid') || cssVar('--border')
  const base = cssVar('--chart-baseline') || cssVar('--border')
  return {
    background: 'transparent',
    font: cssVar('--font'),
    view: { stroke: null },
    padding: { left: 4, right: 8, top: 8, bottom: 4 },
    axis: {
      labelColor: axis,
      titleColor: axis,
      gridColor: grid,
      domainColor: base,
      tickColor: base,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      labelFont: cssVar('--font'),
      titleFont: cssVar('--font'),
    },
    legend: {
      labelColor: axis,
      titleColor: axis,
      orient: 'bottom',
      labelFontSize: 11,
      titleFontSize: 11,
      symbolType: 'circle',
      labelFont: cssVar('--font'),
      titleFont: cssVar('--font'),
    },
    title: { color: axis, fontSize: 12, fontWeight: 500, anchor: 'start', font: cssVar('--font') },
    text: { font: cssVar('--font') },
    range: { category: Array.from({ length: 10 }, (_, i) => cssVar(`--series-${i + 1}`)).filter(Boolean) },
    line: { strokeWidth: 2 },
    bar: { cornerRadiusEnd: Math.min(4, Number.parseFloat(cssVar('--radius')) / 2 || 3) },
    arc: { stroke: cssVar('--surface'), strokeWidth: 2 },
  }
}

// ---------- theme ----------
const THEME_VARS = {
  bg: '--bg',
  surface: '--surface',
  text: '--fg',
  heading: '--heading',
  muted: '--fg-muted',
  border: '--border',
  primary: '--accent',
  accent: '--accent-2',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
  headerBg: '--header-bg',
  headerText: '--header-fg',
  font: '--font',
  display: '--font-display',
  mono: '--font-mono',
}
const SYSTEM_FONTS = /^(system-ui|sans-serif|serif|monospace|ui-\w+|Arial|Helvetica|Georgia|Times New Roman)$/i
let appliedTheme = null
/** Undo a previous app's theme (a new app starts from the default look). */
function resetTheme(root) {
  const el = document.documentElement
  for (const v of appliedTheme ?? []) el.style.removeProperty(v)
  appliedTheme = []
  delete el.dataset.theme
  root.classList.remove('dk-band', 'dk-compact')
  document.getElementById('dk-theme-fonts')?.remove()
}
/** Apply a validated theme line: CSS variables on the page, fonts from Google Fonts. */
function applyTheme(theme, root) {
  const el = document.documentElement
  if (appliedTheme) for (const v of appliedTheme) el.style.removeProperty(v)
  appliedTheme = []
  const set = (v, val) => {
    el.style.setProperty(v, val)
    appliedTheme.push(v)
  }
  for (const [k, v] of Object.entries(THEME_VARS)) {
    if (theme[k] == null) continue
    set(
      v,
      k === 'font' || k === 'display' || k === 'mono'
        ? `"${theme[k]}", ${k === 'mono' ? 'ui-monospace, monospace' : 'ui-sans-serif, system-ui, sans-serif'}`
        : theme[k]
    )
  }
  if (theme.text && !theme.heading) set('--heading', theme.text)
  for (const [i, c] of (theme.palette ?? []).entries()) set(`--series-${i + 1}`, c)
  if (theme.radius != null) set('--radius', `${theme.radius}px`)
  if (theme.shadow)
    set(
      '--shadow',
      {
        none: 'none',
        soft: '0 1px 2px rgb(0 0 0 / 0.05), 0 2px 8px rgb(0 0 0 / 0.04)',
        lifted: '0 8px 24px rgb(0 0 0 / 0.08)',
      }[theme.shadow]
    )
  el.dataset.theme = theme.mode === 'dark' ? 'dark' : theme.mode === 'light' ? 'light' : ''
  root.classList.toggle('dk-band', theme.header === 'band')
  root.classList.toggle('dk-compact', theme.density === 'compact')
  const families = ['font', 'display', 'mono'].map(k => theme[k]).filter(f => f && !SYSTEM_FONTS.test(f))
  document.getElementById('dk-theme-fonts')?.remove()
  if (families.length) {
    const link = document.createElement('link')
    link.id = 'dk-theme-fonts'
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${[...new Set(families)].map(f => `family=${encodeURIComponent(f).replaceAll('%20', '+')}:wght@400;500;600;700`).join('&')}&display=swap`
    document.head.append(link)
  }
}

const d3Format = kind => (kind === 'currency' || kind === 'money' ? '$,.3~s' : kind === 'percent' ? '.0%' : ',.3~s')

// ---------- app ----------
/**
 * @param root element to render into
 * @param sources { snapshot?: () => Promise<object>, tables?: { id: () => Promise<rows|csvText> } }
 */
export function createApp(root, { snapshot, tables = {}, onEvent = () => {} }) {
  let data = null // { root, datasets }
  let ctx = null
  let app = { title: '' }
  let theme = null
  const components = []
  const inputs = {}
  const filterValues = new Map()
  // Pending chart renders (vega-embed is async), so callers can tell when the page is fully drawn.
  const inflight = new Set()
  const track = p => {
    inflight.add(p)
    p.finally(() => inflight.delete(p))
    return p
  }
  let headerPending = false
  const views = new Map()
  const listSearch = new Map()

  root.innerHTML = `
    <header class="dk-header">
      <div><div class="dk-kicker"></div><h1 class="dk-title"></h1><p class="dk-subtitle"></p></div>
      <span class="dk-status" hidden></span>
    </header>
    <div class="dk-controls"></div>
    <main class="dk-grid"></main>`
  const $ = sel => root.querySelector(sel)
  resetTheme(root)

  const ready = Promise.all([
    snapshot ? Promise.resolve(snapshot()) : {},
    ...Object.entries(tables).map(([id, load]) =>
      Promise.resolve(load()).then(raw => [id, typeof raw === 'string' ? parseCsv(raw) : raw])
    ),
  ]).then(([snap, ...tbls]) => {
    data = buildRoot(snap, Object.fromEntries(tbls))
    ctx = createContext(
      data.root,
      Object.fromEntries(Object.entries(data.datasets).map(([k, d]) => [k, d.profile.columns]))
    )
    renderAll()
  })

  // ----- data view: base datasets + calc columns + derived datasets, then filters -----
  let view = null
  function computeView() {
    const datasets = {}
    for (const [k, d] of Object.entries(data.datasets)) datasets[k] = d.rows
    const rootView = { ...data.root }
    for (const c of components) {
      try {
        if (c.t === 'calc' && datasets[c.data]) {
          datasets[c.data] = datasets[c.data].map(row => {
            let v = null
            try {
              v = evaluate(c.expr, { root: rootView, row, inputs })
            } catch {}
            return { ...row, [c.as]: typeof v === 'number' && !Number.isFinite(v) ? null : v }
          })
        } else if (c.t === 'derive' && datasets[c.from]) {
          let rows = datasets[c.from]
          if (c.expand) {
            const from = Number(evaluate(String(c.expand.from ?? 0), { root: rootView, inputs })) || 0
            const to = Number(evaluate(String(c.expand.to), { root: rootView, inputs })) || 0
            const step = Number(c.expand.step ?? 1) || 1
            const out = []
            for (const row of rows)
              for (let i = from; i <= to && out.length < 50000; i += step) out.push({ ...row, [c.expand.as]: i })
            rows = out
          }
          if (c.where) rows = applyWhere(rows, c.where, rootView)
          if (c.cols) {
            rows = rows.map(row => {
              const out = { ...row }
              for (const [name, expr] of Object.entries(c.cols)) {
                try {
                  out[name] = evaluate(expr, { root: rootView, row: out, inputs })
                } catch {
                  out[name] = null
                }
              }
              return out
            })
          }
          if (c.group) {
            const numeric = Object.keys(rows[0] ?? {}).filter(
              k => !c.group.includes(k) && typeof rows[0][k] === 'number'
            )
            rows = groupBy(
              rows,
              c.group.map(g => [g, r => r[g]]),
              numeric.map(f => ({ as: f, agg: 'sum', field: f }))
            )
          }
          datasets[c.id] = rows
        }
      } catch (e) {
        onEvent({ type: 'error', id: c.id, message: e.message })
      }
      if (c.t === 'derive' || c.t === 'calc') {
        const key = c.t === 'derive' ? c.id : c.data
        if (!key.includes('.')) rootView[key] = datasets[key]
      }
    }
    view = { datasets, root: rootView }
  }
  const env = row => ({ root: view.root, row, inputs })
  const ev = (expr, row) => {
    if (expr == null) return null
    if (typeof expr !== 'string') return expr
    return evaluate(expr, env(row))
  }
  const tpl = (t, row) => render(t, env(row))

  function applyWhere(input, where, rootView = view.root) {
    let rows = input
    if (typeof where === 'string') return rows.filter(row => evaluate(where, { root: rootView, row, inputs }))
    for (const [k, want] of Object.entries(where)) {
      const wants = [].concat(want).map(String)
      rows = rows.filter(r => wants.includes(String(r[k])))
    }
    return rows
  }

  function rowsFor(comp) {
    if (Array.isArray(comp.rows)) {
      return comp.rows.map(r =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('=') ? ev(v.slice(1)) : v])
        )
      )
    }
    let rows = view.datasets[comp.data] ?? []
    for (const f of components) {
      if (f.t !== 'filter' || !filterValues.has(f.id) || !rows.length || !(f.field in rows[0])) continue
      const v = filterValues.get(f.id)
      if (f.kind === 'date') rows = rows.filter(r => r[f.field] && r[f.field] >= v[0] && r[f.field] <= v[1])
      else if (f.kind === 'toggle') rows = rows.filter(r => Boolean(r[f.field]) === v)
      else rows = rows.filter(r => String(r[f.field]) === v)
    }
    if (comp.where) rows = applyWhere(rows, comp.where)
    return rows
  }

  // ----- controls: inputs + filters -----
  function renderControls() {
    const bar = $('.dk-controls')
    const controls = components.filter(c => c.t === 'input' || c.t === 'filter')
    bar.hidden = !controls.length
    bar.replaceChildren()
    for (const c of controls) {
      const wrap = document.createElement('label')
      wrap.className = `dk-control dk-control-${c.kind}`
      const name = esc(c.label ?? label(c.field ?? c.id))
      if (c.t === 'filter') renderFilter(wrap, c, name)
      else renderInput(wrap, c, name)
      bar.append(wrap)
    }
  }

  function setInput(id, value) {
    inputs[id] = value
    refresh()
  }

  function renderInput(wrap, c, name) {
    if (!(c.id in inputs)) inputs[c.id] = c.value
    const v = inputs[c.id]
    const options = Array.isArray(c.options)
      ? c.options.map(o => (o !== null && typeof o === 'object' ? o : { value: o, label: String(o) }))
      : c.from
        ? [
            ...new Set(
              (view.datasets[c.from.split('.').slice(0, -1).join('.')] ?? []).map(r => r[c.from.split('.').at(-1)])
            ),
          ].map(o => ({ value: o, label: String(o) }))
        : []
    const show = c.fmt ? fmtOf(c.fmt) : x => String(x)
    if (c.kind === 'select') {
      wrap.innerHTML = `<span>${name}</span><select>${options.map((o, i) => `<option value="${i}">${esc(o.label ?? o.value)}</option>`).join('')}</select>`
      const sel = wrap.querySelector('select')
      sel.value = String(
        Math.max(
          0,
          options.findIndex(o => o.value === v)
        )
      )
      sel.onchange = () => setInput(c.id, options[Number(sel.value)].value)
    } else if (c.kind === 'segmented') {
      wrap.innerHTML = `<span>${name}</span><div class="dk-segmented">${options.map((o, i) => `<button type="button" data-i="${i}" aria-pressed="${o.value === v}">${esc(o.label ?? o.value)}</button>`).join('')}</div>`
      wrap.querySelectorAll('button').forEach(b => {
        b.onclick = () => setInput(c.id, options[Number(b.dataset.i)].value)
      })
    } else if (c.kind === 'slider') {
      wrap.innerHTML = `<span>${name} <output>${esc(show(v))}</output></span><input type="range" min="${c.min ?? 0}" max="${c.max ?? 100}" step="${c.step ?? 1}" value="${v}">`
      const input = wrap.querySelector('input')
      input.oninput = () => {
        wrap.querySelector('output').textContent = show(Number(input.value))
        inputs[c.id] = Number(input.value)
        refreshData()
      }
      input.onchange = () => setInput(c.id, Number(input.value))
    } else if (c.kind === 'number') {
      wrap.innerHTML = `<span>${name}</span><input type="number" min="${c.min ?? ''}" max="${c.max ?? ''}" step="${c.step ?? 'any'}" value="${v}">`
      const input = wrap.querySelector('input')
      input.onchange = () => setInput(c.id, Number(input.value))
    } else if (c.kind === 'toggle') {
      wrap.innerHTML = `<span>${name}</span><input type="checkbox" ${v ? 'checked' : ''}>`
      wrap.querySelector('input').onchange = e => setInput(c.id, e.target.checked)
    } else {
      wrap.innerHTML = `<span>${name}</span><input type="text" value="${esc(v ?? '')}" placeholder="${esc(c.placeholder ?? '')}">`
      wrap.querySelector('input').onchange = e => setInput(c.id, e.target.value)
    }
  }

  function datePresets(rows, field) {
    const ts = rows.map(r => r[field]?.getTime?.()).filter(Boolean)
    const max = new Date(Math.max(...ts))
    const min = new Date(Math.min(...ts))
    const back = days => new Date(max.getTime() - days * 86400000)
    return [
      ['all', 'All time', [min, max]],
      ['30d', 'Last 30 days', [back(30), max]],
      ['90d', 'Last 90 days', [back(90), max]],
      ['12m', 'Last 12 months', [back(365), max]],
      ['ytd', 'Year to date', [new Date(Date.UTC(max.getUTCFullYear(), 0, 1)), max]],
    ]
  }

  function renderFilter(wrap, f, name) {
    const rows = view.datasets[f.data] ?? []
    if (f.kind === 'date') {
      const presets = datePresets(rows, f.field)
      wrap.innerHTML = `<span>${name}</span><select>${presets.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`
      const sel = wrap.querySelector('select')
      sel.value = f.__preset ?? 'all'
      sel.onchange = () => {
        f.__preset = sel.value
        sel.value === 'all'
          ? filterValues.delete(f.id)
          : filterValues.set(f.id, presets.find(([k]) => k === sel.value)[2])
        refreshData()
      }
      return
    }
    const values =
      f.kind === 'toggle'
        ? ['true', 'false']
        : [...new Set(rows.map(r => r[f.field]).filter(v => v != null))].map(String).sort()
    wrap.innerHTML = `<span>${name}</span><select><option value="">All</option>${values
      .slice(0, 500)
      .map(v => `<option value="${esc(v)}">${esc(f.kind === 'toggle' ? (v === 'true' ? 'Yes' : 'No') : v)}</option>`)
      .join('')}</select>`
    const sel = wrap.querySelector('select')
    const cur = filterValues.get(f.id)
    sel.value = cur == null ? '' : String(cur)
    sel.onchange = () => {
      if (sel.value === '') filterValues.delete(f.id)
      else filterValues.set(f.id, f.kind === 'toggle' ? sel.value === 'true' : sel.value)
      refreshData()
    }
  }

  // ----- layout -----
  const isVisual = c => !['filter', 'calc', 'derive', 'input', 'app'].includes(c.t)
  const isPlaceholder = c => c.t === 'placeholder'
  function cardFor(comp) {
    let el = root.querySelector(`[data-id="${CSS.escape(comp.id)}"]`)
    if (!el) {
      el = document.createElement('section')
      el.dataset.id = comp.id
      el.classList.add('dk-enter')
    }
    el.className = `dk-card dk-${comp.t}${el.classList.contains('dk-enter') ? ' dk-enter' : ''}`
    el.style.gridColumn = comp.span ? `span ${comp.span}` : '1 / -1'
    return el
  }
  function placeCards() {
    const grid = $('.dk-grid')
    const wanted = components.filter(isVisual).map(cardFor)
    wanted.forEach((el, i) => {
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] ?? null)
    })
    while (grid.children.length > wanted.length) {
      const extra = grid.lastElementChild
      views.get(extra.dataset.id)?.finalize()
      views.delete(extra.dataset.id)
      extra.remove()
    }
  }
  // Skeletons shaped like the component that will replace them, at its default size.
  function skeletonHtml(comp) {
    const line = (w, cls = 'dk-skel-line') => `<div class="dk-skel ${cls}" style="width:${w}%"></div>`
    const title = comp.label ? `<div class="dk-skel-caption">${esc(comp.label)}</div>` : line(35, 'dk-skel-title')
    switch (comp.kind) {
      case 'kpi':
        return `${line(45, 'dk-skel-label')}${line(55, 'dk-skel-value')}${line(70, 'dk-skel-note')}`
      case 'trend':
        return `${title}<div class="dk-skel-chart"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline class="dk-skel-stroke" points="0,30 12,26 24,28 36,20 48,22 60,15 72,17 84,10 100,12"/></svg></div>`
      case 'chart': {
        const bars = [62, 80, 45, 70, 55, 90, 38, 66].map(h => `<i style="height:${h}%"></i>`).join('')
        return `${title}<div class="dk-skel-chart dk-skel-bars">${bars}</div>`
      }
      case 'list':
        return `${title}<div class="dk-skel dk-skel-search"></div>${Array.from({ length: 6 }, () => `<div class="dk-skel-row">${line(55)}${line(30, 'dk-skel-sub')}</div>`).join('')}`
      case 'detail':
        return `${line(25, 'dk-skel-label')}${line(60, 'dk-skel-title')}${[85, 70, 78].map(w => line(w)).join('')}<div class="dk-skel-facts">${Array.from({ length: 4 }, () => `${line(70)}${line(50)}`).join('')}</div>`
      case 'table':
        return `${title}${Array.from({ length: 6 }, (_, i) => `<div class="dk-skel-trow${i ? '' : ' head'}">${[30, 20, 15, 15].map(w => line(w)).join('')}</div>`).join('')}`
      default:
        return `${title}<div class="dk-skel dk-skel-body"></div>`
    }
  }

  /** Animate a card from the skeleton's height to its content's height, fading the content in. */
  function morph(el) {
    const from = Number(el.dataset.morphFrom)
    delete el.dataset.morphFrom
    if (!from) return
    el.classList.add('dk-morph')
    const to = el.offsetHeight
    if (Math.abs(to - from) < 4) return
    el.style.height = `${from}px`
    void el.offsetHeight
    el.style.transition = 'height 0.3s ease'
    el.style.height = `${to}px`
    setTimeout(() => {
      el.style.height = ''
      el.style.transition = ''
    }, 330)
  }

  const heading = comp => (comp.title ? `<h3>${esc(tpl(comp.title))}</h3>` : '')
  const caption = comp => (comp.caption ? `<p class="dk-caption">${esc(tpl(comp.caption))}</p>` : '')

  function renderComp(comp) {
    if (!isVisual(comp)) return
    const el = cardFor(comp)
    try {
      if (comp.t === 'placeholder') {
        el.className = `dk-card dk-placeholder dk-placeholder-${comp.kind}`
        el.innerHTML = skeletonHtml(comp)
        return
      }
      if (comp.t === 'section')
        el.innerHTML = `<h2>${esc(tpl(comp.title))}</h2>${comp.note ? `<p>${esc(tpl(comp.note))}</p>` : ''}`
      else if (comp.t === 'text') el.innerHTML = markdown(tpl(comp.md))
      else if (comp.t === 'kpi') renderKpi(el, comp)
      else if (comp.t === 'table') renderTable(el, comp, rowsFor(comp))
      else if (comp.t === 'chart') renderChart(el, comp, rowsFor(comp))
      else if (comp.t === 'list') renderList(el, comp)
      else if (comp.t === 'detail') renderDetail(el, comp)
      else if (comp.t === 'vega') renderVega(el, comp, { ...comp.spec, data: { values: rowsFor(comp) } })
      if (el.dataset.morphFrom) morph(el)
    } catch (e) {
      el.innerHTML = `<div class="dk-error">Could not render ${esc(comp.id)}: ${esc(e.message)}</div>`
      onEvent({ type: 'error', id: comp.id, message: e.message })
    }
  }

  function renderKpi(el, comp) {
    let value
    let kind = comp.fmt
    if (comp.value != null) value = ev(comp.value)
    else {
      value =
        comp.agg === 'share' && comp.field == null && comp.where != null
          ? rowsFor(comp).length / Math.max(1, rowsFor({ ...comp, where: undefined }).length)
          : aggregate(rowsFor(comp), comp.agg, comp.field, comp.of)
      kind ??=
        comp.agg === 'ratio' || comp.agg === 'share'
          ? 'percent'
          : comp.agg === 'count' || comp.agg === 'distinct'
            ? 'int'
            : 'number'
    }
    let delta = ''
    // Comparison: explicit delta, or compare=<path>, or a sibling prior_/previous_ value found in the data.
    let deltaExpr = comp.delta
    let deltaFmt = comp.deltaFmt
    const comparePath =
      comp.compare === false
        ? null
        : (comp.compare ?? (comp.delta == null && typeof comp.value === 'string' ? priorPath(comp.value) : null))
    if (deltaExpr == null && comparePath) {
      const pct = String(kind ?? '').startsWith('percent')
      deltaExpr = pct ? `(${comp.value}-${comparePath})*100` : `${comp.value}/${comparePath}-1`
      deltaFmt ??= pct ? 'signed:pts' : 'signed:%'
    }
    if (deltaExpr != null) {
      const d = ev(deltaExpr)
      const good = comp.good === 'down' ? d < 0 : d > 0
      delta = `<span class="dk-delta ${d === 0 || d == null ? '' : good ? 'good' : 'bad'}">${esc(fmtOf(deltaFmt ?? 'signed')(d))}</span>`
    }
    const tone = comp.tone ? ` dk-tone-${toneClass(ev(comp.tone))}` : ''
    el.innerHTML = `<div class="dk-kpi-label">${esc(tpl(comp.label))}</div><div class="dk-kpi-value${tone}">${esc(fmtOf(kind)(value))}</div>${
      comp.note || delta
        ? `<div class="dk-kpi-note">${delta}${delta && comp.note ? ' ' : ''}${esc(tpl(comp.note))}</div>`
        : ''
    }`
  }

  /** kpis.nrr -> kpis.prior_nrr / kpis.previous_nrr / kpis.nrr_prior / kpis.nrr_prev, if present in the data. */
  function priorPath(path) {
    if (!/^[A-Za-z_][\w.]*$/.test(path)) return null
    const parts = path.split('.')
    const last = parts.pop()
    const base = parts.length ? `${parts.join('.')}.` : ''
    for (const cand of [`prior_${last}`, `previous_${last}`, `${last}_prior`, `${last}_prev`, `last_${last}`]) {
      const v = (base + cand)
        .split('.')
        .reduce((o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined), view.root)
      if (typeof v === 'number') return base + cand
    }
    return null
  }

  function cellHtml(v, fmt) {
    if (fmt === 'badge') return `<span class="dk-badge ${autoTone(v)}">${esc(v)}</span>`
    return esc(fmtOf(fmt)(v))
  }

  function renderTable(el, comp, rows) {
    const sample = rows[0] ?? {}
    const isNum = k => typeof sample[k] === 'number'
    let cols
    let out
    if (comp.group?.length) {
      const measures = (comp.cols ?? [{ agg: 'count' }])
        .filter(c => !comp.group.includes(c.field))
        .map((c, i) => ({ ...c, agg: c.agg ?? 'sum', as: `m${i}` }))
      out = groupBy(
        rows,
        comp.group.map(g => [g, r => r[g]]),
        measures
      )
      cols = [
        ...comp.group.map(g => ({ key: g, label: label(g) })),
        ...measures.map(m => ({
          key: m.as,
          label: m.label ?? (m.agg === 'count' ? 'Count' : `${label(m.field)}${m.agg === 'sum' ? '' : ` (${m.agg})`}`),
          fmt: m.fmt ?? (m.agg === 'ratio' || m.agg === 'share' ? 'percent' : undefined),
          num: true,
        })),
      ]
    } else {
      const fields =
        comp.cols ??
        Object.keys(sample)
          .filter(k => typeof sample[k] !== 'object' || sample[k] instanceof Date)
          .slice(0, 8)
          .map(field => ({ field }))
      out = rows.map(r => {
        const o = { ...r }
        fields.forEach((c, i) => {
          if (c.expr) o[`__e${i}`] = ev(c.expr, r)
        })
        return o
      })
      cols = fields.map((c, i) => {
        const key = c.expr ? `__e${i}` : c.field
        return {
          key,
          label: c.label ?? label(c.field),
          fmt: c.fmt,
          num: c.fmt !== 'badge' && (out[0] ? typeof out[0][key] === 'number' : isNum(key)),
        }
      })
    }
    const sortCol = comp.sort
      ? cols.find(
          c =>
            c.key === comp.sort ||
            c.label === comp.sort ||
            comp.cols?.[cols.indexOf(c) - (comp.group?.length ?? 0)]?.field === comp.sort
        )
      : comp.group?.length
        ? cols.at(-1)
        : null
    if (sortCol) {
      const dir = comp.desc === false ? 1 : -1
      out = [...out].sort((a, b) =>
        a[sortCol.key] > b[sortCol.key] ? dir : a[sortCol.key] < b[sortCol.key] ? -dir : 0
      )
    }
    const limit = comp.limit ?? (comp.group?.length ? 100 : 50)
    el.innerHTML = `${heading(comp)}<div class="dk-table-wrap"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${out
      .slice(0, limit)
      .map(
        r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${cellHtml(r[c.key], c.fmt)}</td>`).join('')}</tr>`
      )
      .join(
        ''
      )}</tbody></table></div>${out.length > limit ? `<div class="dk-caption">Showing ${limit} of ${format(out.length, 'int')}</div>` : ''}${caption(comp)}`
  }

  function renderList(el, comp) {
    let rows = rowsFor(comp)
    if (comp.sort) {
      const dir = comp.desc === false ? 1 : -1
      rows = [...rows].sort((a, b) => (a[comp.sort] > b[comp.sort] ? dir : a[comp.sort] < b[comp.sort] ? -dir : 0))
    }
    const term = (listSearch.get(comp.id) ?? '').toLowerCase()
    const key = comp.key ?? Object.keys(rows[0] ?? {})[0]
    if (comp.select && inputs[comp.select] == null && rows[0]) inputs[comp.select] = rows[0][key]
    const shown = rows
      .filter(r => !term || Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(term)))
      .slice(0, comp.limit ?? 50)
    if (!el.querySelector('.dk-list')) {
      el.innerHTML = `<h3></h3>${comp.search ? '<input class="dk-search" type="search" placeholder="Search">' : ''}<div class="dk-list"></div><p class="dk-caption"></p>`
      const s = el.querySelector('.dk-search')
      if (s)
        s.oninput = () => {
          listSearch.set(comp.id, s.value)
          renderList(el, comp)
        }
    }
    el.querySelector('h3').textContent = comp.heading ? tpl(comp.heading) : ''
    el.querySelector('h3').hidden = !comp.heading
    el.querySelector('.dk-caption').textContent = comp.caption ? tpl(comp.caption) : ''
    const list = el.querySelector('.dk-list')
    list.className = `dk-list dk-list-${comp.layout === 'cards' ? 'cards' : 'rows'}`
    list.replaceChildren(
      ...shown.map(row => {
        const item = document.createElement(comp.select ? 'button' : 'div')
        item.className = 'dk-item'
        if (comp.select) {
          item.type = 'button'
          item.setAttribute('aria-current', String(inputs[comp.select] === row[key]))
          item.onclick = () => setInput(comp.select, row[key])
        }
        const tone = comp.tone ? toneClass(ev(comp.tone, row)) : null
        const lead =
          comp.lead != null
            ? `<div class="dk-lead ${tone ?? ''}">${esc(fmtOf(comp.leadFmt)(ev(comp.lead, row)))}</div>`
            : ''
        const badgeText = comp.badge && (comp.badgeWhen == null || ev(comp.badgeWhen, row)) ? tpl(comp.badge, row) : ''
        const badge = badgeText
          ? ` <span class="dk-badge ${toneClass(comp.badgeTone ?? badgeText)}">${esc(badgeText)}</span>`
          : ''
        const value =
          comp.value != null
            ? `<div class="dk-item-value">${esc(fmtOf(comp.fmt)(ev(comp.value, row)))}${comp.valueNote ? `<div class="dk-sub">${esc(tpl(comp.valueNote, row))}</div>` : ''}</div>`
            : ''
        item.innerHTML = `${lead}<div class="dk-item-main"><div class="dk-item-title">${esc(tpl(comp.title, row))}${badge}</div>${comp.subtitle ? `<div class="dk-sub">${esc(tpl(comp.subtitle, row))}</div>` : ''}</div>${value}`
        return item
      })
    )
    if (!shown.length) list.innerHTML = '<p class="dk-sub">Nothing to show.</p>'
  }

  function renderDetail(el, comp) {
    let row
    if (comp.of) row = comp.of.split('.').reduce((v, k) => v?.[k], view.root)
    else {
      const rows = rowsFor(comp)
      const key = comp.key ?? Object.keys(rows[0] ?? {})[0]
      row = rows.find(r => comp.select && r[key] === inputs[comp.select]) ?? rows[0]
    }
    if (!row) {
      el.innerHTML = `${heading(comp)}<p class="dk-sub">Nothing selected.</p>`
      return
    }
    const tone = comp.tone ? ` dk-edge-${toneClass(ev(comp.tone, row))}` : ''
    const bullets = comp.bullets ? [].concat(ev(comp.bullets, row) ?? []) : []
    el.className = `${el.className.replace(/ dk-edge-\w+/g, '')}${tone}`
    el.innerHTML = `${comp.kicker ? `<div class="dk-kicker">${esc(tpl(comp.kicker, row))}</div>` : ''}${comp.title ? `<h3>${esc(tpl(comp.title, row))}</h3>` : ''}${
      bullets.length
        ? `<${comp.numbered ? 'ol' : 'ul'} class="dk-bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</${comp.numbered ? 'ol' : 'ul'}>`
        : ''
    }${
      comp.items?.length
        ? `<dl class="dk-facts">${comp.items
            .map(([k, t]) => {
              const text = tpl(t, row)
              const badge = /\|\s*badge\s*}}$/.test(t)
              return `<dt>${esc(k)}</dt><dd>${badge ? `<span class="dk-badge ${autoTone(text)}">${esc(text)}</span>` : esc(text)}</dd>`
            })
            .join('')}</dl>`
        : ''
    }${comp.note ? `<p class="dk-caption">${esc(tpl(comp.note, row))}</p>` : ''}`
  }

  function topN(rows, key, measure, n) {
    const totals = new Map()
    for (const r of rows) totals.set(r[key], (totals.get(r[key]) ?? 0) + Math.abs(Number(r[measure]) || 0))
    return new Set(
      [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k]) => k)
    )
  }

  function renderChart(el, comp, rows) {
    const kind = comp.kind
    const fmtKind = String(
      comp.fmt ?? (comp.agg === 'ratio' || comp.agg === 'share' ? 'percent' : comp.agg === 'count' ? 'int' : 'number')
    ).split(':')[0]
    const valueFmt = fmtOf(comp.fmt)
    if (comp.facet && kind !== 'scatter' && kind !== 'hist') return renderFacets(el, comp, rows)
    if (kind === 'waterfall') return renderVega(el, comp, waterfallSpec(comp, rows, valueFmt, fmtKind))
    const yTitle =
      comp.yTitle ??
      (Array.isArray(comp.y)
        ? null
        : comp.agg === 'count'
          ? 'Count'
          : `${label(comp.y)}${comp.agg === 'sum' || !comp.agg ? '' : ` (${comp.agg})`}`)
    let spec
    if (kind === 'scatter') {
      const sample = rows.length > 2000 ? rows.filter((_, i) => i % Math.ceil(rows.length / 2000) === 0) : rows
      spec = {
        data: { values: sample },
        mark: { type: 'point', filled: true, opacity: 0.6, size: 30 },
        encoding: {
          x: { field: comp.x, type: 'quantitative', title: label(comp.x), scale: { zero: false } },
          y: { field: comp.y, type: 'quantitative', title: label(comp.y), scale: { zero: false } },
          ...(comp.color ? { color: { field: comp.color, type: 'nominal', title: label(comp.color) } } : {}),
          tooltip: [comp.x, comp.y, comp.color].filter(Boolean).map(f => ({ field: f })),
        },
      }
      return renderVega(el, comp, spec)
    }
    if (kind === 'hist') {
      spec = {
        data: { values: rows },
        mark: { type: 'bar', cornerRadiusEnd: 2 },
        encoding: {
          x: { field: comp.x, bin: { maxbins: 30 }, title: label(comp.x) },
          y: { aggregate: 'count', title: 'Count' },
          ...(comp.color ? { color: { field: comp.color, type: 'nominal' } } : {}),
        },
      }
      return renderVega(el, comp, spec)
    }
    const { data, isTime, sequential } = seriesData(comp, rows)
    const timeFormat = { day: '%b %d', week: '%b %d', month: '%b %Y', quarter: 'Q%q %Y', year: '%Y' }[comp.time]
    const series = Boolean(comp.color || Array.isArray(comp.y))
    const seriesTitle = Array.isArray(comp.y) ? null : label(comp.color)
    let xEnc = isTime
      ? {
          field: 'x',
          type: 'temporal',
          title: comp.xTitle ?? null,
          axis: { format: timeFormat, labelOverlap: true, grid: false },
        }
      : sequential
        ? {
            field: 'x',
            type: typeof data[0]?.x === 'number' ? 'quantitative' : 'ordinal',
            title: comp.xTitle ?? null,
            sort: null,
            axis: {
              labelOverlap: true,
              grid: false,
              labelAngle: 0,
              ...(data.every(d => Number.isInteger(d.x)) ? { tickMinStep: 1, format: 'd' } : {}),
            },
          }
        : {
            field: 'x',
            type: 'nominal',
            title: comp.xTitle ?? null,
            sort: comp.sort === false ? null : '-y',
            axis: { labelLimit: 140, labelAngle: new Set(data.map(d => d.x)).size > 6 ? -40 : 0 },
          }
    const yEnc = {
      field: 'y',
      type: 'quantitative',
      title: yTitle,
      axis: { format: d3Format(fmtKind), tickCount: 5 },
      scale: { zero: comp.zero !== false && kind !== 'line' },
    }
    const tooltip = [
      {
        field: 'x',
        type: isTime ? 'temporal' : 'nominal',
        title: label(comp.x),
        ...(isTime ? { format: timeFormat } : {}),
      },
      ...(series ? [{ field: 'series', title: seriesTitle ?? 'Series' }] : []),
      { field: 'label', title: yTitle ?? 'Value' },
    ]
    for (const d of data) d.label = valueFmt(d.y)
    const colorEnc = series ? { color: { field: 'series', type: 'nominal', title: seriesTitle, sort: null } } : null
    const negatives = data.some(d => d.y < 0)
    const single = { value: cssVar('--series-1') }
    if (kind === 'pie') {
      spec = {
        data: { values: data },
        mark: { type: 'arc', innerRadius: 50 },
        encoding: {
          theta: { field: 'y', type: 'quantitative' },
          color: { field: 'x', type: 'nominal', title: null, sort: { field: 'y', order: 'descending' } },
          tooltip,
        },
      }
    } else if (kind === 'hbar') {
      const color =
        colorEnc ??
        (negatives
          ? { color: { condition: { test: 'datum.y < 0', value: cssVar('--bad') }, value: cssVar('--good') } }
          : { color: single })
      spec = {
        data: { values: data },
        layer: [
          {
            mark: { type: 'bar' },
            encoding: {
              y: { ...xEnc, sort: comp.sort === false ? null : '-x', axis: { labelLimit: 160, labelAngle: 0 } },
              x: { ...yEnc, axis: { ...yEnc.axis, grid: true } },
              ...color,
              tooltip,
            },
          },
          ...(comp.labels !== false && !series && data.length <= 20
            ? [
                {
                  mark: {
                    type: 'text',
                    align: { expr: 'datum.y < 0 ? "right" : "left"' },
                    dx: { expr: 'datum.y < 0 ? -4 : 4' },
                    fontSize: 11,
                    color: cssVar('--fg-muted'),
                  },
                  encoding: {
                    y: { ...xEnc, sort: comp.sort === false ? null : '-x' },
                    x: { field: 'y', type: 'quantitative' },
                    text: { field: 'label' },
                  },
                },
              ]
            : []),
        ],
        height: comp.height ?? Math.max(120, new Set(data.map(d => d.x)).size * 26),
      }
    } else {
      const mark = kind === 'stacked' ? 'bar' : kind
      if (isTime && mark === 'bar') {
        xEnc = {
          ...xEnc,
          type: 'ordinal',
          timeUnit: {
            day: 'utcyearmonthdate',
            week: 'utcyearweek',
            month: 'utcyearmonth',
            quarter: 'utcyearquarter',
            year: 'utcyear',
          }[comp.time],
        }
        tooltip[0] = { ...tooltip[0], timeUnit: xEnc.timeUnit, type: 'ordinal' }
      }
      const enc = {
        x: xEnc,
        y: { ...yEnc, ...(kind === 'stacked' || kind === 'area' ? { stack: 'zero' } : { stack: null }) },
        ...(colorEnc
          ? kind === 'bar'
            ? { ...colorEnc, xOffset: { field: 'series', sort: null } }
            : colorEnc
          : {
              color:
                negatives && mark === 'bar'
                  ? { condition: { test: 'datum.y < 0', value: cssVar('--bad') }, value: cssVar('--good') }
                  : single,
            }),
        tooltip,
      }
      spec = {
        data: { values: data },
        layer: [
          {
            mark: {
              type: mark,
              ...(mark === 'line' ? { point: data.length < 40, interpolate: 'monotone' } : {}),
              ...(mark === 'area' ? { opacity: 0.85, interpolate: 'monotone' } : {}),
            },
            encoding: enc,
          },
          ...(comp.ref != null
            ? [
                {
                  mark: { type: 'rule', strokeDash: [4, 4], color: cssVar('--fg-muted') },
                  encoding: { y: { datum: Number(ev(comp.ref)) } },
                },
              ]
            : []),
        ],
      }
    }
    renderVega(el, comp, spec)
  }

  /** Aggregate rows into {x, y, series?} points for line/area/bar/hbar/stacked/pie. */
  function seriesData(comp, rows) {
    const isTime = Boolean(comp.time)
    const xKey = isTime ? r => (r[comp.x] ? bucketDate(r[comp.x], comp.time) : null) : r => r[comp.x]
    const sequential = !isTime && ['line', 'area'].includes(comp.kind)
    let data
    if (Array.isArray(comp.y)) {
      const names = comp.labels ?? comp.y.map(label)
      const grouped = groupBy(
        rows,
        [['x', xKey]],
        comp.y.map((f, i) => ({ as: `y${i}`, agg: comp.agg ?? 'sum', field: f }))
      )
      data = grouped.flatMap(g => comp.y.map((_, i) => ({ x: g.x, series: names[i], y: g[`y${i}`] })))
    } else {
      const keys = [['x', xKey]]
      if (comp.color) keys.push(['series', r => r[comp.color]])
      data = groupBy(rows, keys, [{ as: 'y', agg: comp.agg ?? 'sum', field: comp.y, of: comp.of }])
    }
    data = data.filter(d => d.x != null)
    if (!isTime && !sequential) {
      const maxBars = comp.top ?? (comp.kind === 'pie' ? 6 : 15)
      const keep = topN(data, 'x', 'y', maxBars)
      const additive = ['sum', 'count'].includes(comp.agg ?? 'sum')
      data = data
        .map(d => (keep.has(d.x) ? d : additive && comp.kind === 'pie' ? { ...d, x: 'Other' } : null))
        .filter(Boolean)
      if (comp.kind === 'pie') data = groupBy(data, [['x', d => d.x]], [{ as: 'y', agg: 'sum', field: 'y' }])
    }
    if (comp.color) {
      const keep = topN(data, 'series', 'y', MAX_SERIES)
      data = data.filter(d => keep.has(d.series))
    }
    if (isTime) data = data.map(d => ({ ...d, x: new Date(d.x) })).sort((a, b) => a.x - b.x)
    else if (sequential) data.sort((a, b) => (a.x > b.x ? 1 : a.x < b.x ? -1 : 0))
    return { data, isTime, sequential }
  }

  function waterfallSpec(comp, rows, valueFmt) {
    // First and last rows are totals unless `totals` names them; rows between are changes.
    const totals = comp.totals ?? 'ends'
    let running = 0
    const steps = rows.map((r, i) => {
      const v = Number(r[comp.y]) || 0
      const isTotal = Array.isArray(totals)
        ? totals.includes(r[comp.x])
        : totals === 'ends'
          ? i === 0 || i === rows.length - 1
          : false
      const start = isTotal ? 0 : running
      const end = isTotal ? v : running + v
      running = end
      return {
        x: String(r[comp.x]),
        start,
        end,
        top: Math.max(start, end),
        kind: isTotal ? 'total' : v >= 0 ? 'up' : 'down',
        label: isTotal ? valueFmt(v) : `${v >= 0 ? '+' : '−'}${valueFmt(Math.abs(v))}`,
        order: i,
      }
    })
    // Ignore totals' zero baseline when sizing: a bridge's changes are small next to its totals.
    const ends = steps.flatMap(s => (s.kind === 'total' ? [s.end] : [s.start, s.end]))
    const lo = Math.min(...ends)
    const hi = Math.max(...ends)
    const zero = comp.zero ?? (lo <= 0 || lo < hi * 0.5)
    return {
      data: { values: steps },
      encoding: {
        x: { field: 'x', type: 'nominal', sort: null, title: null, axis: { labelAngle: 0, labelLimit: 120 } },
      },
      layer: [
        {
          mark: { type: 'bar', cornerRadius: 2, clip: true },
          encoding: {
            y: {
              field: 'start',
              type: 'quantitative',
              title: null,
              axis: { format: '$,.3~s', tickCount: 5 },
              scale: { zero, domain: zero ? undefined : [lo - (hi - lo) * 0.15, hi + (hi - lo) * 0.05] },
            },
            y2: { field: 'end' },
            color: {
              field: 'kind',
              type: 'nominal',
              legend: null,
              scale: {
                domain: ['total', 'up', 'down'],
                range: [cssVar('--series-1'), cssVar('--good'), cssVar('--bad')],
              },
            },
            tooltip: [
              { field: 'x', title: 'Step' },
              { field: 'label', title: 'Value' },
            ],
          },
        },
        {
          mark: { type: 'text', dy: -6, fontSize: 11, color: cssVar('--fg-muted') },
          encoding: { y: { field: 'top', type: 'quantitative' }, text: { field: 'label' } },
        },
      ],
    }
  }

  function renderFacets(el, comp, rows) {
    const facets = [...new Set(rows.map(r => r[comp.facet]))]
    el.innerHTML = `${heading(comp)}<div class="dk-facets"></div>${caption(comp)}`
    const wrap = el.querySelector('.dk-facets')
    const all = seriesData({ ...comp, facet: undefined, color: comp.facet }, rows).data
    const ys = all.map(d => d.y).concat(comp.ref != null ? [Number(ev(comp.ref))] : [])
    const domain = [Math.min(...ys), Math.max(...ys)]
    const valueFmt = fmtOf(comp.fmt)
    for (const f of facets) {
      const cell = document.createElement('div')
      cell.className = 'dk-facet'
      const pts = all.filter(d => d.series === f)
      const lastY = pts.at(-1)?.y
      cell.innerHTML = `<div class="dk-facet-head"><span>${esc(f)}</span><strong>${esc(valueFmt(lastY))}</strong></div><div class="dk-chart"></div>`
      wrap.append(cell)
      const isTime = Boolean(comp.time)
      const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        width: 'container',
        height: comp.height ?? 110,
        autosize: { type: 'fit', contains: 'padding' },
        config: vegaConfig(),
        data: { values: pts.map(p => ({ ...p, label: valueFmt(p.y) })) },
        layer: [
          {
            mark: {
              type: comp.kind === 'bar' ? 'bar' : comp.kind === 'area' ? 'area' : 'line',
              interpolate: 'monotone',
              point: pts.length < 16,
            },
            encoding: {
              x: {
                field: 'x',
                type: isTime ? 'temporal' : 'ordinal',
                sort: null,
                title: null,
                axis: {
                  labelOverlap: true,
                  grid: false,
                  labelFontSize: 9,
                  labelAngle: 0,
                  values: isTime ? undefined : [pts[0]?.x, pts.at(-1)?.x],
                },
              },
              y: {
                field: 'y',
                type: 'quantitative',
                title: null,
                scale: { domain, zero: false },
                axis: { format: d3Format(String(comp.fmt ?? '').split(':')[0]), tickCount: 3, labelFontSize: 9 },
              },
              color: { value: cssVar('--series-1') },
              tooltip: [
                { field: 'x', title: label(comp.x) },
                { field: 'label', title: label(comp.y) },
              ],
            },
          },
          ...(comp.ref != null
            ? [
                {
                  mark: { type: 'rule', strokeDash: [3, 3], color: cssVar('--fg-muted') },
                  encoding: { y: { datum: Number(ev(comp.ref)) } },
                },
              ]
            : []),
        ],
      }
      track(
        window
          .vegaEmbed(cell.querySelector('.dk-chart'), spec, { actions: false, renderer: 'svg' })
          .catch(e => onEvent({ type: 'error', id: comp.id, message: e.message }))
      )
    }
  }

  function renderVega(el, comp, spec) {
    if (!el.querySelector(':scope > .dk-chart'))
      el.innerHTML = `<h3></h3><div class="dk-chart" style="min-height:${spec.height ?? comp.height ?? 240}px"></div><p class="dk-caption"></p>`
    const h3 = el.querySelector('h3')
    h3.textContent = comp.title ? tpl(comp.title) : ''
    h3.hidden = !comp.title
    const cap = el.querySelector('.dk-caption')
    cap.textContent = comp.caption ? tpl(comp.caption) : ''
    cap.hidden = !comp.caption
    const full = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: comp.height ?? 240,
      autosize: { type: 'fit', contains: 'padding' },
      config: vegaConfig(),
      ...spec,
    }
    track(
      window
        .vegaEmbed(el.querySelector('.dk-chart'), full, { actions: false, renderer: 'svg' })
        .then(res => {
          views.get(comp.id)?.finalize()
          views.set(comp.id, res.view)
        })
        .catch(e => {
          el.querySelector('.dk-chart').innerHTML = `<div class="dk-error">${esc(e.message)}</div>`
          onEvent({ type: 'error', id: comp.id, message: e.message })
        })
    )
  }

  function renderHeader() {
    $('.dk-kicker').textContent = app.kicker ? tpl(app.kicker) : ''
    $('.dk-title').textContent = tpl(app.title ?? '')
    $('.dk-subtitle').textContent = app.subtitle ? tpl(app.subtitle) : ''
    $('.dk-subtitle').hidden = !app.subtitle
    const tone = app.tone ? toneClass(tpl(app.tone)) : null
    $('.dk-header').className =
      `dk-header${tone ? ` dk-edge-${tone}` : ''}${!app.title && headerPending ? ' dk-header-pending' : ''}`
    document.title = $('.dk-title').textContent || 'Data app'
  }

  function refreshData() {
    computeView()
    renderHeader()
    for (const c of components) renderComp(c)
  }
  function refresh() {
    computeView()
    renderControls()
    renderHeader()
    for (const c of components) renderComp(c)
  }
  function renderAll() {
    computeView()
    renderHeader()
    renderControls()
    placeCards()
    for (const c of components) renderComp(c)
  }

  const skeletonKinds = comp =>
    comp.t === 'kpi'
      ? ['kpi']
      : comp.t === 'list'
        ? ['list', 'detail', 'table']
        : comp.t === 'detail'
          ? ['detail', 'list']
          : comp.t === 'table'
            ? ['table', 'list', 'chart']
            : ['chart', 'trend', 'vega'].includes(comp.t) || comp.t === 'chart'
              ? ['line', 'area'].includes(comp.kind)
                ? ['trend', 'chart', 'table']
                : ['chart', 'trend', 'table']
              : []
  /** Index of the skeleton (same part, closest kind) a new component should take over, or -1. */
  function takeoverIndex(op) {
    if (!isVisual(op) || ['section', 'text'].includes(op.t)) return -1
    const kinds = op.t === 'vega' ? ['chart', 'trend'] : skeletonKinds(op)
    for (const k of kinds) {
      const i = components.findIndex(c => isPlaceholder(c) && c.__slot === op.__slot && c.kind === k)
      if (i >= 0) return i
    }
    return op.t === 'kpi'
      ? -1
      : components.findIndex(c => isPlaceholder(c) && c.__slot === op.__slot && c.kind !== 'kpi')
  }

  function dropPlaceholders(slot) {
    for (let i = components.length - 1; i >= 0; i--)
      if (isPlaceholder(components[i]) && components[i].__slot === slot) components.splice(i, 1)
  }

  // ----- ops -----
  const pending = []
  function apply(raw) {
    if (!ctx) {
      pending.push(raw)
      return
    }
    const parsed = typeof raw === 'string' ? parseLine(raw) : raw
    if (!parsed) return
    const { op, errors, fixes } = checkOp(parsed, ctx)
    if (fixes.length) onEvent({ type: 'fix', fixes })
    if (!op) {
      onEvent({ type: 'invalid', errors, raw: parsed })
      return
    }
    commitOp(ctx, op)
    onEvent({ type: 'op', op })
    const idx = components.findIndex(c => c.id === op.id)
    if (op.t === 'theme') {
      theme = op
      applyTheme(op, root)
      // Charts read colors when they render, so redraw everything; fonts redraw once loaded.
      if (view) renderAll()
      document.fonts?.ready.then(() => view && renderAll())
      return
    }
    if (op.t === 'app') {
      headerPending = false
      app = op
      if (view) renderHeader()
      return
    }
    if (op.t === 'del') components.splice(idx, 1)
    else if (op.t === 'move') {
      const [c] = components.splice(idx, 1)
      const to = op.before ? components.findIndex(x => x.id === op.before) : -1
      components.splice(to < 0 ? components.length : to, 0, c)
    } else if (op.t === 'set') components[idx] = op.merged
    else if (idx >= 0) components[idx] = op
    else if (op.__slot != null) {
      const ph = takeoverIndex(op)
      if (ph >= 0) {
        // The component takes over its skeleton's card: same element, same place, morphs to fit.
        const el = root.querySelector(`[data-id="${CSS.escape(components[ph].id)}"]`)
        if (el) {
          el.dataset.morphFrom = String(el.offsetHeight)
          el.dataset.id = op.id
        }
        components[ph] = op
      } else {
        // Parallel parts: keep each part's components together, in part order, ahead of its unused skeletons.
        const firstPh = components.findIndex(c => isPlaceholder(c) && c.__slot === op.__slot)
        const at =
          firstPh >= 0 && ['section', 'text'].includes(op.t)
            ? firstPh
            : components.findIndex(
                c =>
                  (c.__slot ?? Number.POSITIVE_INFINITY) > op.__slot ||
                  (isPlaceholder(c) && c.__slot === op.__slot && !isVisual(op))
              )
        at < 0 ? components.push(op) : components.splice(at, 0, op)
      }
    } else components.push(op)
    const comp = op.t === 'set' ? op.merged : op
    if (['filter', 'calc', 'derive', 'input'].includes(comp.t) || op.t === 'del') renderAll()
    else {
      placeCards()
      if (op.t !== 'move') renderComp(comp)
    }
  }
  ready
    .then(() => {
      for (const p of pending.splice(0)) apply(p)
    })
    .catch(e => onEvent({ type: 'error', id: 'data', message: e.message }))

  return {
    ready,
    apply,
    applyText(text) {
      for (const line of text.split('\n')) apply(line)
    },
    setStatus(text) {
      const s = $('.dk-status')
      s.hidden = !text
      s.textContent = text ?? ''
    },
    spec: () => toJsonl([app, ...(theme ? [theme] : []), ...components.filter(c => !isPlaceholder(c))]),
    /** Resolves once every chart render in flight has finished and the browser has painted. */
    async settled() {
      await ready
      while (inflight.size) await Promise.allSettled([...inflight])
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    },
    /**
     * Lay out skeletons for a generation plan before any model output arrives.
     * parts: [{ slot, kind: 'head'|'kpi'|'chart'|'table'|'list'|'detail', count?, span?, label? }]
     */
    setPlan(parts) {
      const apply = () => {
        for (const p of parts) {
          if (p.kind === 'head') {
            headerPending = true
            continue
          }
          for (let i = 0; i < (p.count ?? 1); i++) {
            components.push({
              t: 'placeholder',
              id: `__ph_${p.slot}_${i}`,
              __slot: p.slot,
              kind: p.kind,
              span: p.span ?? (p.kind === 'kpi' ? 3 : p.kind === 'table' ? 12 : 6),
              label: p.label,
            })
          }
        }
        components.sort((a, b) => (a.__slot ?? 1e9) - (b.__slot ?? 1e9))
        if (view) renderAll()
      }
      ready.then(apply).catch(() => {})
    },
    /** A part finished: remove any skeletons it never replaced. */
    partDone(slot) {
      ready
        .then(() => {
          if (slot === 0) {
            headerPending = false
            renderHeader()
          }
          const leftovers = components.filter(c => isPlaceholder(c) && c.__slot === slot)
          if (!leftovers.length) return
          for (const c of leftovers) root.querySelector(`[data-id="${CSS.escape(c.id)}"]`)?.classList.add('dk-collapse')
          setTimeout(() => {
            dropPlaceholders(slot)
            placeCards()
          }, 260)
        })
        .catch(() => {})
    },
  }
}

/** Source loaders for the static (published) app. */
export const loaders = {
  csv: url => () => fetch(url).then(r => r.text()),
  json: url => () => fetch(url).then(r => r.json()),
}
