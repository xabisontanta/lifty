import { useEffect, useRef, useState } from 'react'
import type { Map as GlMap, Marker } from 'mapbox-gl'
import type { LatLng, Place } from '@/domain/types'
import { env, hasMapbox } from '@/lib/env'
import { mapboxPosition, validCoordinate } from '@/lib/mapLocation'
import { reversePlace } from '@/services/mapbox'
import { getCurrentPosition } from '@/services/location'
import { Icon } from '@/components/ui/Icon'
import { LiftyButton, Screen, ScreenFooter, ScreenHeader, TextField } from '@/components/ui/kit'

/** A chosen map centre is a manual pickup/address choice, never the device's position. */
export function MapPicker({ title, start, onPick, onClose }: { title: string; start: LatLng; onPick: (p: Place) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<GlMap | null>(null)
  const meMarker = useRef<Marker | null>(null)
  const alive = useRef(true)
  const [center, setCenter] = useState<LatLng>(start)
  const [addr, setAddr] = useState<{ label: string; area: string } | null>(null)
  const [chosen, setChosen] = useState(false)
  const [loading, setLoading] = useState(hasMapbox)
  const [failed, setFailed] = useState(!hasMapbox)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(!hasMapbox)
  const [lat, setLat] = useState(''), [lng, setLng] = useState(''), [manualLabel, setManualLabel] = useState('')
  const manualPoint = { lat: Number(lat), lng: Number(lng) }
  const manualReady = !!lat.trim() && !!lng.trim() && validCoordinate(manualPoint) && manualLabel.trim().length >= 3

  useEffect(() => {
    alive.current = true
    if (!hasMapbox) return () => { alive.current = false }
    let m: GlMap | null = null
    let cancelled = false
    let loaded = false
    const fail = () => { if (!cancelled) { clearTimeout(deadline); setFailed(true); setLoading(false); setManual(true); setChosen(false) } }
    const deadline = setTimeout(fail, 8_000)
    Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]).then(([mod]) => {
      if (cancelled || !ref.current) return
      const gl = mod.default
      gl.accessToken = env.mapboxToken!
      m = new gl.Map({ container: ref.current, style: 'mapbox://styles/mapbox/streets-v12', center: mapboxPosition(start), zoom: 16, dragRotate: false, attributionControl: false })
      m.addControl(new gl.AttributionControl({ compact: true }), 'bottom-left')
      m.touchZoomRotate.disableRotation()
      m.on('load', () => { if (!cancelled) { loaded = true; clearTimeout(deadline); setLoading(false) } })
      m.on('dragend', () => setChosen(true))
      m.on('click', e => { setChosen(true); m?.flyTo({ center: [e.lngLat.lng, e.lngLat.lat] }) })
      m.on('moveend', () => { if (!cancelled && m) { const c = m.getCenter(); setCenter({ lat: c.lat, lng: c.lng }) } })
      m.on('error', e => { if (!loaded || [401, 403].includes((e.error as { status?: number })?.status ?? 0)) fail() })
      map.current = m
    }).catch(fail)
    return () => { alive.current = false; cancelled = true; clearTimeout(deadline); meMarker.current?.remove(); meMarker.current = null; map.current = null; m?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let current = true
    setAddr(null)
    if (!chosen || failed) return
    const t = setTimeout(() => void reversePlace(center).then(a => current && setAddr(a)), 350)
    return () => { current = false; clearTimeout(t) }
  }, [center.lat, center.lng, chosen, failed])

  const goToMe = async () => {
    setLocating(true); setError(null)
    try {
      const f = await getCurrentPosition()
      if (!alive.current) return
      setCenter({ lat: f.lat, lng: f.lng })
      if (map.current && !failed && !manual) {
        const gl = (await import('mapbox-gl')).default
        if (!alive.current || !map.current) return
        meMarker.current?.remove()
        const node = document.createElement('div'); node.className = 'gl-passenger'
        node.innerHTML = '<span class="gl-blue"></span><span class="gl-label below">Current location</span>'
        meMarker.current = new gl.Marker({ element: node, anchor: 'center' }).setLngLat(mapboxPosition(f)).addTo(map.current)
        setChosen(true)
        map.current.flyTo({ center: mapboxPosition(f), zoom: 17 })
      } else {
        setManual(true); setLat(f.lat.toFixed(6)); setLng(f.lng.toFixed(6)); setManualLabel('Current location')
      }
      if (f.accuracyM != null && f.accuracyM > 50) setError(`Location accuracy is about ${Math.round(f.accuracyM)} m. Check the selected spot before saving.`)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Location unavailable. Enter coordinates manually.') }
    finally { if (alive.current) setLocating(false) }
  }
  const manualPlace: Place = { label: manualLabel.trim(), area: `${manualPoint.lat.toFixed(5)}, ${manualPoint.lng.toFixed(5)}`, location: manualPoint, source: 'manual' }

  return <div className="overlay" style={{ alignItems: 'stretch', background: 'var(--off-white)' }} role="dialog" aria-modal="true" aria-label={title}>
    <Screen>
      <ScreenHeader title={title} subtitle="Choose your spot on the map, or enter its coordinates" onBack={onClose} />
      {!manual && <div className="map-fill">
        <div className="map map-gl" style={{ height: '100%', position: 'absolute', inset: 0 }}>
          <div ref={ref} className="map-gl-canvas" />
          {loading && <div className="map-loading" aria-hidden />}
        </div>
        <svg className="picker-pin" width="34" height="42" viewBox="-17 -40 34 42" aria-label="Selected spot; drag or tap the map to choose">
          <path d="M0 0C-3 -8 -15 -16 -15 -28A15 15 0 0 1 15 -28C15 -16 3 -8 0 0Z" fill="#00b386" stroke="#fff" strokeWidth="2.5" />
          <circle cx="0" cy="-28" r="5.6" fill="#fff" />
        </svg>
        <button type="button" className={`locate-btn ${locating ? 'busy' : ''}`} aria-label="Go to my location" onClick={() => void goToMe()}><Icon name={locating ? 'refresh' : 'target'} size={22} /></button>
        <div className="picker-bar" aria-live="polite"><strong>{chosen ? addr?.label ?? 'Finding address…' : 'Drag or tap the map to choose a spot'}</strong><div className="small muted">{addr?.area ?? 'Green pin = selected spot'}</div></div>
      </div>}
      {manual && <div className="stack-3" style={{ padding: 20, overflowY: 'auto' }}>
        <p className="small muted">{failed ? 'The street map is unavailable. ' : ''}Enter coordinates from a map you trust, or use your device location. The app will not guess an address.</p>
        <TextField label="Location label" value={manualLabel} onChange={setManualLabel} placeholder="e.g. My home or Main Road pickup" />
        <TextField label="Latitude" value={lat} onChange={setLat} inputMode="decimal" placeholder="e.g. -29.5024" />
        <TextField label="Longitude" value={lng} onChange={setLng} inputMode="decimal" placeholder="e.g. 31.2331" />
        {!!lat && !!lng && !validCoordinate(manualPoint) && <p role="alert" className="field-error">Enter latitude from −90 to 90 and longitude from −180 to 180.</p>}
        <button type="button" className="btn btn-secondary" onClick={() => void goToMe()} disabled={locating}>{locating ? 'Finding you…' : 'Use my current location'}</button>
      </div>}
      <ScreenFooter>
        {error && <p className="field-error" role="alert">{error}</p>}
        {!manual && <button type="button" className="btn-text" onClick={() => setManual(true)}>Enter coordinates manually</button>}
        <LiftyButton icon="check" disabled={manual ? !manualReady : !chosen || !addr || loading || failed} onClick={() => manual ? manualReady && onPick(manualPlace) : addr && chosen && onPick({ label: addr.label, area: addr.area, location: center, source: 'map_pin' })}>Use this spot</LiftyButton>
      </ScreenFooter>
    </Screen>
  </div>
}
