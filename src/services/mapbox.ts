import type { LatLng, Place } from '@/domain/types'
import { env, hasMapbox } from '@/lib/env'

/**
 * Thin Mapbox REST wrappers: address search (South Africa), reverse geocoding,
 * driving/walking directions and static map images. Results are cached per
 * session so repeated renders don't cost API calls or mobile data.
 */

const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key) as Promise<T>
}

const KZN_PROXIMITY = '31.15,-29.6' // bias results to the Ballito–Durban corridor

export interface PlaceSuggestion extends Place {
  id: string
}

type Feature = { id?: string; properties: { mapbox_id?: string; name: string; place_formatted?: string; full_address?: string }; geometry: { coordinates: [number, number] } }
const toSuggestion = (f: Feature): PlaceSuggestion => ({
  id: f.id ?? f.properties.mapbox_id ?? `${f.geometry.coordinates.join(',')}`,
  label: f.properties.name,
  area: f.properties.place_formatted ?? f.properties.full_address ?? '',
  location: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] },
})

/**
 * Addresses (Geocoding v6) + places like malls, hospitals and office parks (Search Box),
 * merged and de-duplicated, biased to the user's area.
 */
export async function searchPlaces(query: string, near?: LatLng): Promise<PlaceSuggestion[]> {
  if (!hasMapbox || query.trim().length < 3) return []
  const prox = near ? `${near.lng},${near.lat}` : KZN_PROXIMITY
  const q = encodeURIComponent(query)
  return cached(`s:${query}:${prox}`, async () => {
    const [addr, poi] = await Promise.allSettled([
      fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${q}&country=za&proximity=${prox}&limit=5&language=en&access_token=${env.mapboxToken}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch(`https://api.mapbox.com/search/searchbox/v1/forward?q=${q}&country=za&proximity=${prox}&limit=5&language=en&types=poi,address,street,place,neighborhood&access_token=${env.mapboxToken}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ])
    if (addr.status === 'rejected' && poi.status === 'rejected') throw new Error('Address search is unavailable right now')
    const list = [
      ...(poi.status === 'fulfilled' ? (poi.value.features ?? []) : []),
      ...(addr.status === 'fulfilled' ? (addr.value.features ?? []) : []),
    ].map(toSuggestion)
    const seen = new Set<string>()
    return list.filter((s) => {
      const k = `${s.label.toLowerCase()}|${s.location.lat.toFixed(3)},${s.location.lng.toFixed(3)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 7)
  })
}

/** GPS → a readable address ("12 Ballito Drive", "Ballito, KwaDukuza"). */
export async function reversePlace(p: LatLng): Promise<{ label: string; area: string }> {
  const fallback = { label: 'Pinned location', area: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` }
  if (!hasMapbox) return fallback
  try {
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${p.lng}&latitude=${p.lat}&types=address,street,neighborhood,locality,place&limit=1&language=en&access_token=${env.mapboxToken}`)
    if (!res.ok) return fallback
    const f = (await res.json()).features?.[0]
    if (!f) return fallback
    return { label: f.properties.name ?? fallback.label, area: f.properties.place_formatted ?? f.properties.full_address ?? '' }
  } catch {
    return fallback
  }
}

export async function reverseGeocode(p: LatLng): Promise<string | null> {
  if (!hasMapbox) return null
  const key = `r:${p.lng.toFixed(4)},${p.lat.toFixed(4)}`
  return cached(key, async () => {
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${p.lng}&latitude=${p.lat}&types=street,address&limit=1&access_token=${env.mapboxToken}`)
    if (!res.ok) return null
    const j = await res.json()
    return (j.features?.[0]?.properties?.name as string | undefined) ?? null
  })
}

export interface DirectionsResult {
  coordinates: [number, number][]
  distanceM: number
  durationS: number
}

export async function directions(points: LatLng[], profile: 'driving' | 'driving-traffic' | 'walking' = 'driving'): Promise<DirectionsResult> {
  if (!hasMapbox) throw new Error('Maps are not configured')
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  return cached(`d:${profile}:${coords}`, async () => {
    const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?geometries=geojson&overview=full&access_token=${env.mapboxToken}`)
    if (!res.ok) throw new Error('Route lookup failed')
    const j = await res.json()
    const r = j.routes?.[0]
    if (!r) throw new Error('No route found between those places')
    return { coordinates: r.geometry.coordinates, distanceM: Math.round(r.distance), durationS: Math.round(r.duration) }
  })
}

/** Uncached ETA lookup for live tracking (traffic-aware, minutes). */
export async function liveEtaMinutes(from: LatLng, to: LatLng, profile: 'driving-traffic' | 'walking'): Promise<{ minutes: number; distanceM: number }> {
  if (!hasMapbox) throw new Error('Maps are not configured')
  const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&access_token=${env.mapboxToken}`)
  if (!res.ok) throw new Error('ETA unavailable')
  const r = (await res.json()).routes?.[0]
  if (!r) throw new Error('ETA unavailable')
  return { minutes: Math.max(0, Math.round(r.duration / 60)), distanceM: Math.round(r.distance) }
}

/** Low-data fallback: a single static map image instead of interactive vector tiles. */
export function staticMapUrl(opts: { width: number; height: number; path?: LatLng[]; markers?: { at: LatLng; color: string }[]; dark?: boolean }): string | null {
  if (!hasMapbox) return null
  const overlays: string[] = []
  if (opts.path && opts.path.length > 1) {
    const step = Math.max(1, Math.floor(opts.path.length / 60))
    const pts = opts.path.filter((_, i) => i % step === 0 || i === opts.path!.length - 1)
    overlays.push(`path-5+3b82f6-0.9(${encodeURIComponent(encodePolyline(pts))})`)
  }
  for (const m of opts.markers ?? []) overlays.push(`pin-s+${m.color.replace('#', '')}(${m.at.lng.toFixed(5)},${m.at.lat.toFixed(5)})`)
  const style = opts.dark ? 'dark-v11' : 'streets-v12'
  const w = Math.min(1280, Math.round(opts.width))
  const h = Math.min(1280, Math.round(opts.height))
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${overlays.join(',') || ''}/auto/${w}x${h}@2x?padding=40&access_token=${env.mapboxToken}`
}

// Google polyline encoding (precision 5) — used by the Static Images API.
function encodePolyline(points: LatLng[]): string {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1
    let r = ''
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63)
      s >>= 5
    }
    return r + String.fromCharCode(s + 63)
  }
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5)
    const lng = Math.round(p.lng * 1e5)
    out += enc(lat - lastLat) + enc(lng - lastLng)
    lastLat = lat
    lastLng = lng
  }
  return out
}

export const toLatLngs = (coords: [number, number][]): LatLng[] => coords.map(([lng, lat]) => ({ lat, lng }))
