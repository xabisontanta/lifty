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
 * - Every fix goes through publish_location, which checks consent, membership and
 *   the sharing window before broadcasting to individual driver/passenger channels.
 * - Owner/safety-reviewer breadcrumbs are sampled about every 30 seconds and
 *   purged after 30 days. Channel admission alone never authorizes a new fix.
 * - Pickup state changes are explicit RPCs and arrive back via postgres_changes.
 * - ETAs come from Mapbox Directions (driving-traffic / walking), refreshed periodically.
 */

const BROADCAST_EVERY_MS = 4000
const RESYNC_EVERY_MS = 10_000
/** A driver on the road publishes every few seconds, so this long a silence on a channel that claims to be connected means it is dead. */
const CHANNEL_SILENCE_MS = 30_000
const ARRIVED_RADIUS_M = 150

interface PeerFix extends LatLng {
  heading: number | null
  speed: number | null
  at: number
}

export class SupabaseTrackingFeed implements TrackingFeed {
  private listeners = new Set<(s: TrackingSnapshot) => void>()
  private channels: RealtimeChannel[] = []
  private disposed=false
  private stopped=false
  private epoch=0
  private selectedRiderId: string | null=null
  private peers=new Map<string,PeerFix>()
  private gpsStarting=false
  private rowChannel: RealtimeChannel | null = null
  private stopGps: (() => void) | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private windowTimer: ReturnType<typeof setTimeout> | null = null
  private me: PeerFix | null = null
  private peer: PeerFix | null = null
  private lastBroadcast = 0
  private heardAt = 0 // when a position last arrived (local clock)
  private channelsOpenedAt = 0
  private lastRebuild = 0
  private linkDown = false
  private riderStatus: string
  private instanceStatus: CommuteInstance['status']
  private driverArrivedAt: number | null
  private eta = { pickup: 0, walk: 0, walkM: 0, destination: 0 }
  private announced = new Set<string>()
  private snapshot: TrackingSnapshot
  private error: string | null = null

  constructor(private inst: CommuteInstance, private myId: string, private opts: { lowData?: boolean; sharingConsent?: boolean } = {}) {
    this.selectedRiderId=inst.riders.find(r=>r.status==='expected'||r.status==='at_pickup')?.passengerId??inst.riders[0]?.passengerId??null
    const rider = this.rider()
    this.riderStatus = rider?.status ?? 'expected'
    this.instanceStatus = inst.status
    this.driverArrivedAt = rider?.driverArrivedAt ?? null
    this.eta.destination = Math.round(inst.routeDurationS / 60)
    this.snapshot = this.compute()
    void this.start()
  }

  private get isDriver() {
    return this.inst.isDriver
  }
  private rider() {
    return this.isDriver ? this.inst.riders.find(r=>r.passengerId===this.selectedRiderId) : this.inst.riders.find((r) => r.passengerId === this.myId)
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

  selectRider(passengerId: string) {
    if(!this.isDriver || !this.inst.riders.some(r=>r.passengerId===passengerId)) return
    this.selectedRiderId=passengerId;this.syncRider();this.emit();void this.refreshEtas()
  }
  private syncRider(){ const r=this.rider();this.riderStatus=r?.status??'absent';this.driverArrivedAt=r?.driverArrivedAt??null;this.peer=this.isDriver?(this.peers.get(r?.passengerId??'')??null):(this.peers.get(this.inst.driver.id)??null) }
  setConsent(consent:boolean){if(consent===this.opts.sharingConsent)return;this.opts.sharingConsent=consent;if(!consent)this.stopOnlyGps();else if(this.channels.length)void this.startGps()}
  private actionRider(passengerId?:string) {
    const r=passengerId&&this.isDriver?this.inst.riders.find(r=>r.passengerId===passengerId):this.rider()
    if(!r)throw new Error('This passenger is not part of the commute.')
    return r
  }
  async markDriverArrived(passengerId?:string){const r=this.actionRider(passengerId);await this.action('mark_driver_arrived',{p_instance:this.inst.id,p_passenger:r.passengerId},()=>{r.driverArrivedAt=Date.now();this.syncRider()})}
  async markPassengerAtPickup(){await this.changeRider('at_pickup')}
  async markCollected(passengerId?:string){await this.changeRider('collected',passengerId)}
  async markNoShow(passengerId?:string){await this.changeRider('no_show',passengerId)}
  private async changeRider(status:string,passengerId?:string){const r=this.actionRider(passengerId);await this.action('mark_rider_status',{p_instance:this.inst.id,p_passenger:r.passengerId,p_status:status},()=>{r.status=status;this.syncRider();if(!this.isDriver&&status==='collected')this.stopOnlyGps()})}
  private async action(name:string,args:Record<string,unknown>,done:()=>void){
    if(!await this.rpc(name,args))throw new Error(this.error??'Could not update this pickup. Please retry.')
    if(this.disposed)return
    this.error=null;done();this.emit()
  }
  async endSharing(){
    const ok=await this.rpc(this.isDriver?'complete_instance':'stop_my_sharing',{p_instance:this.inst.id})
    if(ok){this.stopped=true;if(this.isDriver)this.instanceStatus='completed';this.stopSharing();this.emit()}
    return ok
  }
  setLinkDown(down:boolean){this.linkDown=down}
  restart(){if(!this.disposed&&!this.stopped) {this.error=null;this.rebuildChannels();void this.resync();this.emit()}}
  /** Drop the live location channels and subscribe again (the last known positions stay on screen until a new one arrives). */
  private rebuildChannels(){
    if(this.disposed||this.stopped)return
    this.lastRebuild=Date.now()
    this.channels.forEach((ch)=>void sb().removeChannel(ch));this.channels=[]
    void this.startSharing()
  }
  /** A rider whose driver channel has gone quiet rebuilds it by itself, as a driver would on the road; a driver's riders are often legitimately silent, so they do not. */
  private healSilentChannel(){
    if(this.isDriver||!this.channels.length||!this.windowOpen())return
    const now=Date.now()
    if(now-Math.max(this.heardAt,this.channelsOpenedAt)<CHANNEL_SILENCE_MS||now-this.lastRebuild<CHANNEL_SILENCE_MS)return
    this.rebuildChannels()
  }
  dispose(){this.disposed=true;this.stopSharing();this.timers.forEach(clearInterval);this.timers=[];if(this.windowTimer)clearTimeout(this.windowTimer);if(this.rowChannel)void sb().removeChannel(this.rowChannel);this.listeners.clear()}

  // ---------- lifecycle ----------
  private async start() {
    // row changes: driver arrival, rider status, instance status
    this.rowChannel = sb()
      .channel(`instance:${this.inst.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'commute_instances', filter: `id=eq.${this.inst.id}` }, (p) => {
        const n = p.new as { status: CommuteInstance['status']; driver_arrived_at: string | null }
        this.instanceStatus = n.status
        if(n.status==='completed'||n.status==='cancelled')this.stopSharing()
        this.emit()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'instance_riders', filter: `instance_id=eq.${this.inst.id}` }, (p) => {
        const n=p.new as {passenger_id:string;status:string;driver_arrived_at:string|null}
        const r=this.inst.riders.find(r=>r.passengerId===n.passenger_id)
        if(r){r.status=n.status;r.driverArrivedAt=n.driver_arrived_at?new Date(n.driver_arrived_at).getTime():null;this.syncRider();if(!this.isDriver&&n.status!=='expected'&&n.status!=='at_pickup')this.stopOnlyGps();this.emit()}
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void this.resync() }) // anything that changed before the channel was ready

    const now = Date.now()
    if (now < this.inst.sharingStartsAt) {
      this.windowTimer = setTimeout(() => void this.startSharing(), this.inst.sharingStartsAt - now)
    } else if (now <= this.inst.sharingEndsAt) {
      await this.startSharing()
    }
    if(this.disposed)return
    this.timers.push(setInterval(() => {if(Date.now()>this.inst.sharingEndsAt)this.stopSharing();this.healSilentChannel();this.emit()},1000))
    this.timers.push(setInterval(()=>void this.refreshAuthorization(),5000))
    this.timers.push(setInterval(()=>void this.resync(),RESYNC_EVERY_MS))
    this.timers.push(setInterval(() => void this.refreshEtas(), this.opts.lowData ? 60000 : 30000))
  }

  private windowOpen(){return !this.disposed&&!this.stopped&&Date.now()>=this.inst.sharingStartsAt&&Date.now()<=this.inst.sharingEndsAt&&!['completed','cancelled'].includes(this.instanceStatus)}
  private async startSharing(){
    if(!this.windowOpen()||this.channels.length)return
    const epoch=++this.epoch
    try{
      await sb().realtime.setAuth()
      if(epoch!==this.epoch||!this.windowOpen())return
      const riders=this.isDriver?this.inst.riders.filter(r=>!['absent','no_show','dropped_off'].includes(r.status)):this.inst.riders.filter(r=>r.passengerId===this.myId)
      for(const r of riders){
        const expected=this.isDriver?r.passengerId:this.inst.driver.id
        const ch=sb().channel('commute:'+this.inst.id+':'+r.passengerId,{config:{private:true}})
        ch.on('broadcast',{event:'loc'},({payload})=>{
          if(!this.windowOpen()||this.linkDown||payload.from!==expected||!Number.isFinite(payload.lat)||!Number.isFinite(payload.lng))return
          this.heardAt=Date.now();this.peers.set(expected,payload);this.syncRider();this.emit()
        }).subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')this.error='Reconnecting live location…';else if(status==='SUBSCRIBED')this.error=null;this.emit()})
        this.channels.push(ch);this.channelsOpenedAt=Date.now()
      }
      await this.startGps();void this.refreshEtas()
    }catch(e){reportError(e,{where:'startSharing'});this.error='Could not connect live location';this.emit()}
  }
  /**
   * Safety net for live updates. A row change that lands between loading the trip and the channel finishing its subscription — or
   * while the connection drops — is never replayed, and the screen would stay on the old state (a rider still "waiting" after the
   * driver collected them). Re-read this trip's own rows when the channel connects and every few seconds, applying only what differs.
   */
  private async resync() {
    if (this.disposed || this.stopped) return
    try {
      const [trip, riders, computed] = await Promise.all([
        sb().from('commute_instances').select('status').eq('id', this.inst.id).maybeSingle(),
        sb().from('instance_riders').select('passenger_id, status, driver_arrived_at').eq('instance_id', this.inst.id),
        sb().rpc('get_current_instance'),
      ])
      if (this.disposed || this.stopped) return
      let changed = false
      if(computed.data?.id===this.inst.id&&typeof computed.data.verificationHold==='boolean'&&computed.data.verificationHold!==!!this.inst.verificationHold){
        this.inst.verificationHold=computed.data.verificationHold;this.inst.verificationHoldReason=computed.data.verificationHoldReason;changed=true
      }
      const status = trip.data?.status as CommuteInstance['status'] | undefined
      if (status && status !== this.instanceStatus) {
        this.instanceStatus = status
        changed = true
        if (status === 'completed' || status === 'cancelled') this.stopSharing()
      }
      for (const n of riders.data ?? []) {
        const r = this.inst.riders.find((x) => x.passengerId === n.passenger_id)
        if (!r) continue
        const arrivedAt = n.driver_arrived_at ? new Date(n.driver_arrived_at).getTime() : null
        if (r.status === n.status && (r.driverArrivedAt ?? null) === arrivedAt) continue
        r.status = n.status
        r.driverArrivedAt = arrivedAt
        changed = true
        if (!this.isDriver && n.status !== 'expected' && n.status !== 'at_pickup') this.stopOnlyGps()
      }
      if (changed) { this.syncRider(); this.emit() }
    } catch { /* offline, or not allowed right now: the next pass tries again */ }
  }
  private async refreshAuthorization(){
    if(!this.windowOpen()){this.stopSharing();return}
    const {data,error}=await sb().rpc('can_track',{p_instance:this.inst.id})
    if(error||!data){this.stopOnlyGps();if(error)this.error='Sharing unavailable. Check your session and consent.';return}
    if(this.opts.sharingConsent)await this.startGps()
  }
  private async startGps(){
    if(!this.opts.sharingConsent||!this.windowOpen()||this.stopGps||this.gpsStarting)return
    this.gpsStarting=true
    const epoch=this.epoch
    try{
      const {data,error}=await sb().rpc('can_track',{p_instance:this.inst.id})
      if(error||!data||epoch!==this.epoch||!this.opts.sharingConsent||!this.windowOpen())return
      const stop=await watchLocation(fix=>this.onMyFix(fix),message=>{this.error=message;this.emit()},{lowData:this.opts.lowData})
      if(epoch!==this.epoch||!this.opts.sharingConsent||!this.windowOpen())stop();else this.stopGps=stop
    }catch(e){this.error=e instanceof Error?e.message:'Location unavailable';this.emit()}
    finally{this.gpsStarting=false}
  }
  private stopOnlyGps(){++this.epoch;this.stopGps?.();this.stopGps=null;this.me=null}
  private stopSharing(){this.stopOnlyGps();this.channels.forEach(ch=>void sb().removeChannel(ch));this.channels=[];this.peers.clear();this.peer=null}
  private onMyFix(fix:DeviceFix){
    if(!this.opts.sharingConsent||!this.windowOpen()) {this.stopOnlyGps();return}
    if(!this.isDriver&&!['expected','at_pickup'].includes(this.riderStatus)){this.stopOnlyGps();return}
    this.me={lat:fix.lat,lng:fix.lng,heading:fix.heading,speed:fix.speedKmh,at:fix.at}
    if(!this.linkDown&&Date.now()-this.lastBroadcast>=BROADCAST_EVERY_MS){this.lastBroadcast=Date.now();void this.rpc('publish_location',{p_instance:this.inst.id,p_lng:fix.lng,p_lat:fix.lat,p_heading:fix.heading,p_speed:fix.speedKmh}).then(ok=>{if(!ok)this.stopOnlyGps()})}
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
    return Promise.resolve(sb().rpc(fn, args))
      .then(({ error }) => {
        if (error) {
          this.error = error.message.replace(/^.*?ERROR:\s*/, '')
          this.emit()
          return false
        }
        return true
      }).catch(e=>{this.error=e instanceof Error?e.message:'Connection unavailable';this.emit();return false})
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
    if (this.isDriver && s.passengerAtPickup) once('pax-here:'+this.rider()?.passengerId, `${this.rider()?.firstName??'Your passenger'} is at the pickup point`, '')
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
    if (this.stopped || (!this.isDriver&&['absent','no_show'].includes(this.riderStatus)) || this.instanceStatus === 'completed' || this.instanceStatus === 'cancelled' || now > this.inst.sharingEndsAt)
      status = this.riderStatus === 'dropped_off' || nearDestination ? 'destination-reached' : 'ended'
    else if (now < this.inst.sharingStartsAt) status = 'sharing-soon'
    else if (collected) status = nearDestination ? 'destination-reached' : 'underway'
    else if (driverArrived && passengerAtPickup) status = 'both-at-pickup'
    else if (driverArrived) status = 'passenger-approaching'
    else status = 'driver-approaching'

    const driverLocation: DriverLocation | null = d ? { lat: d.lat, lng: d.lng, heading: d.heading ?? 0, speed: d.speed ?? 0, updatedAt: d.at } : null
    const passengerLocation: PassengerLocation | null = p ? { lat: p.lat, lng: p.lng, updatedAt: p.at } : null
    return {
      verificationHold:!!this.inst.verificationHold,
      riders:this.isDriver?this.inst.riders.map(r=>({passengerId:r.passengerId,firstName:r.firstName,status:r.status,pickupLabel:r.pickup.label,driverArrivedAt:r.driverArrivedAt??null,location:this.peers.has(r.passengerId)?{...this.peers.get(r.passengerId)!,updatedAt:this.peers.get(r.passengerId)!.at}:null})):undefined,
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
