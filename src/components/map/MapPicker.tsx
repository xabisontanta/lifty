import { useEffect, useRef, useState } from 'react'
import type { Map as GlMap } from 'mapbox-gl'
import type { LatLng, Place } from '@/domain/types'
import { env, hasMapbox } from '@/lib/env'
import { reversePlace } from '@/services/mapbox'
import { getCurrentPosition } from '@/services/location'
import { Icon } from '@/components/ui/Icon'
import { LiftyButton, Screen, ScreenFooter, ScreenHeader } from '@/components/ui/kit'

/**
 * "Choose on map": the user drags the map under a fixed pin. Used when address
 * search can't find a place (common for SA estates, complexes and new roads).
 */
export function MapPicker({ title, start, onPick, onClose }: { title: string; start: LatLng; onPick: (p: Place) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<GlMap | null>(null)
  const [center, setCenter] = useState<LatLng>(start)
  const [addr, setAddr] = useState<{ label: string; area: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(!hasMapbox)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (!hasMapbox) return
    let m: GlMap | null = null
    let cancelled = false
    Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
      .then(([mod]) => {
        if (cancelled || !ref.current) return
        const gl = mod.default
        gl.accessToken = env.mapboxToken!
        m = new gl.Map({ container: ref.current, style: 'mapbox://styles/mapbox/streets-v12', center: [start.lng, start.lat], zoom: 16, dragRotate: false, attributionControl: false })
        m.addControl(new gl.AttributionControl({ compact: true }), 'bottom-left')
        m.touchZoomRotate.disableRotation()
        m.on('load', () => setLoading(false))
        m.on('moveend', () => {
          const c = m!.getCenter()
          setCenter({ lat: c.lat, lng: c.lng })
        })
        map.current = m
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      m?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    setAddr(null)
    const t = setTimeout(() => void reversePlace(center).then((a) => alive && setAddr(a)), 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [center.lat, center.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const goToMe = async () => {
    setLocating(true)
    try {
      const f = await getCurrentPosition()
      map.current?.flyTo({ center: [f.lng, f.lat], zoom: 17 })
      if (!map.current) setCenter({ lat: f.lat, lng: f.lng })
    } catch {
      /* the locate button shows nothing extra here; the user can still drag */
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="overlay" style={{ alignItems: 'stretch', background: 'var(--off-white)' }} role="dialog" aria-modal="true" aria-label={title}>
      <Screen>
        <ScreenHeader title={title} subtitle="Move the map so the pin sits on the spot" onBack={onClose} />
        <div className="map-fill">
          <div className="map map-gl" style={{ height: '100%', position: 'absolute', inset: 0 }}>
            <div ref={ref} className="map-gl-canvas" />
            {loading && !failed && <div className="map-loading" aria-hidden />}
            {failed && <div className="empty"><p>The map isn’t available offline or in low-data mode. Use your current location instead.</p></div>}
          </div>
          <svg className="picker-pin" width="40" height="50" viewBox="-17 -40 34 42" aria-hidden>
            <path d="M0 0C-3 -8 -15 -16 -15 -28A15 15 0 0 1 15 -28C15 -16 3 -8 0 0Z" fill="#00b386" stroke="#fff" strokeWidth="2.5" />
            <circle cx="0" cy="-28" r="5.6" fill="#fff" />
          </svg>
          <button type="button" className={`locate-btn ${locating ? 'busy' : ''}`} aria-label="Go to my location" onClick={() => void goToMe()}>
            <Icon name={locating ? 'refresh' : 'target'} size={22} />
          </button>
          <div className="picker-bar" aria-live="polite">
            <strong>{addr?.label ?? 'Finding address…'}</strong>
            <div className="small muted">{addr?.area ?? ' '}</div>
          </div>
        </div>
        <ScreenFooter>
          <LiftyButton icon="check" disabled={!addr} onClick={() => addr && onPick({ label: addr.label, area: addr.area, location: center })}>Use this spot</LiftyButton>
        </ScreenFooter>
      </Screen>
    </div>
  )
}
