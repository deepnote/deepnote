;(() => {
  const NOTEBOOK_ID = '4e816d2eaff74817ae800f8cd09e972e'
  const notebook = Deepnote.connect().notebook(NOTEBOOK_ID)

  const PLANCK = 1.616255e-35
  const P_REAL = 450,
    P_INF = 985,
    P_MAX = 1000 // slider zones: real data | extrapolated | infinity
  const LENS_RATIO = 14 // lens field of view = 14 sticks
  const R = 6371008.8,
    TAU = Math.PI * 2
  const DEFAULT_ISLAND = 'Milos'
  const GREEK = {
    Crete: 'Κρήτη',
    Rhodes: 'Ρόδος',
    Corfu: 'Κέρκυρα',
    Kefalonia: 'Κεφαλονιά',
    Zakynthos: 'Ζάκυνθος',
    Naxos: 'Νάξος',
    Milos: 'Μήλος',
    Santorini: 'Σαντορίνη',
    Mykonos: 'Μύκονος',
  }
  const STICK_REFS = [
    [42195, 'a marathon'],
    [8849, 'Mount Everest'],
    [1000, 'ten football pitches'],
    [105, 'a football pitch'],
    [30, 'a blue whale'],
    [4.5, 'a car'],
    [1.75, 'a person'],
    [0.3, 'a sandal'],
    [0.03, 'a pebble'],
    [1e-3, 'a grain of sand'],
    [8e-5, 'the width of a hair'],
    [7e-6, 'a red blood cell'],
    [1e-6, 'a bacterium'],
    [1e-7, 'a virus'],
    [2e-9, 'the width of DNA'],
    [1e-10, 'an atom'],
    [1e-15, 'a proton'],
    [1e-18, 'a quark, at most'],
    [1e-26, 'nothing we can ever measure'],
    [PLANCK, 'the Planck length'],
  ]

  const $ = id => document.getElementById(id)
  const el = {
    slider: $('slider'),
    ticks: $('ticks'),
    picker: $('picker'),
    stage: document.querySelector('.stage'),
    lens: $('lens'),
    lensWrap: $('lensWrap'),
    lensZoom: $('lensZoom'),
    lensFov: $('lensFov'),
    callout: $('callout'),
    bigLen: $('bigLen'),
    bigUnit: $('bigUnit'),
    lenCompare: $('lenCompare'),
    lenGrowth: $('lenGrowth'),
    lengthCard: $('lengthCard'),
    statSticks: $('statSticks'),
    statD: $('statD'),
    statArea: $('statArea'),
    phase: $('phase'),
    stickLen: $('stickLen'),
    stickCompare: $('stickCompare'),
    chart: $('chart'),
    islandName: $('islandName'),
    islandGreek: $('islandGreek'),
    mapLoading: $('mapLoading'),
    loadingSub: $('loadingSub'),
    diveBtn: $('diveBtn'),
    resetBtn: $('resetBtn'),
    flash: $('flash'),
    errorState: $('errorState'),
    errorMsg: $('errorMsg'),
    runBtn: $('runBtn'),
    runStatus: $('runStatus'),
  }

  const S = {
    islands: [],
    I: null,
    p: 0,
    eps: 0,
    L: 0,
    walk: null,
    minWalk: null,
    curve: null,
    coarseLen: 1,
    map: null,
    mapReady: false,
    mapWalkRef: null,
    pendingP: null,
    dispLog: null,
    targetLog: null,
    auto: null,
    zInf: 0,
    wasInf: false,
    lensDirty: true,
    calloutDirty: true,
    lastT: 0,
    tan: [1, 0],
    nland: [0, 1],
  }

  // ---------------- formatting ----------------
  const SUP = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '-': '⁻',
  }
  const sup = n =>
    String(n)
      .split('')
      .map(c => SUP[c] || c)
      .join('')
  function sci(v, digits = 2) {
    const e = Math.floor(Math.log10(v))
    const m = v / 10 ** e
    return `${m.toFixed(digits)}×10${sup(e)}`
  }
  function trim(v) {
    return v >= 100
      ? Math.round(v).toLocaleString('en-US')
      : v >= 10
        ? v.toFixed(1).replace(/\.0$/, '')
        : v.toFixed(2).replace(/\.?0+$/, '')
  }
  function fmtLen(m) {
    if (m === 0) return '0 m'
    const units = [
      [1e3, 'km'],
      [1, 'm'],
      [1e-2, 'cm'],
      [1e-3, 'mm'],
      [1e-6, 'µm'],
      [1e-9, 'nm'],
      [1e-12, 'pm'],
      [1e-15, 'fm'],
      [1e-18, 'am'],
    ]
    for (const [f, u] of units) if (m >= f * 0.9995) return `${trim(m / f)} ${u}`
    return `${sci(m)} m`
  }
  function kmStr(km) {
    if (km < 1000) return km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    if (km < 1e7) return Math.round(km).toLocaleString('en-US')
    return sci(km)
  }
  const fx = v => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1))
  function coastCompare(km) {
    if (km >= 1.496e8 * 0.3) return `≈ ${fx(km / 1.496e8)}× the distance from Earth to the Sun`
    if (km >= 384400 * 0.3) return `≈ ${fx(km / 384400)}× the distance to the Moon`
    if (km >= 40075 * 0.25) return `≈ ${fx(km / 40075)}× around the Earth`
    if (km >= 1500) return `≈ ${fx(km / 2390)}× Athens → London`
    if (km >= 250) return `≈ ${fx(km / 502)}× Athens → Thessaloniki`
    return `≈ ${fx(km / 42.195)} marathons`
  }
  function stickCompare(m) {
    if (m === 0) return 'a stick of zero length'
    let best = STICK_REFS[0],
      bd = Number.POSITIVE_INFINITY
    for (const r of STICK_REFS) {
      const d = Math.abs(Math.log10(m) - Math.log10(r[0]))
      if (d < bd) {
        bd = d
        best = r
      }
    }
    return `≈ ${best[1]}`
  }
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }

  // ---------------- geometry ----------------
  function prep(d) {
    if (!d || !Array.isArray(d.coords) || d.coords.length < 4) return null
    const kx = (Math.PI / 180) * R * Math.cos((d.lat0 * Math.PI) / 180),
      ky = (Math.PI / 180) * R
    let c = d.coords
    const f = c[0],
      l = c[c.length - 1]
    if (f[0] !== l[0] || f[1] !== l[1]) c = c.concat([f])
    const n = c.length,
      xs = new Float64Array(n),
      ys = new Float64Array(n)
    let minLon = 180,
      minLat = 90,
      maxLon = -180,
      maxLat = -90,
      mx = 0,
      my = 0,
      a2 = 0
    for (let i = 0; i < n; i++) {
      xs[i] = (c[i][0] - d.lon0) * kx
      ys[i] = (c[i][1] - d.lat0) * ky
      minLon = Math.min(minLon, c[i][0])
      maxLon = Math.max(maxLon, c[i][0])
      minLat = Math.min(minLat, c[i][1])
      maxLat = Math.max(maxLat, c[i][1])
      mx += xs[i] / n
      my += ys[i] / n
    }
    for (let i = 0; i < n - 1; i++) a2 += xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
    let best = 0,
      bd = -1
    for (let i = 0; i < n - 1; i++) {
      const dd = (xs[i] - mx) ** 2 + (ys[i] - my) ** 2
      if (dd > bd) {
        bd = dd
        best = i
      }
    }
    return {
      ...d,
      coords: c,
      xs,
      ys,
      n,
      kx,
      ky,
      ccw: a2 > 0,
      anchor: best,
      greek: GREEK[d.name] || '',
      D: Number(d.fractal_dimension) || 1.15,
      epsMin: Number(d.eps_min_m) || 25,
      epsMax: Math.max((d.span_m || 10000) / 2.5, (Number(d.eps_min_m) || 25) * 20),
      bounds: [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
    }
  }
  const toLL = (I, x, y) => [I.lon0 + x / I.kx, I.lat0 + y / I.ky]

  // Richardson divider walk around the ring, starting at the anchor vertex
  function walkRing(I, eps) {
    const m = I.n - 1,
      a = I.anchor,
      xs = I.xs,
      ys = I.ys
    let cx = xs[a],
      cy = ys[a]
    const pts = [cx, cy]
    let i = 1,
      sticks = 0
    while (i <= m) {
      const bi = (a + i) % m,
        bx = xs[bi],
        by = ys[bi]
      const ex = bx - cx,
        ey = by - cy
      if (ex * ex + ey * ey < eps * eps) {
        i++
        continue
      }
      const ai = (a + i - 1) % m,
        ax = xs[ai],
        ay = ys[ai]
      const dx = bx - ax,
        dy = by - ay,
        fx_ = ax - cx,
        fy = ay - cy
      const A = dx * dx + dy * dy || 1e-12,
        B = 2 * (fx_ * dx + fy * dy),
        C = fx_ * fx_ + fy * fy - eps * eps
      const t = (-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A)
      cx = ax + t * dx
      cy = ay + t * dy
      pts.push(cx, cy)
      sticks++
    }
    const rem = Math.hypot(xs[a] - cx, ys[a] - cy)
    pts.push(xs[a], ys[a])
    return { pts, sticks, length: sticks * eps + rem }
  }

  function epsAt(p) {
    const I = S.I
    if (p >= P_INF) return 0
    const lMax = Math.log10(I.epsMax),
      lMin = Math.log10(I.epsMin),
      lP = Math.log10(PLANCK)
    if (p <= P_REAL) return 10 ** (lMax + ((lMin - lMax) * p) / P_REAL)
    return 10 ** (lMin + ((lP - lMin) * (p - P_REAL)) / (P_INF - P_REAL))
  }
  function posAt(eps) {
    const I = S.I
    if (eps <= 0) return P_MAX
    const l = Math.log10(eps),
      lMax = Math.log10(I.epsMax),
      lMin = Math.log10(I.epsMin),
      lP = Math.log10(PLANCK)
    if (l >= lMin) return (P_REAL * (l - lMax)) / (lMin - lMax)
    return P_REAL + ((P_INF - P_REAL) * (l - lMin)) / (lP - lMin)
  }
  function lengthAt(eps) {
    const I = S.I
    if (eps === 0) return Number.POSITIVE_INFINITY
    if (eps >= I.epsMin) return walkRing(I, eps).length
    return S.minWalk.length * (eps / I.epsMin) ** (1 - I.D)
  }

  function computeTangent() {
    const I = S.I,
      m = I.n - 1,
      a = I.anchor,
      target = I.epsMin * 1.5
    let f = a,
      b = a
    for (let k = 1; k < m / 2; k++) {
      f = (a + k) % m
      if (Math.hypot(I.xs[f] - I.xs[a], I.ys[f] - I.ys[a]) > target) break
    }
    for (let k = 1; k < m / 2; k++) {
      b = (a - k + m) % m
      if (Math.hypot(I.xs[b] - I.xs[a], I.ys[b] - I.ys[a]) > target) break
    }
    let tx = I.xs[f] - I.xs[b],
      ty = I.ys[f] - I.ys[b]
    const n = Math.hypot(tx, ty) || 1
    tx /= n
    ty /= n
    S.tan = [tx, ty]
    S.nland = I.ccw ? [-ty, tx] : [ty, -tx]
  }
  function computeCurve() {
    const I = S.I
    const arr = []
    for (let k = 0; k <= 24; k++) {
      const p = (P_REAL * k) / 24
      arr.push([p, walkRing(I, epsAt(p)).length])
    }
    S.curve = arr
    S.coarseLen = arr[0][1]
    S.minWalk = walkRing(I, I.epsMin)
  }

  // ---------------- core update ----------------
  function applyP(p) {
    const I = S.I
    if (!I) return
    S.p = p
    const eps = epsAt(p)
    S.eps = eps
    S.walk = eps >= I.epsMin ? walkRing(I, eps) : S.minWalk
    S.L =
      eps === 0
        ? Number.POSITIVE_INFINITY
        : eps >= I.epsMin
          ? S.walk.length
          : S.minWalk.length * (eps / I.epsMin) ** (1 - I.D)
    S.targetLog = Number.isFinite(S.L) ? Math.log10(S.L) : null
    if (eps === 0 && !S.wasInf) {
      S.zInf = Math.log2(I.epsMin / PLANCK)
      el.flash.classList.remove('go')
      void el.flash.offsetWidth
      el.flash.classList.add('go')
    }
    S.wasInf = eps === 0
    updateMapSticks()
    updateTexts()
    drawChart()
    S.lensDirty = true
    S.calloutDirty = true
  }

  function updateTexts() {
    const I = S.I,
      eps = S.eps,
      inf = eps === 0
    el.stickLen.textContent = inf ? '0' : fmtLen(eps)
    el.stickCompare.textContent = stickCompare(eps)
    el.statD.textContent = I.D.toFixed(3)
    const td = document.getElementById('theoryD')
    if (td) td.textContent = `${I.name} measures D = ${I.D.toFixed(3)}.`
    el.statArea.textContent = `${Math.round(I.area_km2).toLocaleString('en-US')} km²`
    el.lengthCard.classList.toggle('inf-mode', inf)
    if (inf) {
      el.statSticks.textContent = '∞'
      el.lenCompare.textContent = 'Longer than any distance you can name'
      el.lenGrowth.textContent = 'The coastline has no well-defined length.'
    } else {
      const km = S.L / 1000,
        n = S.L / eps
      el.statSticks.textContent =
        n < 1e7 ? Math.round(n).toLocaleString('en-US') : `~10${sup(Math.floor(Math.log10(n)))}`
      el.lenCompare.textContent = coastCompare(km)
      el.lenGrowth.textContent = `${fx(S.L / S.coarseLen)}× what ${fmtLen(I.epsMax)} sticks measure`
    }
    let cls = '',
      msg
    if (inf) {
      cls = 'weird'
      msg = `Stick length → 0, so length → ∞. ${I.name} has no single, true coastline length. Every answer depends on the ruler.`
    } else if (eps >= I.epsMin)
      msg = `Real measurement: ${S.walk.sticks.toLocaleString('en-US')} straight sticks walked around the OpenStreetMap coastline of ${I.name}.`
    else if (eps >= 1e-10) {
      cls = 'extra'
      msg = `Finer than the map’s ${fmtLen(I.epsMin)} resolution. Extrapolating with ${I.name}’s fractal dimension D = ${I.D.toFixed(3)}: every 10× shorter stick adds ${Math.round((10 ** (I.D - 1) - 1) * 100)}% length.`
    } else {
      cls = 'weird'
      msg = 'Smaller than an atom. Physics no longer applies here, but the mathematics keeps going.'
    }
    el.phase.className = `mt-4 phase rounded-xl px-3 py-2.5 text-xs leading-relaxed ${cls}`
    el.phase.textContent = msg
  }

  let lastBig = ''
  function renderBig() {
    let txt, unit, cls
    if (S.eps === 0) {
      txt = '∞'
      unit = ''
      cls = 'big-num font-mono font-bold inf'
    } else {
      const km = 10 ** S.dispLog / 1000
      txt = kmStr(km)
      unit = 'km'
      cls = `big-num font-mono font-bold${S.eps < S.I.epsMin ? ' extra' : ''}`
    }
    const key = txt + unit + cls
    if (key === lastBig) return
    lastBig = key
    el.bigLen.textContent = txt
    el.bigUnit.textContent = unit
    el.bigLen.className = cls
  }

  // ---------------- map ----------------
  const ll = c => [c[1], c[0]] // [lon,lat] -> Leaflet [lat,lng]
  const mppAt = lat => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** S.map.getZoom())
  function initMap() {
    const map = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      attributionControl: true,
      center: [37.4, 24.6],
      zoom: 6,
    })
    S.map = map
    map.attributionControl.setPrefix(false)
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      maxNativeZoom: 18,
      className: 'sat-tiles',
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Coastlines © OpenStreetMap contributors',
    }).addTo(map)
    const R_ = L.canvas({ padding: 0.3 })
    S.lyr = {
      land: L.polygon([], {
        renderer: R_,
        stroke: false,
        fillColor: '#1560AB',
        fillOpacity: 0.3,
        interactive: false,
      }).addTo(map),
      coastGlow: L.polyline([], { renderer: R_, color: '#3793EF', weight: 7, opacity: 0.25, interactive: false }).addTo(
        map
      ),
      coast: L.polyline([], { renderer: R_, color: '#6AB3F4', weight: 1.3, opacity: 0.95, interactive: false }).addTo(
        map
      ),
      sticksGlow: L.polyline([], {
        renderer: R_,
        color: '#00A9FF',
        weight: 9,
        opacity: 0.4,
        interactive: false,
        lineJoin: 'round',
      }).addTo(map),
      sticks: L.polyline([], {
        renderer: R_,
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        interactive: false,
        lineJoin: 'round',
      }).addTo(map),
      verts: L.layerGroup().addTo(map),
    }
    S.vertRenderer = R_
    map.on('move zoom', () => {
      S.calloutDirty = true
    })
    map.on('dragstart', () => {
      S.userMoved = true
    })
    map.getContainer().addEventListener(
      'wheel',
      () => {
        S.userMoved = true
      },
      { passive: true }
    )
    new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
      resizeLens()
      S.calloutDirty = true
      if (S.I) {
        buildTicks()
        drawChart()
      }
      if (!S.userMoved) {
        clearTimeout(S.refitT)
        S.refitT = setTimeout(() => fitIsland(0), 120)
      }
    }).observe(el.stage)
    map.on('click', e => {
      const I = S.I
      if (!I) return
      let best = -1,
        bd = Number.POSITIVE_INFINITY
      for (let i = 0; i < I.n - 1; i++) {
        const q = map.latLngToContainerPoint(ll(I.coords[i]))
        const d = (q.x - e.containerPoint.x) ** 2 + (q.y - e.containerPoint.y) ** 2
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (bd < 45 * 45) {
        I.anchor = best
        computeTangent()
        computeCurve()
        applyP(S.p)
      }
    })
    S.mapReady = true
    el.mapLoading.classList.add('hidden')
    refreshMapIsland(true)
  }

  function fitPadding() {
    const w = el.stage.clientWidth,
      h = el.stage.clientHeight,
      ls = el.lensWrap.clientWidth
    const p =
      w < 768 ? { top: 100, bottom: ls + 40, left: 24, right: 24 } : { top: 110, bottom: 40, left: 40, right: ls + 70 }
    // never let padding swallow the map: keep at least 55% of each dimension for the island
    const fx_ = Math.min(1, (w * 0.45) / (p.left + p.right)),
      fy = Math.min(1, (h * 0.45) / (p.top + p.bottom))
    return { top: p.top * fy, bottom: p.bottom * fy, left: p.left * fx_, right: p.right * fx_ }
  }
  function fitIsland(duration) {
    if (!S.mapReady || !S.I) return
    S.map.invalidateSize({ pan: false })
    if (el.stage.clientWidth < 50 || el.stage.clientHeight < 50) return
    const p = fitPadding(),
      b = S.I.bounds
    const bounds = L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]])
    const opts = { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom] }
    if (duration) S.map.flyToBounds(bounds, { ...opts, duration: duration / 1000, easeLinearity: 0.2 })
    else S.map.fitBounds(bounds, { ...opts, animate: false })
  }
  function refreshMapIsland(fly) {
    if (!S.mapReady || !S.I) return
    const c = S.I.coords.map(ll)
    S.lyr.land.setLatLngs(c)
    S.lyr.coastGlow.setLatLngs(c)
    S.lyr.coast.setLatLngs(c)
    S.mapWalkRef = null
    updateMapSticks()
    S.userMoved = false
    fitIsland(fly ? 2400 : 0)
  }
  function updateMapSticks() {
    if (!S.mapReady || !S.walk || S.mapWalkRef === S.walk) return
    S.mapWalkRef = S.walk
    const I = S.I,
      pts = S.walk.pts,
      coords = []
    for (let i = 0; i < pts.length; i += 2) coords.push(ll(toLL(I, pts[i], pts[i + 1])))
    S.lyr.sticks.setLatLngs(coords)
    S.lyr.sticksGlow.setLatLngs(coords)
    S.lyr.verts.clearLayers()
    if (S.walk.sticks <= 600)
      for (const c of coords)
        L.circleMarker(c, {
          renderer: S.vertRenderer,
          radius: 3,
          color: '#00A9FF',
          weight: 1.5,
          fillColor: '#ffffff',
          fillOpacity: 1,
          interactive: false,
        }).addTo(S.lyr.verts)
  }

  // ---------------- lens ----------------
  function lensW() {
    const I = S.I
    if (S.eps === 0) return (I.epsMin * LENS_RATIO) / 2 ** (S.zInf - Math.log2(I.epsMin / I.epsMin))
    return Math.min(LENS_RATIO * S.eps, I.span_m * 1.3)
  }
  function lensZ() {
    const I = S.I
    if (S.eps === 0) return S.zInf
    return S.eps >= I.epsMin ? 0 : Math.log2(I.epsMin / S.eps)
  }
  function hash(o) {
    const x = Math.sin(o * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  function fbm(u, z) {
    const H = 0.6,
      BASE = 2.2
    let y = 0
    const o0 = Math.floor(z) - 3,
      o1 = Math.floor(z) + 7
    for (let o = o0; o <= o1; o++) {
      const j = o - z
      const w = smooth(-3, -1.5, j) * (1 - smooth(4.5, 6.5, j))
      if (w <= 0) continue
      const f = BASE * 2 ** j,
        A = 0.085 * 2 ** (-j * H) * w
      const p1 = hash(o) * TAU,
        p2 = hash(o + 0.37) * TAU
      y +=
        A *
        (0.65 * Math.sin(TAU * f * u + p1) +
          0.35 * Math.sin(TAU * 1.73 * f * u + p2) -
          0.65 * Math.sin(p1) -
          0.35 * Math.sin(p2))
    }
    return y
  }
  function walkPoly(X, Y, start, dir, len) {
    let cx = X[start],
      cy = Y[start]
    const out = [[cx, cy]]
    let i = start + dir
    while (i >= 0 && i < X.length && out.length < 80) {
      const ex = X[i] - cx,
        ey = Y[i] - cy
      if (ex * ex + ey * ey < len * len) {
        i += dir
        continue
      }
      const ax = X[i - dir],
        ay = Y[i - dir],
        dx = X[i] - ax,
        dy = Y[i] - ay,
        fx_ = ax - cx,
        fy = ay - cy
      const A = dx * dx + dy * dy || 1e-12,
        B = 2 * (fx_ * dx + fy * dy),
        C = fx_ * fx_ + fy * fy - len * len
      const t = (-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A)
      cx = ax + t * dx
      cy = ay + t * dy
      out.push([cx, cy])
    }
    return out
  }
  function strokeSticks(ctx, pts, dpr) {
    if (pts.length < 2) return
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = '#00A9FF'
    ctx.shadowBlur = 14 * dpr
    ctx.strokeStyle = 'rgba(0,169,255,0.95)'
    ctx.lineWidth = 4.5 * dpr
    ctx.beginPath()
    pts.forEach(([x, y], i) => {
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.6 * dpr
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    for (const [x, y] of pts) {
      ctx.beginPath()
      ctx.arc(x, y, 2.6 * dpr, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }
  function drawLens() {
    const I = S.I
    if (!I) return
    const cv = el.lens,
      ctx = cv.getContext('2d'),
      Sz = cv.width,
      dpr = Sz / (cv.clientWidth || 1),
      c = Sz / 2
    ctx.save()
    ctx.clearRect(0, 0, Sz, Sz)
    ctx.beginPath()
    ctx.arc(c, c, c, 0, TAU)
    ctx.clip()
    ctx.fillStyle = '#00041C'
    ctx.fillRect(0, 0, Sz, Sz)
    const z = lensZ(),
      real = S.eps >= I.epsMin
    if (real || z < 1) drawReal(ctx, Sz, dpr, real ? 1 : 1 - z, real)
    if (!real) drawProc(ctx, Sz, dpr, z, Math.min(1, z))
    // reticle
    ctx.strokeStyle = 'rgba(106,179,244,0.14)'
    ctx.lineWidth = 1 * dpr
    for (let k = 1; k < 4; k++) {
      ctx.beginPath()
      ctx.arc(c, c, (c * k) / 4, 0, TAU)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(c, 0)
    ctx.lineTo(c, Sz)
    ctx.moveTo(0, c)
    ctx.lineTo(Sz, c)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(106,179,244,0.5)'
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * TAU,
        r0 = c - (k % 6 === 0 ? 12 : 6) * dpr
      ctx.beginPath()
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
      ctx.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c)
      ctx.stroke()
    }
    ctx.restore()
  }
  function drawReal(ctx, Sz, dpr, alpha, withSticks) {
    const I = S.I,
      W = lensW(),
      sc = Sz / W,
      ax = I.xs[I.anchor],
      ay = I.ys[I.anchor],
      c = Sz / 2
    const X = x => (x - ax) * sc + c,
      Y = y => -(y - ay) * sc + c
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    for (let i = 0; i < I.n; i++) {
      const x = X(I.xs[i]),
        y = Y(I.ys[i])
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = '#0A4989'
    ctx.fill()
    ctx.shadowColor = '#3793EF'
    ctx.shadowBlur = 12 * dpr
    ctx.strokeStyle = '#6AB3F4'
    ctx.lineWidth = 1.6 * dpr
    ctx.stroke()
    ctx.restore()
    if (withSticks && S.walk) {
      const pts = S.walk.pts,
        out = [],
        lim = Sz * 1.5
      for (let i = 0; i < pts.length; i += 2) {
        const x = X(pts[i]),
          y = Y(pts[i + 1])
        if (x > -lim && x < Sz + lim && y > -lim && y < Sz + lim) out.push([x, y])
        else if (out.length && out[out.length - 1] !== null) {
          strokeSticks(ctx, out.splice(0), dpr)
        }
      }
      strokeSticks(ctx, out, dpr)
    }
  }
  function drawProc(ctx, Sz, dpr, z, alpha) {
    const N = 1400,
      amp = smooth(0, 1.5, z),
      [tx, ty] = S.tan,
      [nx, ny] = S.nland,
      c = Sz / 2
    const X = new Float64Array(N),
      Y = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const u = -0.8 + (1.6 * i) / (N - 1),
        v = amp * fbm(u, z)
      X[i] = c + (u * tx + v * nx) * Sz
      Y[i] = c - (u * ty + v * ny) * Sz
    }
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(X[0], Y[0])
    for (let i = 1; i < N; i++) ctx.lineTo(X[i], Y[i])
    const far = 2 * Sz
    ctx.lineTo(X[N - 1] + nx * far, Y[N - 1] - ny * far)
    ctx.lineTo(X[0] + nx * far, Y[0] - ny * far)
    ctx.closePath()
    ctx.fillStyle = '#0A4989'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(X[0], Y[0])
    for (let i = 1; i < N; i++) ctx.lineTo(X[i], Y[i])
    ctx.shadowColor = '#3793EF'
    ctx.shadowBlur = 14 * dpr
    ctx.strokeStyle = '#6AB3F4'
    ctx.lineWidth = 1.6 * dpr
    ctx.stroke()
    ctx.restore()
    const mid = Math.floor((N - 1) / 2)
    if (S.eps > 0) {
      const len = Sz / LENS_RATIO
      const fwd = walkPoly(X, Y, mid, 1, len),
        back = walkPoly(X, Y, mid, -1, len)
      ctx.save()
      ctx.globalAlpha = alpha
      strokeSticks(ctx, back.reverse().concat(fwd.slice(1)), dpr)
      ctx.restore()
    } else {
      const t = performance.now() / 1000
      ctx.save()
      ctx.globalAlpha = alpha * (0.6 + 0.4 * Math.sin(t * 4))
      ctx.shadowColor = '#00A9FF'
      ctx.shadowBlur = 30 * dpr
      ctx.fillStyle = '#00A9FF'
      ctx.beginPath()
      ctx.arc(X[mid], Y[mid], 9 * dpr, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(X[mid], Y[mid], 4 * dpr, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
  }
  function updateLensLabels() {
    const I = S.I,
      W = lensW()
    el.lensFov.textContent = fmtLen(W)
    if (S.eps === 0) {
      el.lensZoom.textContent = '×∞'
      return
    }
    if (!S.mapReady) return
    const mpp = mppAt(I.lat0)
    const mag = Math.max(1, (mpp * el.lensWrap.clientWidth) / W)
    el.lensZoom.textContent =
      mag < 1e6 ? `×${Math.round(mag).toLocaleString('en-US')}` : `×10${sup(Math.floor(Math.log10(mag)))}`
  }
  function updateCallout() {
    if (!S.mapReady || !S.I) return
    const I = S.I,
      pt = S.map.latLngToContainerPoint(ll(I.coords[I.anchor]))
    const sr = el.stage.getBoundingClientRect(),
      lr = el.lensWrap.getBoundingClientRect()
    const lc = { x: lr.left - sr.left + lr.width / 2, y: lr.top - sr.top + lr.height / 2 },
      r2 = lr.width / 2 + 7
    const mpp = mppAt(I.lat0)
    const r1 = Math.min(Math.max(lensW() / 2 / mpp, 6), 400)
    const dx = lc.x - pt.x,
      dy = lc.y - pt.y,
      d = Math.hypot(dx, dy)
    let lines = ''
    if (d > r1 + r2) {
      const th = Math.atan2(dy, dx),
        al = Math.acos((r1 - r2) / d)
      for (const s of [1, -1]) {
        const a = th + s * al
        lines += `<line x1="${pt.x + r1 * Math.cos(a)}" y1="${pt.y + r1 * Math.sin(a)}" x2="${lc.x + r2 * Math.cos(a)}" y2="${lc.y + r2 * Math.sin(a)}" stroke="#00A9FF" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="4 4"/>`
      }
    }
    el.callout.innerHTML = `<defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
      ${lines}
      <circle cx="${pt.x}" cy="${pt.y}" r="${r1}" fill="rgba(0,169,255,.1)" stroke="#00A9FF" stroke-width="2.5" filter="url(#glow)"/>
      <circle cx="${pt.x}" cy="${pt.y}" r="${r1}" fill="none" stroke="#E3F2FD" stroke-width="1.2"/>
      <circle cx="${pt.x}" cy="${pt.y}" r="2.5" fill="#fff"/>`
  }

  // ---------------- chart ----------------
  function drawChart() {
    const I = S.I
    if (!I || !S.curve || !el.chart) return
    const cv = el.chart,
      dpr = window.devicePixelRatio || 1,
      w = cv.clientWidth,
      h = cv.clientHeight
    if (w < 10 || h < 10) return
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(document.documentElement)
    const c1 = css.getPropertyValue('--color-chart-1').trim() || '#6AB3F4',
      c2 = css.getPropertyValue('--color-chart-2').trim() || '#00A9FF'
    const pad = { l: 8, r: 8, t: 14, b: 22 }
    const yLo = Math.log10(Math.min(...S.curve.map(d => d[1]))) - 0.06
    const lPl = Math.log10(S.minWalk.length * (PLANCK / I.epsMin) ** (1 - I.D))
    const yHi = lPl + 0.25 * (lPl - yLo) + 0.05
    const X = p => pad.l + ((w - pad.l - pad.r) * p) / P_MAX,
      Y = l => h - pad.b - ((h - pad.t - pad.b) * (l - yLo)) / (yHi - yLo)
    // zones
    ctx.fillStyle = '#00041C'
    ctx.fillRect(X(0), pad.t, X(P_REAL) - X(0), h - pad.t - pad.b)
    ctx.fillStyle = 'rgba(10,73,137,0.35)'
    ctx.fillRect(X(P_REAL), pad.t, X(P_INF) - X(P_REAL), h - pad.t - pad.b)
    ctx.fillStyle = 'rgba(0,169,255,0.12)'
    ctx.fillRect(X(P_INF), pad.t, X(P_MAX) - X(P_INF), h - pad.t - pad.b)
    ctx.font = '500 10px Inter, sans-serif'
    ctx.fillStyle = '#6E7684'
    ctx.textAlign = 'left'
    ctx.fillText(fmtLen(I.epsMax), X(0) + 2, h - 6)
    ctx.textAlign = 'center'
    ctx.fillText(fmtLen(I.epsMin), X(P_REAL), h - 6)
    ctx.fillText('Planck', X(P_INF) - 18, h - 6)
    ctx.textAlign = 'right'
    ctx.fillText('0', X(P_MAX), h - 6)
    // measured
    ctx.lineJoin = 'round'
    ctx.save()
    ctx.shadowColor = c1
    ctx.shadowBlur = 10
    ctx.strokeStyle = c1
    ctx.lineWidth = 2.5
    ctx.beginPath()
    S.curve.forEach(([p, L], i) => {
      if (i) ctx.lineTo(X(p), Y(Math.log10(L)))
      else ctx.moveTo(X(p), Y(Math.log10(L)))
    })
    ctx.stroke()
    ctx.restore()
    // notebook (full-resolution) points
    ctx.fillStyle = 'rgba(227,242,253,0.85)'
    for (const [e, L] of I.richardson || []) {
      if (e < I.epsMin || e > I.epsMax) continue
      ctx.beginPath()
      ctx.arc(X(posAt(e)), Y(Math.log10(L)), 2, 0, TAU)
      ctx.fill()
    }
    // extrapolation
    ctx.save()
    ctx.shadowColor = c2
    ctx.shadowBlur = 10
    ctx.strokeStyle = c2
    ctx.lineWidth = 2.5
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(X(P_REAL), Y(Math.log10(S.minWalk.length)))
    ctx.lineTo(X(P_INF), Y(lPl))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = '#E3F2FD'
    ctx.shadowColor = '#00A9FF'
    ctx.beginPath()
    ctx.moveTo(X(P_INF), Y(lPl))
    ctx.lineTo(X(P_MAX) - 4, pad.t + 4)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#00A9FF'
    ctx.font = '800 17px "Bricolage Grotesque", sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('∞', X(P_MAX) - 10, pad.t + 11)
    ctx.font = '500 10px Inter, sans-serif'
    ctx.fillStyle = '#6AB3F4'
    ctx.textAlign = 'left'
    ctx.fillText(`${kmStr(10 ** lPl / 1000)} km`, X(0) + 2, Y(lPl) + 3)
    ctx.fillText(`${kmStr(S.coarseLen / 1000)} km`, X(0) + 2, Math.min(Y(Math.log10(S.coarseLen)) - 6, h - pad.b - 4))
    ctx.strokeStyle = 'rgba(106,179,244,0.25)'
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(X(0) + 90, Y(lPl))
    ctx.lineTo(X(P_INF), Y(lPl))
    ctx.stroke()
    ctx.setLineDash([])
    // current
    const cx = X(S.p),
      cy = S.eps === 0 ? pad.t + 4 : Y(Math.log10(S.L))
    ctx.save()
    ctx.shadowColor = '#00A9FF'
    ctx.shadowBlur = 16
    ctx.fillStyle = 'rgba(0,169,255,0.3)'
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#00A9FF'
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, TAU)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(cx, cy, 2.2, 0, TAU)
    ctx.fill()
  }

  // ---------------- picker & ticks ----------------
  function buildPicker() {
    el.picker.innerHTML = ''
    for (const I of S.islands) {
      const step = Math.max(1, Math.ceil(I.n / 260))
      let minX = Number.POSITIVE_INFINITY,
        maxX = Number.NEGATIVE_INFINITY,
        minY = Number.POSITIVE_INFINITY,
        maxY = Number.NEGATIVE_INFINITY
      for (let i = 0; i < I.n; i++) {
        minX = Math.min(minX, I.xs[i])
        maxX = Math.max(maxX, I.xs[i])
        minY = Math.min(minY, I.ys[i])
        maxY = Math.max(maxY, I.ys[i])
      }
      const sc = Math.min(132 / (maxX - minX), 64 / (maxY - minY))
      const ox = (140 - (maxX - minX) * sc) / 2,
        oy = (70 - (maxY - minY) * sc) / 2
      let d = ''
      for (let i = 0; i < I.n; i += step)
        d += `${i ? 'L' : 'M'}${(ox + (I.xs[i] - minX) * sc).toFixed(1)},${(oy + (maxY - I.ys[i]) * sc).toFixed(1)}`
      const b = document.createElement('button')
      b.className = 'island-card'
      b.dataset.name = I.name
      b.type = 'button'
      b.innerHTML = `<svg viewBox="0 0 140 70" aria-hidden="true"><path class="sil" d="${d}Z"/></svg>
        <span class="txt"><span class="nm">${I.name}</span><span class="gk">${I.greek}</span></span>`
      b.title = `${I.name}: ${Math.round(I.area_km2).toLocaleString('en-US')} km², fractal dimension ${I.D.toFixed(2)}`
      b.addEventListener('click', () => selectIsland(I.name, true))
      el.picker.appendChild(b)
    }
  }
  function buildTicks() {
    const I = S.I,
      items = []
    items.push({ p: 0, label: fmtLen(I.epsMax) })
    for (const e of [50e3, 20e3, 10e3, 5e3, 2e3, 1e3, 500, 200, 100])
      if (e < I.epsMax * 0.8 && e > I.epsMin * 1.6) items.push({ p: posAt(e), label: fmtLen(e) })
    items.push({ p: P_REAL, label: `${fmtLen(I.epsMin)} · map limit`, cls: 'real-edge', pri: 1 })
    for (const [e, lab] of [
      [1, '1 m'],
      [1e-3, '1 mm'],
      [1e-6, '1 µm'],
      [1e-9, '1 nm'],
      [1e-10, 'atom'],
      [1e-15, 'proton'],
      [1e-25, '10⁻²⁵ m'],
      [PLANCK, 'Planck'],
    ])
      items.push({ p: posAt(e), label: lab, cls: 'zone' })
    items.push({ p: P_MAX, label: '0', cls: 'inf', pri: 1 })
    const width = el.ticks.clientWidth || 800,
      minGap = (90 / width) * P_MAX
    const kept = []
    for (const it of items.sort((a, b) => (b.pri || 0) - (a.pri || 0)))
      if (kept.every(k => Math.abs(k.p - it.p) > minGap * (k.pri && it.pri ? 0.3 : 1))) kept.push(it)
    el.ticks.innerHTML = kept
      .map(
        t =>
          `<div class="tick ${t.cls || ''}" style="left: calc(17px + (100% - 34px) * ${t.p / P_MAX})">${t.label}</div>`
      )
      .join('')
    el.slider.style.setProperty('--real', `${(P_REAL / P_MAX) * 100}%`)
  }

  function selectIsland(name, fly) {
    const I = S.islands.find(d => d.name === name) || S.islands[0]
    S.I = I
    for (const b of el.picker.children) b.classList.toggle('active', b.dataset.name === I.name)
    el.islandName.textContent = I.name
    el.islandGreek.textContent = I.greek
    computeTangent()
    computeCurve()
    buildTicks()
    S.wasInf = false
    S.dispLog = null
    applyP(S.p)
    refreshMapIsland(fly)
  }

  // ---------------- autoplay ----------------
  function stopDive() {
    if (!S.auto) return
    S.auto = null
    el.diveBtn.textContent = 'Dive to infinity'
    el.diveBtn.classList.remove('running')
  }
  function toggleDive() {
    if (S.auto) {
      stopDive()
      return
    }
    const from = S.p >= P_INF ? 0 : S.p
    S.auto = { t0: performance.now(), from, dur: 4000 + 16000 * (1 - from / P_MAX) }
    el.diveBtn.textContent = 'Stop'
    el.diveBtn.classList.add('running')
  }

  // ---------------- main loop ----------------
  function resizeLens() {
    const dpr = window.devicePixelRatio || 1,
      s = el.lensWrap.clientWidth
    el.lens.width = Math.round(s * dpr)
    el.lens.height = Math.round(s * dpr)
    S.lensDirty = true
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - S.lastT) / 1000 || 0)
    S.lastT = now
    if (S.I) {
      if (S.auto) {
        const k = Math.min(1, (now - S.auto.t0) / S.auto.dur),
          e = -(Math.cos(Math.PI * k) - 1) / 2
        const p = S.auto.from + (P_MAX - S.auto.from) * e
        el.slider.value = p
        S.pendingP = p
        if (k >= 1) stopDive()
      }
      if (S.pendingP !== null) {
        const p = S.pendingP
        S.pendingP = null
        applyP(p)
      }
      if (S.eps === 0) {
        S.zInf += dt * 0.9
        S.lensDirty = true
        S.calloutDirty = true
      }
      if (S.targetLog !== null) {
        if (S.dispLog === null) S.dispLog = S.targetLog
        S.dispLog += (S.targetLog - S.dispLog) * Math.min(1, dt * 9)
      }
      renderBig()
      if (S.lensDirty) {
        drawLens()
        updateLensLabels()
        S.lensDirty = false
      }
      if (S.calloutDirty) {
        updateCallout()
        updateLensLabels()
        S.calloutDirty = false
      }
    }
    requestAnimationFrame(loop)
  }

  // ---------------- data ----------------
  function showError(msg) {
    el.errorMsg.textContent = msg
    el.errorState.classList.remove('hidden')
    el.mapLoading.classList.add('hidden')
  }
  async function load() {
    try {
      el.mapLoading.classList.remove('hidden')
      el.loadingSub.textContent = 'Loading coastlines'
      const { appData } = await notebook.appData()
      const list = appData && Array.isArray(appData.islands) ? appData.islands : null
      if (!list || !list.length)
        throw new Error('The notebook result has no island coastlines. Run the notebook to compute them.')
      S.islands = list.map(prep).filter(Boolean)
      if (!S.islands.length) throw new Error('The island data is empty or malformed.')
      el.errorState.classList.add('hidden')
      buildPicker()
      resizeLens()
      selectIsland(S.islands.some(d => d.name === DEFAULT_ISLAND) ? DEFAULT_ISLAND : S.islands[0].name, false)
      if (!S.map) initMap()
      else {
        el.mapLoading.classList.add('hidden')
        refreshMapIsland(true)
      }
    } catch (e) {
      showError(e?.message || String(e))
    }
  }

  el.runBtn.addEventListener('click', async () => {
    if (el.runBtn.disabled) return
    el.runBtn.disabled = true
    el.runStatus.textContent = 'Running notebook… this takes about 30 seconds.'
    try {
      const { run } = await notebook.run(
        {},
        {
          onProgress: () => {
            el.runStatus.textContent = 'Running notebook…'
          },
        }
      )
      if (run && run.status === 'success') {
        el.runStatus.textContent = ''
        await load()
      } else
        el.runStatus.textContent =
          run?.error || `Run ended with status “${run ? run.status : 'unknown'}”. Check the run history for details.`
    } catch (e) {
      el.runStatus.textContent = e?.message || 'The run could not be started.'
    } finally {
      el.runBtn.disabled = false
    }
  })
  el.slider.addEventListener('input', () => {
    stopDive()
    S.pendingP = Number(el.slider.value)
  })
  el.diveBtn.addEventListener('click', toggleDive)
  el.resetBtn.addEventListener('click', () => {
    stopDive()
    el.slider.value = 0
    S.pendingP = 0
    if (S.I) {
      const I = S.I
      I.anchor = prep({ ...I, coords: I.coords }).anchor
      computeTangent()
      computeCurve()
      refreshMapIsland(true)
    }
  })
  window.addEventListener('resize', () => {
    resizeLens()
    if (S.I) {
      buildTicks()
      drawChart()
    }
    S.calloutDirty = true
  })
  new ResizeObserver(() => {
    resizeLens()
    S.calloutDirty = true
  }).observe(el.lensWrap)

  requestAnimationFrame(loop)
  void load()
})()
