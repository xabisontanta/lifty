import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {CommuteInstance} from '@/services/api'
const harness=vi.hoisted(()=>({channels:[] as any[],rpc:vi.fn(),watch:vi.fn(),stop:vi.fn(),remove:vi.fn(),fix:null as any,from:vi.fn(),riderRows:[] as any[],tripRow:null as any}))
vi.mock('@/services/supabase',()=>({sb:()=>({rpc:harness.rpc,from:harness.from,realtime:{setAuth:vi.fn().mockResolvedValue(undefined)},channel:(name:string)=>{
 const ch={name,handlers:[] as any[],on:vi.fn(function(this:any,kind:string,filter:any,cb:any){this.handlers.push({kind,filter,cb});return this}),subscribe:vi.fn(function(this:any,cb:any){cb?.('SUBSCRIBED');return this})}
 harness.channels.push(ch);return ch
},removeChannel:harness.remove})}))
vi.mock('@/services/location',()=>({watchLocation:harness.watch}))
vi.mock('@/services/mapbox',()=>({liveEtaMinutes:vi.fn().mockResolvedValue({minutes:4,distanceM:100})}))
vi.mock('@/services/notifications',()=>({notifyLocal:vi.fn()}))
vi.mock('@/services/monitoring',()=>({reportError:vi.fn()}))
import {SupabaseTrackingFeed} from '@/services/supabaseTracking'
const place={label:'Pickup',area:'',location:{lat:-29.55,lng:31.14}}
function instance(driver=true):CommuteInstance{return {
 id:'trip',legId:'leg',direction:'to_work',status:'scheduled',isDriver:driver,departsAt:Date.now()+10000,sharingStartsAt:Date.now()-1000,sharingEndsAt:Date.now()+60000,driverArrivedAt:null,route:[place.location,{lat:-29.72,lng:31.07}],routeDurationS:1800,destination:place,
 riders:['p1','p2'].map(id=>({passengerId:id,firstName:id,lastInitial:'Q',avatarHue:0,status:'expected',pickup:place,pickupTime:'06:30'})),
 driver:{id:'driver',firstName:'Driver',lastInitial:'Q',rating:0,ratingCount:0,avatarHue:0,verification:{identity:'pending',licence:'pending',vehicle:'pending',insurance:'pending'}},
 vehicle:{make:'Test',model:'Car',colour:'White',bodyType:'sedan',registrationSummary:'QA'}
}}
const feeds:SupabaseTrackingFeed[]=[]
function feed(inst=instance(),consent=true){const f=new SupabaseTrackingFeed(inst,inst.isDriver?'driver':'p1',{sharingConsent:consent});feeds.push(f);return f}
async function settle(){for(let n=0;n<12;n++)await Promise.resolve()}
function broadcast(passenger:string,payload:any){harness.channels.find(ch=>ch.name==='commute:trip:'+passenger)?.handlers.find((h:any)=>h.kind==='broadcast')?.cb({payload})}
function row(table:string,data:any){harness.channels.find(ch=>ch.name==='instance:trip')?.handlers.find((h:any)=>h.filter.table===table)?.cb({new:data})}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));harness.channels=[];harness.rpc.mockReset().mockResolvedValue({data:true,error:null});harness.stop.mockReset();harness.remove.mockReset();harness.watch.mockReset().mockImplementation(async(cb:any)=>{harness.fix=cb;return harness.stop});harness.riderRows=[];harness.tripRow=null;harness.from.mockReset().mockImplementation((table:string)=>({select:()=>({eq:()=>table==='instance_riders'?Promise.resolve({data:harness.riderRows,error:null}):{maybeSingle:()=>Promise.resolve({data:harness.tripRow,error:null})}})}))})
afterEach(()=>{feeds.splice(0).forEach(f=>f.dispose());vi.useRealTimers()})
describe('live tracking lifecycle',()=>{
 it('never starts GPS without consent',async()=>{feed(instance(),false);await settle();expect(harness.watch).not.toHaveBeenCalled()})
 it('waits for the sharing window',async()=>{const i=instance();i.sharingStartsAt=Date.now()+10000;feed(i);await settle();expect(harness.watch).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10000);expect(harness.watch).toHaveBeenCalledOnce()})
 it('requires server permission before GPS',async()=>{harness.rpc.mockResolvedValue({data:false,error:null});feed();await settle();expect(harness.watch).not.toHaveBeenCalled()})
 it('stops immediately when consent is withdrawn',async()=>{const f=feed();await settle();f.setConsent(false);expect(harness.stop).toHaveBeenCalledOnce();harness.fix({lat:-29.5,lng:31.1,at:Date.now()});expect(harness.rpc.mock.calls.some(c=>c[0]==='publish_location')).toBe(false)})
 it('stops a watcher that resolves after disposal and leaves no timers',async()=>{let resolve!:(stop:()=>void)=>void;harness.watch.mockImplementation(()=>new Promise(r=>{resolve=r}));const f=feed();await settle();f.dispose();resolve(harness.stop);await settle();expect(harness.stop).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)})
 it('stops at expiry and removes location channels',async()=>{const i=instance();i.sharingEndsAt=Date.now()+1000;const f=feed(i);await settle();await vi.advanceTimersByTimeAsync(2000);expect(harness.stop).toHaveBeenCalledOnce();expect(f.getSnapshot().driverLocation).toBeNull();expect(f.getSnapshot().status).toBe('ended')})
 it('stops on server completion',async()=>{const f=feed();await settle();row('commute_instances',{status:'completed'});expect(harness.stop).toHaveBeenCalledOnce();expect(f.getSnapshot().status).toBe('ended')})
 it('stops passenger GPS after collection while receiving the driver',async()=>{const f=feed(instance(false));await settle();row('instance_riders',{passenger_id:'p1',status:'collected',driver_arrived_at:null});expect(harness.stop).toHaveBeenCalledOnce();broadcast('p1',{from:'driver',lat:-29.7,lng:31.1,at:Date.now()});expect(f.getSnapshot().driverLocation?.lat).toBe(-29.7)})
 it('keeps riders separate and rejects a mismatched sender',async()=>{const f=feed();await settle();broadcast('p1',{from:'p1',lat:-29.51,lng:31.1,at:Date.now()});broadcast('p2',{from:'p2',lat:-29.52,lng:31.2,at:Date.now()});broadcast('p1',{from:'p2',lat:99,lng:99,at:Date.now()});expect(f.getSnapshot().passengerLocation?.lat).toBe(-29.51);f.selectRider('p2');expect(f.getSnapshot().passengerLocation?.lat).toBe(-29.52);expect(f.getSnapshot().riders?.map(r=>r.location?.lat)).toEqual([-29.51,-29.52])})
 it('a failed status transition does not change the rider',async()=>{const f=feed();await settle();harness.rpc.mockResolvedValue({data:null,error:{message:'Only the driver'}});f.markCollected();await settle();expect(f.getSnapshot().collected).toBe(false);expect(f.getError()).toBe('Only the driver')})
 it('failed sharing withdrawal remains reviewable and returns false',async()=>{const f=feed(instance(false));await settle();harness.rpc.mockResolvedValue({data:null,error:{message:'Connection lost'}});expect(await f.endSharing()).toBe(false);expect(harness.stop).not.toHaveBeenCalled()})
 it('only sends fixes through the server RPC',async()=>{feed();await settle();harness.fix({lat:-29.51,lng:31.1,heading:0,speedKmh:5,accuracyM:3,at:Date.now()});await settle();expect(harness.rpc).toHaveBeenCalledWith('publish_location',expect.objectContaining({p_instance:'trip',p_lat:-29.51}));expect(harness.channels.every(c=>!('send' in c))).toBe(true)})
})

describe('catching up on live updates that were missed',()=>{
 it('picks up a change that landed before the live channel was ready',async()=>{
  harness.riderRows=[{passenger_id:'p1',status:'collected',driver_arrived_at:new Date().toISOString()}]
  const f=feed(instance(false));await settle()
  expect(f.getSnapshot().status).toBe('underway')
 })
 it('keeps re-reading, so a dropped update cannot leave the screen on an old state',async()=>{
  const f=feed(instance(false));await settle()
  expect(f.getSnapshot().status).not.toBe('underway')
  harness.riderRows=[{passenger_id:'p1',status:'collected',driver_arrived_at:new Date().toISOString()}]
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.getSnapshot().status).toBe('underway')
 })
 it('learns that the trip finished even if that event was missed',async()=>{
  const f=feed(instance(false));await settle()
  harness.tripRow={status:'completed'}
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.getSnapshot().status).toBe('ended')
 })
 it('does nothing once the feed is disposed, and a failed read changes nothing',async()=>{
  const f=feed(instance(false));await settle()
  harness.from.mockImplementation(()=>{throw new Error('offline')})
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.getSnapshot().status).not.toBe('ended')
  f.dispose();expect(vi.getTimerCount()).toBe(0)
 })
})

describe('rebuilding the live location channels',()=>{
 const locationChannels=()=>harness.channels.filter(ch=>ch.name.startsWith('commute:trip:'))
 it('Retry drops the old live channels and subscribes again',async()=>{
  const f=feed(instance(false));await settle()
  const [old]=locationChannels();expect(old).toBeDefined()
  f.restart();await settle()
  expect(harness.remove).toHaveBeenCalledWith(old)
  expect(locationChannels().length).toBe(2)
 })
 it('a rider whose driver channel goes silent rebuilds it by itself, then waits before trying again',async()=>{
  feed(instance(false));await settle()
  expect(locationChannels().length).toBe(1)
  await vi.advanceTimersByTimeAsync(29_000);expect(locationChannels().length).toBe(1)
  await vi.advanceTimersByTimeAsync(3_000);await settle();expect(locationChannels().length).toBe(2)
  await vi.advanceTimersByTimeAsync(20_000);expect(locationChannels().length).toBe(2)
 })
 it('a position that keeps arriving keeps the channel as it is',async()=>{
  feed(instance(false));await settle()
  for(let n=0;n<5;n++){await vi.advanceTimersByTimeAsync(10_000);broadcast('p1',{from:'driver',lat:-29.5,lng:31.1,at:Date.now()})}
  expect(locationChannels().length).toBe(1)
 })
 it('a driver does not rebuild for riders who are quiet',async()=>{
  feed(instance(true));await settle();const before=locationChannels().length
  await vi.advanceTimersByTimeAsync(55_000);expect(locationChannels().length).toBe(before)
 })
})
