import type { LatLng } from '@/domain/types'

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function pathLengthM(path: LatLng[]): number {
  let t = 0
  for (let i = 1; i < path.length; i++) t += distanceM(path[i - 1], path[i])
  return t
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Point at distance `m` along a polyline (clamped). */
export function pointAlong(path: LatLng[], m: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 }
  if (m <= 0) return path[0]
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const seg = distanceM(path[i - 1], path[i])
    if (acc + seg >= m) {
      const t = seg === 0 ? 0 : (m - acc) / seg
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
      }
    }
    acc += seg
  }
  return path[path.length - 1]
}

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function boundsOf(points: LatLng[]): Bounds {
  const b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 }
  for (const p of points) {
    b.minLat = Math.min(b.minLat, p.lat)
    b.maxLat = Math.max(b.maxLat, p.lat)
    b.minLng = Math.min(b.minLng, p.lng)
    b.maxLng = Math.max(b.maxLng, p.lng)
  }
  return b
}

/** Cheap deterministic PRNG so the decorative map base never flickers between renders. */
export function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
