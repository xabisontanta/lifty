import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GeoJSONSource, Map as GlMap, Marker } from 'mapbox-gl'
import type { LatLng } from '@/domain/types'
import { boundsOf, seeded } from '@/lib/geo'
import { env, hasMapbox } from '@/lib/env'
import { getCurrentPosition, locationPermission } from '@/services/location'
import { Icon } from '@/components/ui/Icon'

/**
 * MapView renders Lifty's route semantics (driver route, pickup deviation,
 * walking path, pickup/destination pins, live driver & passenger markers).
 *
 * Two interchangeable renderers sit behind one component API:
 *  - Mapbox GL (real streets, light/dark) when a token is configured and WebGL works
 *  - a zero-data vector schematic for low-data mode, offline, or no WebGL
 * Layer components work in both, so screens never care which one is active.
 */

type Pad = { top: number; right: number; bottom: number; left: number }

interface SvgCtx {
  kind: 'svg'
  project: (p: LatLng) => { x: number; y: number }
  w: number
  h: number
  dark: boolean
}
interface GlCtx {
  kind: 'gl'
  map: GlMap
  gl: typeof import('mapbox-gl').default
  dark: boolean
}
const MapCtx = createContext<SvgCtx | GlCtx | null>(null)

/** App-level map preference (low-data mode → schematic, no tile downloads). */
export const MapSettings = createContext<{ lowData: boolean }>({ lowData: false })

interface MapViewProps {
  fit: LatLng[]
  height?: number | string
  dark?: boolean
  padding?: number | Pad
  children?: ReactNode
  overlay?: ReactNode
  className?: string
  label?: string
  dimmed?: boolean
  /** force the schematic renderer (e.g. tiny inset maps) */
  schematic?: boolean
  /** let the user pan/zoom (tracking screens) */
  interactive?: boolean
}

let webglOk: boolean | null = null
function supportsWebGL() {
  if (webglOk != null) return webglOk
  try {
    const c = document.createElement('canvas')
    webglOk = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    webglOk = false
  }
  return webglOk
}

export function MapView(props: MapViewProps & LocateProps) {
  const { lowData } = useContext(MapSettings)
  const [glFailed, setGlFailed] = useState(false)
  const { me, busy, error, locate } = useLocate(props)
  const useGl = hasMapbox && !lowData && !props.schematic && !glFailed && supportsWebGL()
  const merged: MapViewProps = {
    ...props,
    // include "you are here" in the camera fit
    fit: me && !props.locateNoFit ? [...props.fit, me] : props.fit,
    children: (
      <>
        {props.children}
        {me && <PassengerMarker at={me} label={props.meLabel ?? 'You are here'} />}
      </>
    ),
    overlay: (
      <>
        {props.overlay}
        {props.locate && (
          <button type="button" className={`locate-btn ${busy ? 'busy' : ''} ${me ? 'on' : ''}`} aria-label={me ? 'Re-centre on my location' : 'Find my location'} onClick={() => void locate()}>
            <Icon name={busy ? 'refresh' : 'target'} size={22} />
          </button>
        )}
        {error && props.locate && <div className="map-chip" role="alert" style={{ left: 10, right: 60, top: 10, fontWeight: 500 }}>{error}</div>}
      </>
    ),
  }
  return useGl ? <GlMapView {...merged} onFail={() => setGlFailed(true)} /> : <SvgMapView {...merged} />
}

/* ---------- "Find my location" (button + optional auto-locate) ---------- */

interface LocateProps {
  /** show the locate (navigator) button */
  locate?: boolean
  /** locate automatically when the map opens (once per session if permission is undecided) */
  autoLocate?: boolean
  onLocate?: (p: LatLng) => void
  meLabel?: string
  /** don't re-fit the camera to include the user's position */
  locateNoFit?: boolean
}

const AUTO_KEY = 'lifty.autoLocated'
function useLocate({ locate: enabled, autoLocate, onLocate }: LocateProps) {
  const [me, setMe] = useState<LatLng | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cb = useRef(onLocate)
  cb.current = onLocate

  const locate = async () => {
    setBusy(true)
    setError(null)
    try {
      const fix = await getCurrentPosition()
      const p = { lat: fix.lat, lng: fix.lng }
      setMe(p)
      cb.current?.(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Location unavailable')
      setTimeout(() => setError(null), 6000)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!enabled || !autoLocate) return
    let cancelled = false
    void locationPermission().then((state) => {
      if (cancelled || state === 'denied') return
      // granted → always; undecided → ask once per session (iOS shows its own prompt)
      let asked = false
      try {
        asked = sessionStorage.getItem(AUTO_KEY) === '1'
        sessionStorage.setItem(AUTO_KEY, '1')
      } catch {
        /* private mode */
      }
      if (state === 'granted' || !asked) void locate()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoLocate])

  return { me, busy, error, locate }
}

const toPad = (p: number | Pad | undefined, d = 44): Pad => (typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : p ?? { top: d, right: d, bottom: d, left: d })

/* =========================== Mapbox GL renderer =========================== */

const LIGHT_STYLE = 'mapbox://styles/mapbox/streets-v12'
const DARK_STYLE = 'mapbox://styles/mapbox/navigation-night-v1'

function lngLatBounds(points: LatLng[]): [[number, number], [number, number]] {
  const b = boundsOf(points.length ? points : [{ lat: -29.6, lng: 31.15 }])
  const minSpan = 0.0015
  const padLng = Math.max(0, (minSpan - (b.maxLng - b.minLng)) / 2)
  const padLat = Math.max(0, (minSpan - (b.maxLat - b.minLat)) / 2)
  return [
    [b.minLng - padLng, b.minLat - padLat],
    [b.maxLng + padLng, b.maxLat + padLat],
  ]
}

function GlMapView({ fit, height = 260, dark = false, padding, children, overlay, className = '', label = 'Map', dimmed, interactive = true, onFail }: MapViewProps & { onFail: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ctx, setCtx] = useState<GlCtx | null>(null)
  const pad = toPad(padding)
  // ~100 m rounding so live updates don't re-fit the camera on every GPS tick
  const fitKey = fit.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|')
  const fitRef = useRef(fit)
  fitRef.current = fit

  useEffect(() => {
    let map: GlMap | null = null
    let cancelled = false
    Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
      .then(([mod]) => {
        const gl = mod.default
        if (cancelled || !ref.current) return
        gl.accessToken = env.mapboxToken!
        map = new gl.Map({
          container: ref.current,
          style: dark ? DARK_STYLE : LIGHT_STYLE,
          bounds: lngLatBounds(fitRef.current),
          fitBoundsOptions: { padding: pad, maxZoom: 16 },
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          interactive,
          cooperativeGestures: false,
        })
        map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-left')
        map.touchZoomRotate.disableRotation()
        map.on('load', () => {
          if (!cancelled && map) setCtx({ kind: 'gl', map, gl, dark })
        })
        map.on('error', (e) => {
          // auth / style failures → fall back to the schematic
          const status = (e.error as { status?: number } | undefined)?.status
          if (status === 401 || status === 403) onFail()
        })
      })
      .catch(() => onFail())
    return () => {
      cancelled = true
      setCtx(null)
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])

  useEffect(() => {
    if (!ctx) return
    ctx.map.fitBounds(lngLatBounds(fitRef.current), { padding: pad, maxZoom: 16, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, fitKey, pad.top, pad.right, pad.bottom, pad.left])

  useEffect(() => {
    if (!ctx || !ref.current) return
    const ro = new ResizeObserver(() => ctx.map.resize())
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ctx])

  return (
    <div className={`map map-gl ${dark ? 'map-dark' : ''} ${className}`} style={{ height }} role="img" aria-label={label}>
      <div ref={ref} className="map-gl-canvas" />
      {!ctx && <div className="map-loading" aria-hidden />}
      <MapCtx.Provider value={ctx}>{ctx && children}</MapCtx.Provider>
      {dimmed && <div className="map-dim" />}
      {overlay}
    </div>
  )
}

const lineFeature = (path: LatLng[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: path.map((p) => [p.lng, p.lat]) },
})

function useGlLine(path: LatLng[], layers: { color: string; width: number; dash?: number[]; opacity?: number }[]) {
  const ctx = useContext(MapCtx)
  const id = 'l' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const key = path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  useEffect(() => {
    if (ctx?.kind !== 'gl') return
    const map = ctx.map
    map.addSource(id, { type: 'geojson', data: lineFeature(path) })
    layers.forEach((l, i) =>
      map.addLayer({
        id: `${id}-${i}`,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': l.color, 'line-width': l.width, 'line-opacity': l.opacity ?? 1, ...(l.dash ? { 'line-dasharray': l.dash } : {}) },
      }),
    )
    return () => {
      try {
        layers.forEach((_, i) => map.getLayer(`${id}-${i}`) && map.removeLayer(`${id}-${i}`))
        if (map.getSource(id)) map.removeSource(id)
      } catch {
        /* map already removed */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])
  useEffect(() => {
    if (ctx?.kind !== 'gl') return
    ;(ctx.map.getSource(id) as GeoJSONSource | undefined)?.setData(lineFeature(path))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key])
}

/** HTML marker that glides between positions instead of jumping. */
function useGlMarker(at: LatLng | null, render: () => HTMLElement, deps: unknown[], anchor: 'center' | 'bottom' = 'center') {
  const ctx = useContext(MapCtx)
  const marker = useRef<Marker | null>(null)
  const from = useRef<LatLng | null>(null)
  useEffect(() => {
    if (ctx?.kind !== 'gl' || !at) return
    const m = new ctx.gl.Marker({ element: render(), anchor }).setLngLat([at.lng, at.lat]).addTo(ctx.map)
    marker.current = m
    from.current = at
    return () => {
      m.remove()
      marker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, at == null, ...deps])
  useEffect(() => {
    const m = marker.current
    if (!m || !at || !from.current) return
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 800)
      m.setLngLat([start.lng + (at.lng - start.lng) * k, start.lat + (at.lat - start.lat) * k])
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = at
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [at?.lat, at?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return marker
}

function el(html: string, className: string): HTMLElement {
  const d = document.createElement('div')
  d.className = className
  d.innerHTML = html
  return d
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const PIN_SVG = (color: string) =>
  `<svg width="34" height="42" viewBox="-17 -40 34 42" aria-hidden="true"><path d="M0 0C-3 -8 -15 -16 -15 -28A15 15 0 0 1 15 -28C15 -16 3 -8 0 0Z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="0" cy="-28" r="5.6" fill="#fff"/></svg>`
const CAR_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M3 13l2-6a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h18"/></svg>`

/* =========================== Schematic renderer =========================== */

function SvgMapView({ fit, height = 260, dark = false, padding, children, overlay, className = '', label = 'Map', dimmed }: MapViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: typeof height === 'number' ? height : 260 })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setSize({ w: Math.max(60, node.clientWidth), h: Math.max(60, node.clientHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const pad = toPad(padding)
  const fitKey = fit.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')

  const projector = useMemo<SvgCtx>(() => {
    const b = boundsOf(fit.length ? fit : [{ lat: 0, lng: 0 }])
    const lat0 = (b.minLat + b.maxLat) / 2
    const k = Math.cos((lat0 * Math.PI) / 180)
    const minSpan = 0.0016
    const dLng = Math.max(b.maxLng - b.minLng, minSpan) * k
    const dLat = Math.max(b.maxLat - b.minLat, minSpan)
    const availW = Math.max(40, size.w - pad.left - pad.right)
    const availH = Math.max(40, size.h - pad.top - pad.bottom)
    const scale = Math.min(availW / dLng, availH / dLat)
    const cx = (b.minLng + b.maxLng) / 2
    const cy = (b.minLat + b.maxLat) / 2
    const ox = pad.left + availW / 2
    const oy = pad.top + availH / 2
    return { kind: 'svg', w: size.w, h: size.h, dark, project: (p) => ({ x: ox + (p.lng - cx) * k * scale, y: oy - (p.lat - cy) * scale }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h, dark, pad.top, pad.right, pad.bottom, pad.left])

  return (
    <div ref={ref} className={`map ${dark ? 'map-dark' : ''} ${className}`} style={{ height }} role="img" aria-label={label}>
      <MapCtx.Provider value={projector}>
        <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="map-svg">
          <MapDefs />
          <BaseMap seed={fitKey} />
          {children}
        </svg>
        {dimmed && <div className="map-dim" />}
        {overlay}
      </MapCtx.Provider>
    </div>
  )
}

function useSvg(): SvgCtx | null {
  const c = useContext(MapCtx)
  return c?.kind === 'svg' ? c : null
}

function BaseMap({ seed }: { seed: string }) {
  const ctx = useSvg()!
  const { w, h, dark } = ctx
  const shapes = useMemo(() => {
    let hash = 7
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    const rnd = seeded(hash || 1)
    const angle = -28 + rnd() * 12
    const roads: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
    const diag = Math.hypot(w, h)
    const gap = 46 + rnd() * 18
    for (let i = -diag; i < diag; i += gap + rnd() * 14) roads.push({ x1: i, y1: -diag, x2: i, y2: diag, major: rnd() > 0.78 })
    for (let j = -diag; j < diag; j += gap * 1.25 + rnd() * 20) roads.push({ x1: -diag, y1: j, x2: diag, y2: j, major: rnd() > 0.8 })
    const parks = Array.from({ length: 3 }, () => ({ x: rnd() * w, y: rnd() * h, w: 50 + rnd() * 70, h: 34 + rnd() * 50, r: 12 + rnd() * 10 }))
    const water = { x: rnd() * w * 0.7 + w * 0.3, y: h * (0.7 + rnd() * 0.5), rx: 90 + rnd() * 60, ry: 38 + rnd() * 24 }
    return { angle, roads, parks, water }
  }, [seed, w, h])
  const c = dark
    ? { bg: '#13293f', park: '#14392f', water: '#0f2f55', road: '#223f5a', major: '#2c4d6b' }
    : { bg: '#eef2f1', park: '#dcefe0', water: '#cfe3f5', road: '#ffffff', major: '#ffffff' }
  return (
    <g>
      <rect width={w} height={h} fill={c.bg} />
      <g transform={`rotate(${shapes.angle} ${w / 2} ${h / 2})`}>
        {shapes.parks.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={c.park} />
        ))}
        <ellipse cx={shapes.water.x} cy={shapes.water.y} rx={shapes.water.rx} ry={shapes.water.ry} fill={c.water} />
        {shapes.roads.map((r, i) => (
          <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={r.major ? c.major : c.road} strokeWidth={r.major ? 9 : 4.5} />
        ))}
      </g>
    </g>
  )
}

const toPath = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

function SvgLabel({ x, y, text, tone = 'navy', dy = -52 }: { x: number; y: number; text: string; tone?: 'navy' | 'white'; dy?: number }) {
  const w = text.length * 6.6 + 18
  return (
    <g transform={`translate(${x - w / 2} ${y + dy})`}>
      <rect width={w} height={24} rx={12} fill={tone === 'navy' ? 'var(--navy)' : '#fff'} opacity={0.96} filter="url(#shadow)" />
      <text x={w / 2} y={16} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={tone === 'navy' ? '#fff' : 'var(--navy)'} fontFamily="Inter, system-ui">
        {text}
      </text>
    </g>
  )
}

export function MapDefs() {
  return (
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#0f2d4a" floodOpacity="0.25" />
      </filter>
    </defs>
  )
}

/* =========================== Layers (both renderers) =========================== */

/** Driver's normal route. */
export function RouteLine({ path, animate = true }: { path: LatLng[]; animate?: boolean }) {
  useGlLine(path, [
    { color: '#ffffff', width: 9, opacity: 0.95 },
    { color: '#3b82f6', width: 5 },
  ])
  const svg = useSvg()
  if (!svg || path.length < 2) return null
  const d = toPath(path.map(svg.project))
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="#fff" strokeWidth={9} opacity={0.95} />
      <path d={d} stroke="var(--map-blue)" strokeWidth={5} pathLength={1} className={animate ? 'draw' : ''} />
    </g>
  )
}

/** The driver's detour from the normal route to reach the pickup point. */
export function DeviationRoute({ path, animate = true }: { path: LatLng[]; animate?: boolean }) {
  useGlLine(path, [
    { color: '#ffffff', width: 8 },
    { color: '#f59e0b', width: 4.5 },
  ])
  const svg = useSvg()
  if (!svg || path.length < 2) return null
  const d = toPath(path.map(svg.project))
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="#fff" strokeWidth={8} />
      <path d={d} stroke="var(--warning)" strokeWidth={4.5} pathLength={1} className={animate ? 'draw delay' : ''} />
    </g>
  )
}

/** Passenger's pedestrian route — dotted so it is distinct from any road route. */
export function WalkingPath({ path, animate = true }: { path: LatLng[]; animate?: boolean }) {
  useGlLine(path, [
    { color: '#ffffff', width: 7, opacity: 0.9 },
    { color: '#0f2d4a', width: 3.5, dash: [0, 2] },
  ])
  const svg = useSvg()
  if (!svg || path.length < 2) return null
  const d = toPath(path.map(svg.project))
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={svg.dark ? '#0a1f35' : '#fff'} strokeWidth={8} opacity={0.9} />
      <path d={d} stroke="var(--navy)" strokeWidth={3.2} strokeDasharray="0.1 7" className={animate ? 'fade-in' : ''} style={svg.dark ? { stroke: '#fff' } : undefined} />
    </g>
  )
}

export function LocationPin({ at, color, label }: { at: LatLng; color: string; label?: string }) {
  useGlMarker(at, () => el(`${label ? `<span class="gl-label">${escapeHtml(label)}</span>` : ''}${PIN_SVG(color)}`, 'gl-pin'), [color, label], 'bottom')
  const svg = useSvg()
  if (!svg) return null
  const { x, y } = svg.project(at)
  return (
    <g>
      <g transform={`translate(${x} ${y})`} filter="url(#shadow)">
        <ellipse cx={0} cy={1} rx={7} ry={3} fill="rgba(15,45,74,0.25)" />
        <path d="M0 0C-3 -8 -15 -16 -15 -28A15 15 0 0 1 15 -28C15 -16 3 -8 0 0Z" fill={color} stroke="#fff" strokeWidth={2.5} />
        <circle cx={0} cy={-28} r={5.6} fill="#fff" />
      </g>
      {label && <SvgLabel x={x} y={y} text={label} />}
    </g>
  )
}

export function LocationDot({ at, color }: { at: LatLng; color: string }) {
  useGlMarker(at, () => {
    const d = el('', 'gl-dot')
    d.style.background = color
    return d
  }, [color])
  const svg = useSvg()
  if (!svg) return null
  const { x, y } = svg.project(at)
  return <circle cx={x} cy={y} r={6} fill={color} stroke="#fff" strokeWidth={2.5} />
}

export const PickupMarker = ({ at, label = 'Pickup' }: { at: LatLng; label?: string }) => <LocationPin at={at} color="#00b386" label={label} />
export const DestinationMarker = ({ at, label = 'Destination' }: { at: LatLng; label?: string }) => <LocationPin at={at} color="#ef4444" label={label} />

export function PassengerMarker({ at, label, accuracy }: { at: LatLng; label?: string; accuracy?: boolean }) {
  useGlMarker(at, () => el(`<span class="gl-pulse"></span><span class="gl-blue"></span>${label ? `<span class="gl-label below">${escapeHtml(label)}</span>` : ''}`, 'gl-passenger'), [label])
  const svg = useSvg()
  if (!svg) return null
  const { x, y } = svg.project(at)
  return (
    <g className="smooth" style={{ transform: `translate(${x}px, ${y}px)` }}>
      {accuracy !== false && <circle r={20} fill="var(--map-blue)" opacity={0.18} className="pulse-ring" />}
      <circle r={9} fill="#fff" filter="url(#shadow)" />
      <circle r={6.2} fill="var(--map-blue)" />
      {label && <SvgLabel x={0} y={0} text={label} dy={16} />}
    </g>
  )
}

export function DriverMarker({ at, heading = 0, label, stale }: { at: LatLng; heading?: number; label?: string; stale?: boolean }) {
  const marker = useGlMarker(at, () => el(`<span class="gl-heading"></span><span class="gl-car">${CAR_SVG}</span>${label ? `<span class="gl-label">${escapeHtml(label)}</span>` : ''}`, 'gl-driver'), [label])
  useEffect(() => {
    const node = marker.current?.getElement()
    if (!node) return
    node.style.setProperty('--heading', `${heading}deg`)
    node.classList.toggle('stale', !!stale)
  })
  const svg = useSvg()
  if (!svg) return null
  const { x, y } = svg.project(at)
  return (
    <g className="smooth" style={{ transform: `translate(${x}px, ${y}px)`, opacity: stale ? 0.6 : 1 }}>
      <circle r={18} fill="var(--navy)" filter="url(#shadow)" stroke="#fff" strokeWidth={3} />
      <g transform={`rotate(${heading})`}>
        <path d="M0 -26 L6 -19 L-6 -19Z" fill="var(--navy)" stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
      </g>
      <g transform="translate(-10 -10) scale(0.84)" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 17h14M3 13l2-6a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h18" />
      </g>
      {label && <SvgLabel x={0} y={0} text={label} dy={-48} />}
    </g>
  )
}

/** Small chip placed at the middle of the deviation, e.g. "+3 min". */
export function DeviationChip({ path, text }: { path: LatLng[]; text: string }) {
  const mid = path.length ? path[Math.floor(path.length / 2)] : null
  useGlMarker(mid, () => el(`<span class="gl-label light">${escapeHtml(text)}</span>`, 'gl-chip'), [text])
  const svg = useSvg()
  if (!svg || !mid) return null
  const p = svg.project(mid)
  return <SvgLabel x={p.x} y={p.y} text={text} tone="white" dy={14} />
}

export function MapLegend({ items }: { items: { color: string; label: string; dotted?: boolean }[] }) {
  return (
    <ul className="legend" aria-label="Map legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="legend-swatch" style={{ background: i.dotted ? 'transparent' : i.color, borderTop: i.dotted ? `3px dotted ${i.color}` : undefined }} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** Floating glass chips (HTML) over the map. */
export function MapChip({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`map-chip ${className}`} style={style}>
      {children}
    </div>
  )
}
