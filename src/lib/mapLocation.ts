import type { LatLng } from '@/domain/types'

/** Keep latitude/longitude in domain order; Mapbox alone receives [longitude, latitude]. */
export const mapboxPosition = (p: LatLng): [number, number] => [p.lng, p.lat]

export function validCoordinate(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
}

export const LOCATION_MAX_AGE_MS = 30_000

/** A fresh watch must not resurrect a cached position from a previous session. */
export function freshLocation(p: (LatLng & { at: number }) | null | undefined, now = Date.now()): boolean {
  return validCoordinate(p) && Number.isFinite(p.at) && p.at <= now + 10_000 && now - p.at <= LOCATION_MAX_AGE_MS
}

/** Metre-sized geodesic accuracy ring, rather than a decorative fixed-pixel pulse. */
export function accuracyRing(at: LatLng, accuracyM: number | null | undefined): LatLng[] {
  if (!validCoordinate(at) || accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 50) return []
  const radius = accuracyM / 6_371_000
  const lat = at.lat * Math.PI / 180
  const lng = at.lng * Math.PI / 180
  const points = Array.from({ length: 64 }, (_, i) => {
    const bearing = 2 * Math.PI * i / 64
    const latitude = Math.asin(Math.sin(lat) * Math.cos(radius) + Math.cos(lat) * Math.sin(radius) * Math.cos(bearing))
    const longitude = lng + Math.atan2(Math.sin(bearing) * Math.sin(radius) * Math.cos(lat), Math.cos(radius) - Math.sin(lat) * Math.sin(latitude))
    return { lat: latitude * 180 / Math.PI, lng: ((longitude * 180 / Math.PI + 540) % 360) - 180 }
  })
  return [...points, points[0]]
}
