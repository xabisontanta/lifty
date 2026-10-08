import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

/**
 * Device location. On Android/iOS (Capacitor) this uses a background-capable
 * watcher with a persistent notification, so pickups keep working with the
 * screen locked. In a browser it falls back to watchPosition (foreground only).
 * Callers must only start a watch inside an active commute window.
 */

export interface DeviceFix {
  lat: number
  lng: number
  heading: number | null
  speedKmh: number | null
  accuracyM: number | null
  at: number
}

export type FixListener = (fix: DeviceFix) => void
export type ErrorListener = (message: string) => void

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export const isNative = () => Capacitor.isNativePlatform()

export async function watchLocation(onFix: FixListener, onError: ErrorListener, opts: { lowData?: boolean } = {}): Promise<() => void> {
  if (isNative()) {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Lifty is sharing your location',
        backgroundMessage: 'Only during your commute window. It stops automatically at drop-off.',
        requestPermissions: true,
        stale: false,
        distanceFilter: opts.lowData ? 40 : 15,
      },
      (location, error) => {
        if (error) {
          onError(error.code === 'NOT_AUTHORIZED' ? 'Location permission is off. Turn it on so your lift club can see you approaching.' : error.message)
          return
        }
        if (!location) return
        onFix({
          lat: location.latitude,
          lng: location.longitude,
          heading: location.bearing ?? null,
          speedKmh: location.speed != null ? location.speed * 3.6 : null,
          accuracyM: location.accuracy ?? null,
          at: location.time ?? Date.now(),
        })
      },
    )
    return () => void BackgroundGeolocation.removeWatcher({ id })
  }

  if (!('geolocation' in navigator)) {
    onError('This device can’t share its location.')
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        heading: p.coords.heading ?? null,
        speedKmh: p.coords.speed != null ? p.coords.speed * 3.6 : null,
        accuracyM: p.coords.accuracy ?? null,
        at: p.timestamp,
      }),
    (e) => onError(e.code === e.PERMISSION_DENIED ? 'Location permission is off. Allow it in your browser settings.' : 'We can’t get your location right now.'),
    { enableHighAccuracy: !opts.lowData, maximumAge: 5000, timeout: 20000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/** One-shot fix for "use my location" (foreground). Rejects with a human-readable message. */
export function getCurrentPosition(timeoutMs = 15000): Promise<DeviceFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device can’t share its location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? null, speedKmh: null, accuracyM: p.coords.accuracy ?? null, at: p.timestamp }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? isNative()
                ? 'Location is off for Lifty. Turn it on in Settings → Lifty → Location.'
                : 'Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then reload Lifty.'
              : e.code === e.TIMEOUT
                ? 'Couldn’t get a GPS fix. Step outside or try again.'
                : 'We can’t get your location right now.',
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: timeoutMs },
    )
  })
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' — lets us auto-locate without surprising the user. */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return (p?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown'
  } catch {
    return 'unknown' // Safari before 16 has no Permissions API for geolocation
  }
}

export function openLocationSettings() {
  if (isNative()) void BackgroundGeolocation.openSettings()
}
