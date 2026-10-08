import type { LatLng } from '@/domain/types'

/** Distance (m) from a point to a polyline, using a local flat projection (accurate at commute scale). */
export function distanceToPolylineM(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity
  const k = Math.cos((p.lat * Math.PI) / 180)
  const m = 111320
  const px = p.lng * k * m
  const py = p.lat * m
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i].lng * k * m, ay = line[i].lat * m
    const bx = line[i + 1].lng * k * m, by = line[i + 1].lat * m
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return line.length === 1 ? Math.hypot(px - line[0].lng * k * m, py - line[0].lat * m) : best
}

/** Resample a polyline into points roughly `stepM` apart. */
export function samplePolyline(line: LatLng[], stepM = 100): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1]
    const k = Math.cos((a.lat * Math.PI) / 180)
    const len = Math.hypot((b.lng - a.lng) * k * 111320, (b.lat - a.lat) * 111320)
    const n = Math.max(1, Math.ceil(len / stepM))
    for (let s = 0; s < n; s++) out.push({ lat: a.lat + ((b.lat - a.lat) * s) / n, lng: a.lng + ((b.lng - a.lng) * s) / n })
  }
  if (line.length) out.push(line[line.length - 1])
  return out
}

/**
 * Route overlap: what share of the passenger's required corridor (pickup → destination road geometry)
 * lies within `toleranceM` of the driver's normal route. Geometry-based, not point-to-point distance.
 */
export function corridorOverlapPercent(corridor: LatLng[], driverRoute: LatLng[], toleranceM = 150): number {
  const pts = samplePolyline(corridor, 100)
  if (pts.length === 0) return 0
  const on = pts.filter((p) => distanceToPolylineM(p, driverRoute) <= toleranceM).length
  return Math.round((on / pts.length) * 100)
}

/** Nearest point on a polyline: its distance from `p` and how far along the line (m) it sits. */
export function snapToPolyline(p: LatLng, line: LatLng[]): { distanceM: number; alongM: number } {
  const k = Math.cos((p.lat * Math.PI) / 180)
  const m = 111320
  const px = p.lng * k * m
  const py = p.lat * m
  let best = { distanceM: Infinity, alongM: 0 }
  let acc = 0
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i].lng * k * m, ay = line[i].lat * m
    const bx = line[i + 1].lng * k * m, by = line[i + 1].lat * m
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)))
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d < best.distanceM) best = { distanceM: d, alongM: acc + t * len }
    acc += len
  }
  return best
}

/** The part of a polyline between two distances along it (either order). */
export function sliceAlong(line: LatLng[], fromM: number, toM: number): LatLng[] {
  const [a, b] = fromM <= toM ? [fromM, toM] : [toM, fromM]
  const out: LatLng[] = []
  let acc = 0
  const at = (target: number): LatLng => {
    let run = 0
    for (let i = 0; i < line.length - 1; i++) {
      const k = Math.cos((line[i].lat * Math.PI) / 180)
      const len = Math.hypot((line[i + 1].lng - line[i].lng) * k * 111320, (line[i + 1].lat - line[i].lat) * 111320)
      if (run + len >= target || i === line.length - 2) {
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, (target - run) / len))
        return { lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t, lng: line[i].lng + (line[i + 1].lng - line[i].lng) * t }
      }
      run += len
    }
    return line[line.length - 1]
  }
  out.push(at(a))
  for (let i = 0; i < line.length - 1; i++) {
    const k = Math.cos((line[i].lat * Math.PI) / 180)
    acc += Math.hypot((line[i + 1].lng - line[i].lng) * k * 111320, (line[i + 1].lat - line[i].lat) * 111320)
    if (acc > a && acc < b) out.push(line[i + 1])
  }
  out.push(at(b))
  const pts = fromM <= toM ? out : out.reverse()
  return pts
}
