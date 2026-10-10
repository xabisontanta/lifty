import { Capacitor } from '@capacitor/core'
import { freshLocation } from '@/lib/mapLocation'
import type { DeviceFix, FixListener, ErrorListener } from './location'

type Position = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; heading?: number | null; speed?: number | null } }
const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }

function deviceFix(position: Position): DeviceFix {
  const c = position.coords
  return { lat: c.latitude, lng: c.longitude, accuracyM: Number.isFinite(c.accuracy) && c.accuracy >= 0 ? c.accuracy : null,
    heading: c.heading ?? null, speedKmh: c.speed != null ? c.speed * 3.6 : null, at: position.timestamp }
}

export function foregroundLocationError(error?: { code?: string | number; message?: string }): string {
  if (error?.code === 1 || error?.code === 'OS-PLUG-GLOC-0003') return 'Location permission is off. Allow location in your phone or browser settings, or set your location manually.'
  if (error?.code === 3 || error?.code === 'OS-PLUG-GLOC-0010') return 'Couldn’t get a current GPS fix. Try outside, or set your location manually.'
  return 'Your current location is unavailable. Try again, or set your location manually.'
}

function webAvailable(): void {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new Error('Location needs HTTPS or localhost. Open Lifty securely, or set your location manually.')
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('This device can’t find your location. Set your location manually.')
}

/** Foreground map display only: never starts the background commute watcher or publishes GPS. */
export async function watchForegroundLocation(onFix: FixListener, onError: ErrorListener): Promise<() => void> {
  let active = true
  const accept = (position: Position) => {
    const fix = deviceFix(position)
    if (!active) return
    if (!freshLocation(fix)) { onError('Waiting for a fresh GPS fix. You can also set your location manually.'); return }
    onFix(fix)
  }
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const id = await Geolocation.watchPosition({ ...options, minimumUpdateInterval: 3000 }, (p, e) => {
      if (!active) return
      if (e) onError(foregroundLocationError(e))
      else if (p) accept(p)
    })
    return () => { active = false; void Geolocation.clearWatch({ id }).catch(() => {}) }
  }
  webAvailable()
  const id = navigator.geolocation.watchPosition(accept, (e) => active && onError(foregroundLocationError(e)), options)
  return () => { active = false; navigator.geolocation.clearWatch(id) }
}

export async function getForegroundPosition(timeoutMs = 15_000): Promise<DeviceFix> {
  let p: Position
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    try { p = await Geolocation.getCurrentPosition({ ...options, timeout: timeoutMs }) }
    catch (e) { throw Object.assign(new Error(foregroundLocationError(e as { code?: string | number })), { cause: e }) }
  } else {
    webAvailable()
    p = await new Promise<Position>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve,
      (e) => reject(new Error(foregroundLocationError(e))), { ...options, timeout: timeoutMs }))
  }
  const fix = deviceFix(p)
  if (!freshLocation(fix)) throw new Error('The location fix is out of date. Try again, or set your location manually.')
  return fix
}

export async function foregroundLocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation')
      const p = await Geolocation.checkPermissions()
      return p.location === 'granted' || p.coarseLocation === 'granted' ? 'granted' : p.location === 'denied' ? 'denied' : 'prompt'
    }
    return (await navigator.permissions?.query({ name: 'geolocation' }))?.state ?? 'unknown'
  } catch { return 'unknown' }
}
