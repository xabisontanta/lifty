import type {
  DriverLocation,
  LatLng,
  Match,
  PassengerLocation,
  TrackingSnapshot,
  TrackingStatus,
} from '@/domain/types'
import { bearing, distanceM, pathLengthM, pointAlong } from '@/lib/geo'
import type { CommuteInstance } from './api'
import { SupabaseTrackingFeed } from './supabaseTracking'
import { currentUserId } from './supabase'

/**
 * Live-location abstraction.
 *
 * UI components never move markers themselves; they subscribe to a
 * `TrackingFeed` and render whatever snapshot arrives. `SimulatedTrackingFeed`
 * is the development implementation that replays a commute along the match's
 * real geometry. A production implementation (websocket / realtime channel)
 * only has to satisfy the same `TrackingFeed` interface.
 */
export interface TrackingFeed {
  getSnapshot(): TrackingSnapshot
  subscribe(listener: (s: TrackingSnapshot) => void): () => void
  /** Explicit pickup actions — we never rely on GPS inference alone. */
  markDriverArrived(): void
  markPassengerAtPickup(): void
  markCollected(): void
  /** driver only, after the 3-minute grace period */
  markNoShow(): void
  endSharing(): void
  /** dev: stop emitting updates so stale-location UX can be exercised */
  setLinkDown(down: boolean): void
  restart(): void
  dispose(): void
}

const TICK_MS = 500
const APPROACH_SECONDS = 36 // simulated duration of "driver approaching"
const WALK_SECONDS = 30
const RIDE_SECONDS = 36
const SHARING_SOON_SECONDS = 2.5
export const GRACE_MS = 3 * 60 * 1000 // driver waits 3 minutes before a no-show can be recorded

export class SimulatedTrackingFeed implements TrackingFeed {
  private listeners = new Set<(s: TrackingSnapshot) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private t = 0 // simulated seconds since start
  private rideT = 0
  private linkDown = false
  private driverPath: LatLng[]
  private ridePath: LatLng[]
  private walkPath: LatLng[]
  private snapshot: TrackingSnapshot
  private flags = { driverArrived: false, passengerAtPickup: false, collected: false, ended: false, noShow: false }
  private driverArrivedAt: number | null = null
  private bothSince: number | null = null
  private pickupMinutes: number
  private rideMinutes: number
  private walkingMinutes: number
  private arrivedAt: number | null = null

  constructor(private match: Match) {
    const route = match.geometry.path
    const dev = match.geometry.deviation
    // driver heads from route start, along the route to the junction, then deviates to the pickup
    const joinPoint = dev[0]
    const joinIdx = Math.max(1, route.findIndex((p) => p.lat === joinPoint.lat && p.lng === joinPoint.lng))
    this.driverPath = [...route.slice(0, joinIdx + 1), dev[1]]
    const rejoin = dev[2]
    const rejoinIdx = Math.max(0, route.findIndex((p) => p.lat === rejoin.lat && p.lng === rejoin.lng))
    this.ridePath = [dev[1], rejoin, ...route.slice(rejoinIdx + 1)]
    this.walkPath = match.geometry.walking
    this.pickupMinutes = Math.max(2, toMin(match.pickupEta) - toMin(match.departureTime))
    this.rideMinutes = Math.max(10, toMin(match.arrivalEta) - toMin(match.pickupEta))
    this.walkingMinutes = match.walkingMinutes
    this.snapshot = this.compute()
    this.start()
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe(listener: (s: TrackingSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  markDriverArrived() {
    this.flags.driverArrived = true
    this.emit()
  }
  markPassengerAtPickup() {
    this.flags.passengerAtPickup = true
    this.emit()
  }
  markCollected() {
    if (!this.flags.driverArrived || !this.flags.passengerAtPickup) {
      this.flags.driverArrived = true
      this.flags.passengerAtPickup = true
    }
    this.flags.collected = true
    this.emit()
  }
  markNoShow() {
    if (!this.driverArrivedAt || Date.now() - this.driverArrivedAt < GRACE_MS) return
    this.flags.noShow = true
    this.flags.ended = true
    this.emit()
  }
  endSharing() {
    this.flags.ended = true
    this.emit()
  }
  setLinkDown(down: boolean) {
    this.linkDown = down
  }
  restart() {
    this.t = 0
    this.rideT = 0
    this.arrivedAt = null
    this.bothSince = null
    this.flags = { driverArrived: false, passengerAtPickup: false, collected: false, ended: false, noShow: false }
    this.driverArrivedAt = null
    this.emit()
  }
  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }

  private start() {
    this.timer = setInterval(() => {
      const dt = TICK_MS / 1000
      if (!this.flags.collected) this.t += dt
      else if (this.rideT < RIDE_SECONDS) this.rideT += dt
      this.emit()
    }, TICK_MS)
  }

  private emit() {
    if (this.linkDown) return
    this.snapshot = this.compute()
    this.listeners.forEach((l) => l(this.snapshot))
  }

  private compute(): TrackingSnapshot {
    const now = Date.now()
    const g = this.match.geometry
    const pickup = g.walking[g.walking.length - 1]
    const destination = this.ridePath[this.ridePath.length - 1]

    const startDelay = SHARING_SOON_SECONDS
    const active = Math.max(0, this.t - startDelay)
    const driverFrac = this.flags.driverArrived ? 1 : Math.min(1, active / APPROACH_SECONDS)
    const walkFrac = this.flags.passengerAtPickup ? 1 : Math.min(1, Math.max(0, active - 4) / WALK_SECONDS)

    const driverLen = pathLengthM(this.driverPath)
    const driverPos = pointAlong(this.driverPath, driverLen * driverFrac)
    const walkLen = pathLengthM(this.walkPath)
    const walkPos = pointAlong(this.walkPath, walkLen * walkFrac)

    let driverLoc: DriverLocation
    let passengerLoc: PassengerLocation | null

    const driverAtPickup = driverFrac >= 0.999
    const paxAtPickup = walkFrac >= 0.999

    if (this.flags.collected) {
      const rideLen = pathLengthM(this.ridePath)
      const rideFrac = Math.min(1, this.rideT / RIDE_SECONDS)
      const pos = pointAlong(this.ridePath, rideLen * rideFrac)
      const ahead = pointAlong(this.ridePath, rideLen * Math.min(1, rideFrac + 0.02))
      driverLoc = { ...pos, heading: bearing(pos, ahead), speed: rideFrac >= 1 ? 0 : 62, updatedAt: now }
      passengerLoc = { ...pos, updatedAt: now }
    } else {
      const ahead = pointAlong(this.driverPath, driverLen * Math.min(1, driverFrac + 0.03))
      driverLoc = {
        ...driverPos,
        heading: driverFrac >= 1 ? 0 : bearing(driverPos, ahead),
        speed: driverFrac >= 1 ? 0 : 34,
        updatedAt: now,
      }
      passengerLoc = { ...walkPos, updatedAt: now }
    }

    const rideFrac = Math.min(1, this.rideT / RIDE_SECONDS)
    const pickupEta = this.flags.collected || driverAtPickup ? 0 : Math.max(1, Math.ceil((1 - driverFrac) * this.pickupMinutes))
    const walkingEta = this.flags.collected || paxAtPickup ? 0 : Math.max(1, Math.ceil((1 - walkFrac) * this.walkingMinutes))
    const walkingDistanceM = this.flags.collected || paxAtPickup ? 0 : Math.round((walkLen * (1 - walkFrac)) / 10) * 10
    const destinationEta = this.flags.collected ? Math.max(0, Math.ceil((1 - rideFrac) * this.rideMinutes)) : this.rideMinutes

    const driverArrived = this.flags.driverArrived || driverAtPickup
    if (driverArrived && this.driverArrivedAt == null) this.driverArrivedAt = now
    const passengerAtPickup = this.flags.passengerAtPickup || paxAtPickup

    // auto-confirm pickup if both have been at the pickup point for a moment (explicit actions win)
    if (!this.flags.collected && driverArrived && passengerAtPickup) {
      this.bothSince = this.bothSince ?? now
      if (now - this.bothSince > 9000) this.flags.collected = true
    } else {
      this.bothSince = null
    }

    let status: TrackingStatus
    if (this.flags.ended) status = 'ended'
    else if (this.flags.collected) {
      if (rideFrac >= 1) {
        this.arrivedAt = this.arrivedAt ?? now
        status = 'destination-reached'
      } else status = 'underway'
    } else if (this.t < startDelay) status = 'sharing-soon'
    else if (driverArrived && passengerAtPickup) status = 'both-at-pickup'
    else if (driverArrived) status = 'passenger-approaching'
    else status = 'driver-approaching'

    return {
      status,
      driverLocation: driverLoc,
      passengerLocation: passengerLoc,
      pickupEta,
      walkingEta,
      walkingDistanceM,
      destinationEta,
      routeGeometry: this.match.geometry.path,
      deviationGeometry: this.match.geometry.deviation,
      walkingGeometry: this.match.geometry.walking,
      pickup,
      destination,
      collected: this.flags.collected,
      driverArrived,
      passengerAtPickup,
      driverArrivedAt: this.driverArrivedAt,
      noShow: this.flags.noShow,
    }
  }
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export { distanceM }

// ---- feed registry: passenger and driver screens share one feed per commute ----
const feeds = new Map<string, TrackingFeed>()
export function getTrackingFeed(match: Match & { liveInstance?: CommuteInstance }, opts: { lowData?: boolean } = {}): TrackingFeed {
  const key = match.liveInstance ? `live:${match.liveInstance.id}` : match.id
  let f = feeds.get(key)
  if (!f) {
    f = match.liveInstance ? new SupabaseTrackingFeed(match.liveInstance, currentUserId ?? '', opts) : new SimulatedTrackingFeed(match)
    feeds.set(key, f)
  }
  return f
}
export function resetTrackingFeed(key: string) {
  for (const k of [key, `live:${key}`]) {
    feeds.get(k)?.dispose()
    feeds.delete(k)
  }
}
