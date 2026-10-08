import {readFileSync,writeFileSync} from 'node:fs'
const edit=(p,f)=>writeFileSync(p,f(readFileSync(p,'utf8')))
edit('src/services/tracking.ts',s=>s.replace('  markDriverArrived(): void','  selectRider?(passengerId: string): void\n  setConsent?(consent: boolean): void\n  markDriverArrived(): void').replace('opts: { lowData?: boolean } = {}','opts: { lowData?: boolean; sharingConsent?: boolean } = {}').replace('`live:${match.liveInstance.id}`','`live:${currentUserId}:${match.liveInstance.id}`').replace('  return f\n}', '  f.setConsent?.(opts.sharingConsent ?? false)\n  return f\n}').replace('  for (const k of [key, `live:${key}`]) {','  for (const k of [...feeds.keys()].filter(k=>k===key||k.endsWith(`:${key}`))) {')+`\nexport function disposeTrackingFeeds() { feeds.forEach(f=>f.dispose()); feeds.clear() }\n`)
edit('src/domain/types.ts',s=>s.replace('export interface TrackingSnapshot {','export interface TrackingSnapshot {\n  riders?: { passengerId: string; firstName: string; status: string; pickupLabel: string; driverArrivedAt: number | null; location: PassengerLocation | null }[]'))
edit('src/hooks/useTracking.ts',s=>s.replace("import { useOnline } from './useAsync'","import { useOnline } from './useAsync'\nimport { useApp } from '@/store/app'").replace('  // eslint-disable-next-line','  const {state}=useApp()\n  // eslint-disable-next-line').replace('getTrackingFeed(match, opts), [match]','getTrackingFeed(match, {...opts,sharingConsent:state.sharingConsent}), [match.id, (match as Match & {liveInstance?:{id:string}}).liveInstance?.id]').replace('  const [lastUpdate, setLastUpdate] = useState<number | null>(Date.now())','  const [lastUpdate, setLastUpdate] = useState<number | null>(null)').replace('      setLastUpdate(s.driverLocation?.updatedAt ?? Date.now())',"      const driver=(match as Match & {liveInstance?:{isDriver:boolean}}).liveInstance?.isDriver\n      setLastUpdate((driver?s.passengerLocation?.updatedAt:s.driverLocation?.updatedAt)??null)").replace('  useEffect(() => {\n    const t = setInterval', '  useEffect(()=>{feed.setConsent?.(state.sharingConsent)},[feed,state.sharingConsent])\n\n  useEffect(() => {\n    const t = setInterval'))
edit('src/services/supabaseTracking.ts',s=>{
 s=s.replace("const BREADCRUMB_EVERY_MS = 30000\n",'').replace('  private channel: RealtimeChannel | null = null','  private channels: RealtimeChannel[] = []\n  private disposed=false\n  private stopped=false\n  private epoch=0\n  private selectedRiderId: string | null=null\n  private peers=new Map<string,PeerFix>()\n  private gpsStarting=false').replace('  private lastCrumb = 0\n','').replace('private opts: { lowData?: boolean } = {}','private opts: { lowData?: boolean; sharingConsent?: boolean } = {}')
 s=s.replace('    const rider = this.rider()',"    this.selectedRiderId=inst.riders.find(r=>r.status==='expected'||r.status==='at_pickup')?.passengerId??inst.riders[0]?.passengerId??null\n    const rider = this.rider()",1).replace('    this.driverArrivedAt = inst.driverArrivedAt','    this.driverArrivedAt = rider?.driverArrivedAt ?? null')
 s=s.replace("this.inst.riders.find((r) => r.status !== 'absent') ?? this.inst.riders[0]",'this.inst.riders.find(r=>r.passengerId===this.selectedRiderId)')
 const start=s.indexOf('  // ---------- explicit actions ----------'),end=s.indexOf('  // ---------- lifecycle ----------',start)
 s=s.slice(0,start)+`  selectRider(passengerId: string) {
    if(!this.isDriver || !this.inst.riders.some(r=>r.passengerId===passengerId)) return
    this.selectedRiderId=passengerId;this.syncRider();this.emit();void this.refreshEtas()
  }
  private syncRider(){ const r=this.rider();this.riderStatus=r?.status??'absent';this.driverArrivedAt=r?.driverArrivedAt??null;this.peer=this.isDriver?(this.peers.get(r?.passengerId??'')??null):(this.peers.get(this.inst.driver.id)??null) }
  setConsent(consent:boolean){this.opts.sharingConsent=consent;if(!consent)this.stopOnlyGps();else if(this.channels.length)void this.startGps()}
  markDriverArrived(){const r=this.rider();if(r)void this.action('mark_driver_arrived',{p_instance:this.inst.id,p_passenger:r.passengerId},()=>{r.driverArrivedAt=Date.now();this.syncRider()})}
  markPassengerAtPickup(){this.changeRider('at_pickup')}
  markCollected(){this.changeRider('collected')}
  markNoShow(){this.changeRider('no_show')}
  private changeRider(status:string){const r=this.rider();if(!r)return;void this.action('mark_rider_status',{p_instance:this.inst.id,p_passenger:r.passengerId,p_status:status},()=>{r.status=status;this.syncRider();if(!this.isDriver&&status==='collected')this.stopOnlyGps()})}
  private async action(name:string,args:Record<string,unknown>,done:()=>void){if(await this.rpc(name,args)){done();this.emit()}}
  endSharing(){void this.action(this.isDriver?'complete_instance':'stop_my_sharing',{p_instance:this.inst.id},()=>{this.stopped=true;if(this.isDriver)this.instanceStatus='completed';this.stopSharing()})}
  setLinkDown(down:boolean){this.linkDown=down}
  restart(){if(!this.disposed&&!this.stopped) {this.error=null;void this.refreshAuthorization();this.emit()}}
  dispose(){this.disposed=true;this.stopSharing();this.timers.forEach(clearInterval);this.timers=[];if(this.windowTimer)clearTimeout(this.windowTimer);if(this.rowChannel)void sb().removeChannel(this.rowChannel);this.listeners.clear()}

`+s.slice(end)
 s=s.replace('        this.driverArrivedAt = n.driver_arrived_at ? new Date(n.driver_arrived_at).getTime() : null','        if(n.status===\'completed\'||n.status===\'cancelled\')this.stopSharing()')
 const rstart=s.indexOf('        const n = p.new as { passenger_id:'),rend=s.indexOf('\n      })',rstart)
 s=s.slice(0,rstart)+`        const n=p.new as {passenger_id:string;status:string;driver_arrived_at:string|null}
        const r=this.inst.riders.find(r=>r.passengerId===n.passenger_id)
        if(r){r.status=n.status;r.driverArrivedAt=n.driver_arrived_at?new Date(n.driver_arrived_at).getTime():null;this.syncRider();if(!this.isDriver&&n.status!=='expected'&&n.status!=='at_pickup')this.stopOnlyGps();this.emit()}`+s.slice(rend)
 s=s.replace('    this.timers.push(setInterval(() => this.emit(), 1000))','    this.timers.push(setInterval(() => {if(Date.now()>this.inst.sharingEndsAt)this.stopSharing();this.emit()},1000))\n    this.timers.push(setInterval(()=>void this.refreshAuthorization(),5000))')
 const sharestart=s.indexOf('  private async startSharing()'),shareend=s.indexOf('  private driverPos()',sharestart)
 s=s.slice(0,sharestart)+`  private windowOpen(){return !this.disposed&&!this.stopped&&Date.now()>=this.inst.sharingStartsAt&&Date.now()<=this.inst.sharingEndsAt&&!['completed','cancelled'].includes(this.instanceStatus)}
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
          this.peers.set(expected,payload);this.syncRider();this.emit()
        }).subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')this.error='Reconnecting live location…';else if(status==='SUBSCRIBED')this.error=null;this.emit()})
        this.channels.push(ch)
      }
      await this.startGps();void this.refreshEtas()
    }catch(e){reportError(e,{where:'startSharing'});this.error='Could not connect live location';this.emit()}
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

`+s.slice(shareend)
 s=s.replace('          throw error','          return false').replace('          this.emit()\n          return false\n        }\n      })','          this.emit()\n          return false\n        }\n        return true\n      }).catch(e=>{this.error=e instanceof Error?e.message:\'Connection unavailable\';this.emit();return false})')
 s=s.replace("    if (this.instanceStatus === 'completed'", "    if (this.stopped || this.riderStatus==='absent' || this.instanceStatus === 'completed'")
 s=s.replace('    return {\n      status,','    return {\n      riders:this.isDriver?this.inst.riders.map(r=>({passengerId:r.passengerId,firstName:r.firstName,status:r.status,pickupLabel:r.pickup.label,driverArrivedAt:r.driverArrivedAt??null,location:this.peers.has(r.passengerId)?{...this.peers.get(r.passengerId)!,updatedAt:this.peers.get(r.passengerId)!.at}:null})):undefined,\n      status,')
 return s
})
