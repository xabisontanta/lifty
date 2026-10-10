import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLng } from '@/domain/types'
import type { DeviceFix } from '@/services/location'
import { foregroundLocationError, foregroundLocationPermission, watchForegroundLocation } from '@/services/foregroundLocation'
import { freshLocation, LOCATION_MAX_AGE_MS } from '@/lib/mapLocation'

export function useMapLocation({ enabled, autoLocate, onLocate }: { enabled?: boolean; autoLocate?: boolean; onLocate?: (p: LatLng | null) => void }) {
  const [fix, setFix] = useState<DeviceFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState<{ at: LatLng; request: number } | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const generation = useRef(0)
  const cb = useRef(onLocate)
  const current = useRef<DeviceFix | null>(null)
  const centreNextFix = useRef(false)
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requested = useRef(false)
  const hadFix = useRef(false)
  cb.current = onLocate

  const centre = useCallback((p: LatLng) => setCamera(c => ({ at: p, request: (c?.request ?? 0) + 1 })), [])
  const clearExpiry = useCallback(() => { if (expiry.current != null) clearTimeout(expiry.current); expiry.current = null }, [])
  const expire = useCallback(() => {
    clearExpiry(); current.current = null; setFix(null); setBusy(false); cb.current?.(null)
    setError('Your last location is out of date. Find your location again, or set it manually.')
  }, [clearExpiry])
  const start = useCallback(async () => {
    requested.current = true
    const n = ++generation.current
    stop.current?.(); stop.current = null
    clearExpiry(); current.current = null; setFix(null); cb.current?.(null)
    if (document.visibilityState === 'hidden') return
    setBusy(true); setError(null); centreNextFix.current = true
    try {
      const unsubscribe = await watchForegroundLocation(p => {
        if (n !== generation.current) return
        current.current = p; setFix(p); setBusy(false); setError(null); cb.current?.(p)
        hadFix.current = true; clearExpiry()
        expiry.current = setTimeout(() => { if (n === generation.current) expire() }, Math.max(1, p.at + LOCATION_MAX_AGE_MS - Date.now() + 1))
        if (centreNextFix.current) { centreNextFix.current = false; centre(p) }
      }, message => {
        if (n !== generation.current) return
        current.current = null; setFix(null); setBusy(false); setError(message); cb.current?.(null)
        clearExpiry()
      })
      if (n !== generation.current) unsubscribe()
      else stop.current = unsubscribe
    } catch (e) {
      if (n !== generation.current) return
      current.current = null; setFix(null); setBusy(false)
      setError(e instanceof Error ? e.message : foregroundLocationError()); cb.current?.(null)
    }
  }, [centre, clearExpiry, expire])
  const locate = useCallback(() => {
    if (current.current && stop.current && freshLocation(current.current)) { centre(current.current); return }
    void start()
  }, [centre, start])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    if (autoLocate) void foregroundLocationPermission().then(state => {
      if (!alive) return
      if (state === 'denied') setError(foregroundLocationError({ code: 1 }))
      else void start()
    })
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        ++generation.current; stop.current?.(); stop.current = null; clearExpiry()
        current.current = null; setFix(null); setBusy(false); cb.current?.(null)
      } else if (requested.current) {
        const n = generation.current
        void foregroundLocationPermission().then(state => {
          if (!alive || n !== generation.current) return
          if (state === 'granted' || (state === 'unknown' && hadFix.current)) void start()
          else setError(state === 'denied' ? foregroundLocationError({ code: 1 }) : 'Find your location again, or set it manually.')
        })
      }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      alive = false; ++generation.current; stop.current?.(); stop.current = null; current.current = null; clearExpiry()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [enabled, autoLocate, start, clearExpiry])

  return { fix: enabled ? fix : null, busy, error, camera, locate }
}
