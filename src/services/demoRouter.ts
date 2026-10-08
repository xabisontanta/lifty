import type { LatLng } from '@/domain/types'
import { sliceAlong, snapToPolyline } from '@/lib/corridor'
import { distanceM } from '@/lib/geo'
import type { DirectionsResult } from './mapbox'
import type { Router } from './routing'

/**
 * Offline stand-in for the routing provider, used only in demo mode and tests.
 * Like a real router it keeps to the road network: when both ends of a leg are close to a known
 * road, the leg follows that road (so detours and overlap behave realistically); otherwise it uses
 * a straight line × street factor. It is deterministic but NOT road data — live mode uses Mapbox
 * Directions.
 */
const STREET_FACTOR = 1.25
const DRIVE_MS = 45 / 3.6 // 45 km/h average commute speed
const WALK_FACTOR = 1.3
const WALK_MS = 1.17 // 4.2 km/h
const ROAD_SNAP_M = 4000 // ends are joined to the nearest road by a stub; beyond this there is no road

const toCoords = (pts: LatLng[]): [number, number][] => pts.map((p) => [p.lng, p.lat])
const pathLen = (pts: LatLng[]) => pts.reduce((s, p, i) => (i ? s + distanceM(pts[i - 1], p) : 0), 0)

export function simulatedRouter(opts: { failDrive?: boolean; failWalk?: boolean; roads?: LatLng[][] } = {}): Router {
  const roads = opts.roads ?? []

  /** One leg: along a shared road if both ends are near it, else straight × factor. */
  const leg = (a: LatLng, b: LatLng): { path: LatLng[]; metres: number } => {
    let best: { path: LatLng[]; metres: number } | null = null
    for (const road of roads) {
      const sa = snapToPolyline(a, road)
      const sb = snapToPolyline(b, road)
      if (sa.distanceM > ROAD_SNAP_M || sb.distanceM > ROAD_SNAP_M) continue
      const along = sliceAlong(road, sa.alongM, sb.alongM)
      const path = [a, ...along, b]
      // the road section is driven as-is; the stubs to/from the road at street factor
      const metres = Math.abs(sb.alongM - sa.alongM) + (sa.distanceM + sb.distanceM) * STREET_FACTOR
      if (!best || metres < best.metres) best = { path, metres }
    }
    if (best) return best
    return { path: [a, b], metres: distanceM(a, b) * STREET_FACTOR }
  }

  return {
    async drive(pts) {
      if (opts.failDrive) throw new Error('Routing provider unavailable')
      let metres = 0
      const path: LatLng[] = []
      for (let i = 1; i < pts.length; i++) {
        const l = leg(pts[i - 1], pts[i])
        metres += l.metres
        path.push(...(path.length ? l.path.slice(1) : l.path))
      }
      return { coordinates: toCoords(path.length ? path : pts), distanceM: Math.round(metres), durationS: Math.round(metres / DRIVE_MS) } satisfies DirectionsResult
    },
    async walk(pts) {
      if (opts.failWalk) throw new Error('No pedestrian route')
      const metres = pathLen(pts) * WALK_FACTOR
      return { coordinates: toCoords(pts), distanceM: Math.round(metres), durationS: Math.round(metres / WALK_MS) }
    },
  }
}
