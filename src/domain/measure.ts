import type { Candidate } from './matching'
import type { LatLng } from './types'
import { corridorOverlapPercent, distanceToPolylineM } from '@/lib/corridor'
import { distanceM } from '@/lib/geo'

/**
 * Road-network measurements for a (driver, passenger) pairing. Everything the matching engine
 * needs about distance and time comes from a routing provider (Mapbox Directions) — never from
 * lat/lng differences. If the provider is unavailable the call throws; callers show an error state
 * rather than inventing numbers.
 *
 * Pure (no browser or Vite APIs): the same file runs in the app and in the `find-matches` Edge
 * Function (copied by scripts/sync-edge-engine.mjs).
 */

export interface RouteResult {
  coordinates: [number, number][] // [lng, lat]
  distanceM: number
  durationS: number
}

export interface Router {
  drive(points: LatLng[]): Promise<RouteResult>
  walk(points: LatLng[]): Promise<RouteResult>
}

export interface RoutingInput {
  driverOrigin: LatLng
  driverDestination: LatLng
  /** driver's stored normal route geometry (for overlap) */
  driverRoute: LatLng[]
  passengerOrigin: LatLng
  pickup: LatLng
  passengerDestination: LatLng
}

export type Measured = Pick<Candidate, 'route' | 'walking'> & {
  /** Kept for the view-model contract; successful measurements are always road verified. */
  walkingEstimated: boolean
  /** geometry for the map: driver's matched route and the walk */
  matchedPath: LatLng[]
  /** Public itinerary only: pickup → passenger destination, no private driver approach/continuation. */
  passengerPath: LatLng[]
  walkPath: LatLng[]
}

/** How far apart two points can be and still legitimately snap to the same road/footpath position. */
const SNAP_M = 150
const toLatLngs = (c: [number, number][]): LatLng[] => c.map(([lng, lat]) => ({ lat, lng }))
const validPoint = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
const validRoute = (r: RouteResult) => Number.isFinite(r.distanceM) && r.distanceM >= 0 && Number.isFinite(r.durationS) && r.durationS >= 0
  && Array.isArray(r.coordinates) && r.coordinates.length >= 2
  && r.coordinates.every(p => Array.isArray(p) && p.length === 2 && validPoint({ lng: p[0], lat: p[1] }))

export async function measure(input: RoutingInput, router: Router): Promise<Measured> {
  const { driverOrigin: o, driverDestination: d, pickup: p, passengerDestination: pd } = input
  if (![o, d, p, pd, input.passengerOrigin, ...input.driverRoute].every(validPoint) || input.driverRoute.length < 2)
    throw new Error('Invalid route coordinates')
  // Shared pickup/drop-off endpoints need no lookup. Directions providers can
  // legitimately return NoRoute for an identical start and destination.
  const drive = async (a: LatLng, b: LatLng): Promise<RouteResult> => {
    if (distanceM(a, b) < 1) return { coordinates: [[a.lng, a.lat], [b.lng, b.lat]], distanceM: 0, durationS: 0 }
    const route = await router.drive([a, b])
    // Two points a few metres apart can snap to the same spot on the road: the provider then returns a valid ZERO-length route.
    // That is normal (e.g. two geocodes of the same office) — only a zero-length route between distant points is bad data.
    if (!validRoute(route) || ((route.distanceM <= 0 || route.durationS <= 0) && distanceM(a, b) > SNAP_M)) throw new Error('No road route found between those places')
    return route
  }

  const [baseline, toPickup, pickupToPassengerDest, passengerDestToDriverDest, pickupToDriverDest] = await Promise.all([
    drive(o, d),
    drive(o, p),
    drive(p, pd),
    drive(pd, d),
    drive(p, d),
  ])
  for (const r of [baseline, toPickup, pickupToPassengerDest, passengerDestToDriverDest, pickupToDriverDest]) {
    if (!validRoute(r)) throw new Error('No road route found between those places')
  }

  // driver origin → pickup → passenger drop-off → driver destination
  const matchedDurationS = toPickup.durationS + pickupToPassengerDest.durationS + passengerDestToDriverDest.durationS
  const matchedDistanceM = toPickup.distanceM + pickupToPassengerDest.distanceM + passengerDestToDriverDest.distanceM
  // detour just to reach the pickup and carry on to the driver's destination
  const pickupDeviationS = toPickup.durationS + pickupToDriverDest.durationS - baseline.durationS

  let walking: { distanceM: number; durationS: number }
  let walkPath: LatLng[]
  if (distanceM(input.passengerOrigin, p) < 1) {
    // door pickup: nothing to walk, and no pedestrian lookup needed
    walking = { distanceM: 0, durationS: 0 }
    walkPath = [input.passengerOrigin, p]
  } else {
    const w = await router.walk([input.passengerOrigin, p])
    // a pickup a few metres from the passenger can snap to the same footpath point: a zero-length walk, not a failure
    if (!validRoute(w) || ((w.distanceM <= 0 || w.durationS <= 0) && distanceM(input.passengerOrigin, p) > SNAP_M)) throw new Error('No pedestrian route found to that pickup')
    walking = { distanceM: w.distanceM, durationS: w.durationS }
    walkPath = toLatLngs(w.coordinates)
  }

  const corridor = toLatLngs(pickupToPassengerDest.coordinates)
  return {
    route: {
      baselineDurationS: baseline.durationS,
      baselineDistanceM: baseline.distanceM,
      matchedDurationS,
      matchedDistanceM,
      toPickupDurationS: toPickup.durationS,
      pickupToDestinationDurationS: pickupToPassengerDest.durationS,
      pickupDeviationS: Math.max(0, pickupDeviationS),
      overlapPercent: corridorOverlapPercent(corridor, input.driverRoute),
      destinationOffRouteM: distanceToPolylineM(pd, input.driverRoute),
    },
    walking,
    walkingEstimated: false,
    matchedPath: [...toLatLngs(toPickup.coordinates), ...corridor],
    passengerPath: corridor,
    walkPath,
  }
}
