import { describe, expect, it, vi } from 'vitest'
import { measure, type RouteResult, type Router, type RoutingInput } from '@/domain/measure'
import { distanceM } from '@/lib/geo'
import type { LatLng } from '@/domain/types'

/**
 * A provider like Mapbox: points that snap to the same spot on the road come back as a valid zero-length route.
 * `snapUnder` = how close two points must be to snap together.
 */
const provider = (opts: { snapUnder?: number; failWith?: string; badZero?: boolean } = {}): Router & { drive: ReturnType<typeof vi.fn>; walk: ReturnType<typeof vi.fn> } => {
  const route = (pts: LatLng[]): RouteResult => {
    const [a, b] = pts
    const d = distanceM(a, b)
    const coords: [number, number][] = [[a.lng, a.lat], [b.lng, b.lat]]
    if (opts.failWith) throw new Error(opts.failWith)
    if (opts.badZero || d < (opts.snapUnder ?? 60)) return { coordinates: coords, distanceM: 0, durationS: 0 }
    return { coordinates: coords, distanceM: Math.round(d * 1.3), durationS: Math.round((d * 1.3) / 12) }
  }
  return { drive: vi.fn(async (p: LatLng[]) => route(p)), walk: vi.fn(async (p: LatLng[]) => route(p)) }
}

const at = (lat: number, lng: number): LatLng => ({ lat, lng })
const DRIVER_ORIGIN = at(-29.5353, 31.2117)
const DRIVER_DEST = at(-29.7392, 31.0762)
const ROUTE = [DRIVER_ORIGIN, at(-29.6, 31.15), DRIVER_DEST]
const input = (over: Partial<RoutingInput> = {}): RoutingInput => ({
  driverOrigin: DRIVER_ORIGIN,
  driverDestination: DRIVER_DEST,
  driverRoute: ROUTE,
  passengerOrigin: at(-29.5360, 31.2125),
  pickup: at(-29.5400, 31.2100),
  passengerDestination: DRIVER_DEST,
  ...over,
})

describe('measure — zero-length routes between nearby points', () => {
  it('same workplace: a drop-off a few metres from the driver’s destination is a match, not an error', async () => {
    const r = await measure(input({ passengerDestination: at(DRIVER_DEST.lat + 0.0002, DRIVER_DEST.lng) /* ≈ 22 m */ }), provider())
    expect(r.route.baselineDurationS).toBeGreaterThan(0)
    expect(Math.abs(r.route.matchedDurationS - r.route.baselineDurationS)).toBeLessThan(15) // same workplace ⇒ essentially no extra driving
    expect(r.route.destinationOffRouteM).toBeLessThan(60)
  })

  it('a pickup a few metres from the passenger is a zero-length walk, not an error', async () => {
    const o = input().passengerOrigin
    const r = await measure(input({ pickup: at(o.lat + 0.00004, o.lng) /* ≈ 4 m */ }), provider())
    expect(r.walking.distanceM).toBe(0)
  })

  it('passenger living at the driver’s start: nothing to drive to the pickup, still measured', async () => {
    const r = await measure(input({ passengerOrigin: at(DRIVER_ORIGIN.lat + 0.0001, DRIVER_ORIGIN.lng), pickup: at(DRIVER_ORIGIN.lat + 0.0001, DRIVER_ORIGIN.lng) }), provider())
    expect(r.route.toPickupDurationS).toBe(0)
    expect(r.route.pickupDeviationS).toBeLessThan(10)
  })

  it('identical points never reach the routing provider', async () => {
    const p = provider()
    await measure(input({ passengerOrigin: input().pickup, passengerDestination: DRIVER_DEST }), p)
    const calls = p.drive.mock.calls.map((c) => c[0] as LatLng[])
    expect(calls.every(([a, b]) => distanceM(a, b) >= 1)).toBe(true)
    expect(p.walk).not.toHaveBeenCalled()
  })
})

describe('measure — genuinely bad data is still refused', () => {
  it('a zero-length route between DISTANT points is rejected', async () => {
    await expect(measure(input(), provider({ badZero: true }))).rejects.toThrow(/No road route/)
  })

  it('a provider "no route" error is not swallowed or invented around', async () => {
    await expect(measure(input(), provider({ failWith: 'No route found between those places' }))).rejects.toThrow(/No route found/)
  })

  it('a zero-length walk to a DISTANT pickup is rejected', async () => {
    const p = provider()
    p.walk.mockResolvedValue({ coordinates: [[31.2, -29.5], [31.2, -29.5]], distanceM: 0, durationS: 0 })
    await expect(measure(input({ pickup: at(-29.55, 31.23) /* ≈ 2 km away */ }), p)).rejects.toThrow(/No pedestrian route/)
  })

  it('NaN or out-of-range coordinates are refused before any lookup', async () => {
    const p = provider()
    await expect(measure(input({ pickup: at(Number.NaN, 31.2) }), p)).rejects.toThrow(/Invalid route coordinates/)
    await expect(measure(input({ pickup: at(120, 31.2) }), p)).rejects.toThrow(/Invalid route coordinates/)
    expect(p.drive).not.toHaveBeenCalled()
  })
})
