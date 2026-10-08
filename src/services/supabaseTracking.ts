import type { RealtimeChannel } from '@supabase/supabase-js'
import type { DriverLocation, LatLng, PassengerLocation, TrackingSnapshot, TrackingStatus } from '@/domain/types'
import { distanceM } from '@/lib/geo'
import type { CommuteInstance } from './api'
import { liveEtaMinutes } from './mapbox'
import { watchLocation, type DeviceFix } from './location'
import { notifyLocal } from './notifications'
import { sb } from './supabase'
import type { TrackingFeed } from './tracking'
import { reportError } from './monitoring'

/**
 * Real two-way live tracking.
 *
 * - Each device streams its own GPS (background-capable on native) into the private
 *   Realtime channel `commute:<instanceId>`. RLS on realtime.messages only lets members
 *   of this commute join, and only inside the sharing window.
 * - Positions are ephemeral broadcasts (no DB write per ping); a breadcrumb is stored
 *   every ~30 s for the safety record and purged after 30 days.
 * - Pickup state changes are explicit RPCs and arrive back via postgres_changes.
 * - ETAs come from Mapbox Directions (driving-traffic / walking), refreshed periodically.
 */

const BROADCAST_EVERY_MS = 4000
const BREADCRUMB_EVERY_MS = 30000
const ARRIVED_RADIUS_M = 150

interface PeerFix extends LatLng {
  heading: number | null
  speed: number | null
  at: number
}

export class SupabaseTrackingFeed implements TrackingFeed {
  private listeners = new Set<(s: TrackingSnapshot) => void>()
  private channel: RealtimeChannel | null = null
  private rowChannel: RealtimeChannel | null = null
  private stopGps: (() => void) | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private windowTimer: ReturnType<typeof setTimeout> | null = null
  private me: PeerFix | null = null
  private peer: PeerFix | null = null
  private lastBroadcast = 0
  private lastCrumb = 0
  private linkDown = false
  private riderStatus: string
  private instanceStatus: CommuteInstance['status']
  private driverArrivedAt: number | null
  private eta = { pickup: 0, walk: 0, walkM: 0, destination: 0 }
  private announced = new Set<string>()
  private snapshot: TrackingSnapshot
  private error: string | null = null

  constructor(private inst: CommuteInstance, private myId: string, private opts: { lowData?: boolean } = {}) {
    const rider = this.rider()
    this.riderStatus = rider?.status ?? 'expected'
    this.instanceStatus = inst.status
    this.driverArrivedAt = inst.driverArrivedAt
    this.eta.destination = Math.round(inst.routeDurationS / 60)
    this.snapshot = this.compute()
    void this.start()
  }

  private get isDriver() {
    return this.inst.isDriver
  }
  private rider() {
    return this.isDriver ? this.inst.riders.find((r) => r.status !== 'absent') ?? this.inst.riders[0] : this.inst.riders.find((r) => r.passengerId === this.myId)
  }

  getSnapshot() {
    return this.snapshot
  }
  subscribe(l: (s: TrackingSnapshot) => void) {
    this.listeners.add(l)
    l(this.snapshot)
    return () => {
      this.listeners.delete(l)
    }
  }
  getError() {
    return this.error
  }

  // ---------- explicit actions ----------
  markDriverArrived() {
    void this.rpc('mark_driver_arrived', { p_instance: this.inst.id }).then(() => {
      this.driverArrivedAt = this.driverArrivedAt ?? Date.now()
      this.emit()
    })
  }
  markPassengerAtPickup() {
    const r = this.rider()
    if (!r) return
    void this.rpc('mark_rider_status', { p_instance: this.inst.id, p_passenger: r.passengerId, p_status: 'at_pickup' }).then(() => {
      this.riderStatus = 'at_pickup'
      this.emit()
    })
  }
  markCollected() {
    const r = this.rider()
    if (!r) return
    void this.rpc('mark_rider_status', { p_instance: this.inst.id, p_passenger: r.passengerId, p_status: 'collected' }).then(() => {
      this.riderStatus = 'collected'
      this.instanceStatus = 'underway'
      this.emit()
    })
  }
  markNoShow() {
    const r = this.rider()
    if (!r) return
    void this.rpc('mark_rider_status', { p_instance: this.inst.id, p_passenger: r.passengerId, p_status: 'no_show' }).then(() => {
      this.riderStatus = 'no_show'
      this.emit()
    })
  }
  endSharing() {
    if (this.isDriver) void this.rpc('complete_instance', { p_instance: this.inst.id }).then(() => (this.instanceStatus = 'completed'))
    this.instanceStatus = this.isDriver ? 'completed' : this.instanceStatus
    this.stopSharing()
    this.riderStatus = this.riderStatus === 'collected' ? 'dropped_off' : this.riderStatus
    this.emit(true)
  }
  setLinkDown(down: boolean) {
    this.linkDown = down
  }
  restart() {
    this.emit()
  }
  dispose() {
    this.stopSharing()
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.windowTimer) clearTimeout(this.windowTimer)
    if (this.rowChannel) void sb().removeChannel(this.rowChannel)
    this.listeners.clear()
  }

  // ---------- lifecycle ----------
  private async start() {
    // row changes: driver arrival, rider status, instance status
    this.rowChannel = sb()
      .channel(`instance:${this.inst.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'commute_instances', filter: `id=eq.${this.inst.id}` }, (p) => {
        const n = p.new as { status: CommuteInstance['status']; driver_arrived_at: string | null }
        this.instanceStatus = n.status
        this.driverArrivedAt = n.driver_arrived_at ? new Date(n.driver_arrived_at).getTime() : null
        this.emit()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'instance_riders', filter: `instance_id=eq.${this.inst.id}` }, (p) => {
        const n = p.new as { passenger_id: string; status: string }
        if (n.passenger_id === this.rider()?.passengerId) {
          this.riderStatus = n.status
          this.emit()
        }
      })
      .subscribe()

    const now = Date.now()
    if (now < this.inst.sharingStartsAt) {
      this.windowTimer = setTimeout(() => void this.startSharing(), this.inst.sharingStartsAt - now)
    } else if (now <= this.inst.sharingEndsAt) {
      await this.startSharing()
    }
    this.timers.push(setInterval(() => this.emit(), 1000))
    this.timers.push(setInterval(() => void this.refreshEtas(), this.opts.lowData ? 60000 : 30000))
  }

  private async startSharing() {
    try {
      await sb().realtime.setAuth()
      this.channel = sb().channel(`commute:${this.inst.id}`, { config: { private: true, broadcast: { self: false } } })
      this.channel
        .on('broadcast', { event: 'loc' }, ({ payload }) => {
          if (this.linkDown) return
          const p = payload as { from: string; lat: number; lng: number; heading: number | null; speed: number | null; at: number }
          if (p.from === this.myId) return
          this.peer = { lat: p.lat, lng: p.lng, heading: p.heading, speed: p.speed, at: p.at }
          this.emit()
        })
        .subscribe((status) => {
          // supabase-js retries joins on its own; only surface an error while not subscribed
          if (status === 'SUBSCRIBED' && this.error) {
            this.error = null
            this.emit()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.error = 'Reconnecting live location…'
            this.emit()
          }
        })
      this.stopGps = await watchLocation(
        (fix) => this.onMyFix(fix),
        (msg) => {
          this.error = msg
          this.emit()
        },
        { lowData: this.opts.lowData },
      )
      void this.refreshEtas()
    } catch (e) {
      reportError(e, { where: 'startSharing' })
      this.error = 'Couldn’t start live location.'
      this.emit()
    }
  }

  private stopSharing() {
    this.stopGps?.()
    this.stopGps = null
    if (this.channel) void sb().removeChannel(this.channel)
    this.channel = null
  }

  private onMyFix(fix: DeviceFix) {
    this.me = { lat: fix.lat, lng: fix.lng, heading: fix.heading, speed: fix.speedKmh, at: fix.at }
    const now = Date.now()
    if (this.channel && !this.linkDown && now - this.lastBroadcast > BROADCAST_EVERY_MS) {
      this.lastBroadcast = now
      void this.channel.send({ type: 'broadcast', event: 'loc', payload: { from: this.myId, ...this.me } })
    }
    if (now - this.lastCrumb > BREADCRUMB_EVERY_MS) {
      this.lastCrumb = now
      void sb().rpc('record_location', { p_instance: this.inst.id, p_lng: fix.lng, p_lat: fix.lat, p_heading: fix.heading, p_speed: fix.speedKmh })
    }
    // automatic "I'm here" suggestion is left to the UI — state changes stay explicit
    this.emit()
  }

  private driverPos(): PeerFix | null {
    return this.isDriver ? this.me : this.peer
  }
  private passengerPos(): PeerFix | null {
    return this.isDriver ? this.peer : this.me
  }

  private async refreshEtas() {
    const pickup = this.rider()?.pickup.location
    const d = this.driverPos()
    const p = this.passengerPos()
    try {
      if (this.riderStatus === 'collected' || this.instanceStatus === 'underway') {
        if (d) this.eta.destination = (await liveEtaMinutes(d, this.inst.destination.location, 'driving-traffic')).minutes
      } else if (pickup) {
        if (d) this.eta.pickup = (await liveEtaMinutes(d, pickup, 'driving-traffic')).minutes
        if (p) {
          const w = await liveEtaMinutes(p, pickup, 'walking')
          this.eta.walk = w.minutes
          this.eta.walkM = w.distanceM
        }
      }
    } catch {
      // fall back to straight-line estimates
      if (pickup && d) this.eta.pickup = Math.round(distanceM(d, pickup) / 500)
      if (pickup && p) {
        this.eta.walkM = Math.round(distanceM(p, pickup) * 1.25)
        this.eta.walk = Math.round(this.eta.walkM / 70)
      }
    }
    this.emit()
  }

  private rpc(fn: string, args: Record<string, unknown>) {
    return sb()
      .rpc(fn, args)
      .then(({ error }) => {
        if (error) {
          this.error = error.message.replace(/^.*?ERROR:\s*/, '')
          this.emit()
          throw error
        }
      })
  }

  private emit(force = false) {
    if (this.linkDown && !force) return
    this.snapshot = this.compute()
    this.notifyMilestones()
    this.listeners.forEach((l) => l(this.snapshot))
  }

  private notifyMilestones() {
    const s = this.snapshot
    const once = (key: string, title: string, body: string) => {
      if (this.announced.has(key)) return
      this.announced.add(key)
      void notifyLocal(title, body)
    }
    if (!this.isDriver && s.status === 'driver-approaching' && s.pickupEta > 0 && s.pickupEta <= 5) once('5min', 'Your driver is 5 minutes away', `Head to ${this.rider()?.pickup.label ?? 'the pickup point'}.`)
    if (!this.isDriver && s.driverArrived) once('arrived', 'Your driver has arrived', 'They’ll wait 3 minutes at the pickup point.')
    if (this.isDriver && s.passengerAtPickup) once('pax-here', 'Your passenger is at the pickup point', '')
  }

  private compute(): TrackingSnapshot {
    const now = Date.now()
    const pickup = this.rider()?.pickup.location ?? this.inst.destination.location
    const d = this.driverPos()
    const p = this.passengerPos()
    const collected = this.riderStatus === 'collected' || this.riderStatus === 'dropped_off'
    const passengerAtPickup = this.riderStatus === 'at_pickup' || collected || (!!p && distanceM(p, pickup) < 40)
    const driverArrived = this.driverArrivedAt != null || collected
    const nearDestination = !!d && distanceM(d, this.inst.destination.location) < ARRIVED_RADIUS_M

    let status: TrackingStatus
    if (this.instanceStatus === 'completed' || this.instanceStatus === 'cancelled' || now > this.inst.sharingEndsAt || this.riderStatus === 'no_show')
      status = this.riderStatus === 'dropped_off' || nearDestination ? 'destination-reached' : 'ended'
    else if (now < this.inst.sharingStartsAt) status = 'sharing-soon'
    else if (collected) status = nearDestination ? 'destination-reached' : 'underway'
    else if (driverArrived && passengerAtPickup) status = 'both-at-pickup'
    else if (driverArrived) status = 'passenger-approaching'
    else status = 'driver-approaching'

    const driverLocation: DriverLocation | null = d ? { lat: d.lat, lng: d.lng, heading: d.heading ?? 0, speed: d.speed ?? 0, updatedAt: d.at } : null
    const passengerLocation: PassengerLocation | null = p ? { lat: p.lat, lng: p.lng, updatedAt: p.at } : null
    return {
      status,
      driverLocation,
      passengerLocation,
      pickupEta: driverArrived ? 0 : this.eta.pickup,
      walkingEta: passengerAtPickup ? 0 : this.eta.walk,
      walkingDistanceM: passengerAtPickup ? 0 : this.eta.walkM,
      destinationEta: this.eta.destination,
      routeGeometry: this.inst.route,
      deviationGeometry: [],
      walkingGeometry: p && !passengerAtPickup ? [p, pickup] : [],
      pickup,
      destination: this.inst.destination.location,
      collected,
      driverArrived,
      passengerAtPickup,
      driverArrivedAt: this.driverArrivedAt,
      noShow: this.riderStatus === 'no_show',
    }
  }
}
