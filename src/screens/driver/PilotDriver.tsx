import {useEffect,useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {api,type CommuteInstance} from '@/services/api'
import {useAsync} from '@/hooks/useAsync'
import {useTracking} from '@/hooks/useTracking'
import {useDriverLegs} from '@/hooks/useClubs'
import {instanceToMatch} from '@/services/liveApi'
import {useApp} from '@/store/app'
import {MatchMap} from '@/components/match/MatchMap'
import {NavigateButton,GraceBar} from '@/components/ui/extras'
import {Banner,BottomSheet,Card,CardSkeleton,EmptyState,ErrorState,LiftyButton,Screen,ScreenBody,ScreenHeader,SecondaryButton,Select,StatusBadge,TextField,Toggle,useToast} from '@/components/ui/kit'
import {shareCommute} from '@/services/share'
import {riderStatusLabel} from './driverJourney'
import {ensureNotificationPermission} from '@/services/notifications'

export function DriverControls({seatsOnly=false}:{seatsOnly?:boolean}){
 const nav=useNavigate(),toast=useToast(),{state,update}=useApp(),q=useDriverLegs()
 const [selectedLeg,setSelectedLeg]=useState(''),leg=q.legs.find(l=>l.legId===selectedLeg)??q.legs[0]
 const [seats,setSeats]=useState(''),[deviation,setDeviation]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false)
 const [pauseBusy,setPauseBusy]=useState(false),[saveError,setSaveError]=useState<string|null>(null)
 const settingsInFlight=useRef(false),pauseInFlight=useRef(false)
 useEffect(()=>{if(leg){setSeats(String(leg.seatsOpen+leg.members.length));setDeviation(String(leg.maxDeviationMin));setAmount(String(leg.monthlyContribution))}},[leg])
 async function save(){
  if(!leg||settingsInFlight.current)return
  const offered=Number(seats),detour=Number(deviation),contribution=Number(amount)
  if(!seats.trim()||!Number.isInteger(offered)||offered<leg.members.length||offered>state.driver.vehicle.seats){setSaveError(`Offer a whole number of seats between ${leg.members.length} and ${state.driver.vehicle.seats}.`);return}
  if(!deviation.trim()||!Number.isInteger(detour)||detour<0||detour>30){setSaveError('Choose a whole number of detour minutes between 0 and 30.');return}
  if(!amount.trim()||!Number.isInteger(contribution)||contribution<0){setSaveError('Enter a monthly contribution in whole rand, zero or more.');return}
  settingsInFlight.current=true;setBusy(true);setSaveError(null)
  try{await api.saveDriverSettings(leg.legId,{seats:offered,maxDeviationMin:detour,monthlyContribution:contribution});q.retry();toast('Driver settings published','success')}
  catch(e){setSaveError(e instanceof Error?e.message:'Could not save. Your published settings have not changed.')}
  finally{settingsInFlight.current=false;setBusy(false)}
 }
 async function pauseRequests(paused:boolean){
  if(!leg||pauseInFlight.current)return
  pauseInFlight.current=true;setPauseBusy(true);setSaveError(null)
  try{await api.setDriverRequestsPaused(leg.legId,paused);q.retry();toast(paused?'New requests paused. Existing arrangements continue.':'New requests reopened.','success')}
  catch(e){setSaveError(e instanceof Error?e.message:'Could not change request availability.')}
  finally{pauseInFlight.current=false;setPauseBusy(false)}
 }
 async function preference(input:{location?:boolean;lowData?:boolean}){if(input.location===false)update({sharingConsent:false});try{await api.setConsent(input);if(input.location!==undefined)update({sharingConsent:input.location});if(input.lowData!==undefined)update({lowData:input.lowData})}catch(e){toast(e instanceof Error?e.message:'Could not save preference','error')}}
 return <Screen><ScreenHeader title={seatsOnly?'Seat availability':'Driver settings'} onBack={()=>nav(-1)}/><ScreenBody>
 {q.loading?<CardSkeleton/>:q.error?<ErrorState message={q.error.message} onRetry={q.retry}/>:!leg?<EmptyState icon="route" title="Set up your commute first" body="Add a route and departure days before publishing driver settings." action={<LiftyButton onClick={()=>nav('/onboarding/driver/2')}>Set up commute</LiftyButton>}/>:<div className="stack-3">
  {saveError&&<Banner tone="error">{saveError}</Banner>}
  <Select label="Commute" value={leg.legId} onChange={setSelectedLeg} options={q.legs.map(l=>({value:l.legId,label:l.direction==='to_home'?'Evening · home':'Morning · work'}))}/>
  <TextField label="Total seats offered" inputMode="numeric" value={seats} onChange={setSeats} hint={`${leg?.members.length??0} seats already taken · vehicle limit ${state.driver.vehicle.seats}`}/>
  {!seatsOnly&&<><TextField label="Maximum detour (minutes)" inputMode="numeric" value={deviation} onChange={setDeviation}/><TextField label="Monthly contribution for new passengers (R)" inputMode="numeric" value={amount} onChange={setAmount}/><Banner tone="info">Existing passengers keep their agreed contribution. The server validates vehicle capacity and the cost-sharing cap.</Banner></>}
  <LiftyButton disabled={!leg||pauseBusy} loading={busy} onClick={()=>void save()}>Publish settings</LiftyButton>
  {!seatsOnly&&<Card><h2 className="h3">New lift requests</h2><p className="small muted">{leg.requestsPaused?'Paused for this leg. Existing passengers keep their arrangements.':'Open to compatible passengers. Pausing does not cancel any accepted trips.'}</p><SecondaryButton loading={pauseBusy} disabled={busy} onClick={()=>void pauseRequests(!leg.requestsPaused)}>{leg.requestsPaused?'Reopen new requests':'Pause new requests'}</SecondaryButton></Card>}
  {!seatsOnly&&<Card><div className="row-flex between"><span>Live location consent</span><Toggle label="Live location consent" checked={state.sharingConsent} onChange={v=>void preference({location:v})}/></div><div className="row-flex between"><span>Low-data mode</span><Toggle label="Low-data mode" checked={state.lowData} onChange={v=>void preference({lowData:v})}/></div></Card>}
  {!seatsOnly&&<Card><h2 className="h3">Commute notifications</h2><p className="small muted">Allow alerts on this device. Your requests and messages remain in the inbox if an alert cannot be delivered.</p><SecondaryButton onClick={async()=>{const granted=await ensureNotificationPermission();if(granted)window.dispatchEvent(new Event('lifty:enable-push'));toast(granted?'Notification permission granted on this device.':'Notifications are blocked or unavailable. Use your inbox and device settings.',granted?'success':'info')}}>Enable device notifications</SecondaryButton></Card>}
 </div>}
 </ScreenBody></Screen>
}
export function DriverLiveTrip(){
 const nav=useNavigate(),q=useAsync(()=>api.getCurrentInstance(),[])
 if(q.loading)return <Screen><ScreenHeader title="Today’s commute" onBack={()=>nav(-1)}/><ScreenBody><CardSkeleton/></ScreenBody></Screen>
 if(q.error)return <Screen><ScreenHeader title="Today’s commute" onBack={()=>nav(-1)}/><ScreenBody><ErrorState message={q.error.message} onRetry={q.retry}/></ScreenBody></Screen>
 if(!q.data)return <Screen><ScreenHeader title="Today's commute" onBack={()=>nav(-1)}/><ScreenBody><Banner tone="info">No active commute. Upcoming trips appear in your history.</Banner></ScreenBody></Screen>
 return <DriverTripBody key={q.data.id} instance={q.data}/>
}
function DriverTripBody({instance}:{instance:CommuteInstance}){
 const nav=useNavigate(),toast=useToast(),{state}=useApp()
 const match=instanceToMatch(instance,state.user?.id)
 const {snapshot:s,feed,stale}=useTracking(match,{lowData:state.lowData})
 const riders=s.riders??[]
 const [selected,setSelected]=useState(instance.riders.find(r=>r.status==='expected'||r.status==='at_pickup')?.passengerId??instance.riders[0]?.passengerId??'')
 useEffect(()=>{feed.selectRider?.(selected)},[feed,selected])
 const [pending,setPending]=useState<Record<string,string>>({}),[actionErrors,setActionErrors]=useState<Record<string,string>>({})
 const inFlight=useRef(new Set<string>())
 const [finishing,setFinishing]=useState(false),finishingRef=useRef(false)
 const [noShowId,setNoShowId]=useState<string|null>(null)
 const r=riders.find(r=>r.passengerId===selected)
 const pickup=instance.riders.find(p=>p.passengerId===selected)?.pickup.location??s.pickup
 const unresolved=riders.some(r=>r.status==='expected'||r.status==='at_pickup')
 const held=s.verificationHold??!!instance.verificationHold
 const canFinishHeld=held&&riders.some(r=>r.status==='collected')
 const outsideWindow=s.status==='ended'||s.status==='sharing-soon'||s.status==='destination-reached'||held
 const error=(feed as {getError?:()=>string|null}).getError?.()
 async function riderAction(passengerId:string,action:'arrive'|'collect'|'no-show'){
  if(inFlight.current.has(passengerId)||finishingRef.current)return
  inFlight.current.add(passengerId);setPending(p=>({...p,[passengerId]:action}));setActionErrors(p=>({...p,[passengerId]:''}))
  try{
   if(action==='arrive')await feed.markDriverArrived(passengerId)
   else if(action==='collect')await feed.markCollected(passengerId)
   else await feed.markNoShow(passengerId)
  }catch(e){setActionErrors(p=>({...p,[passengerId]:e instanceof Error?e.message:'Could not save this passenger update. Retry when connected.'}))}
  finally{inFlight.current.delete(passengerId);setPending(p=>{const next={...p};delete next[passengerId];return next});setNoShowId(null)}
 }
 async function finish(){
  if(finishingRef.current||inFlight.current.size)return
  finishingRef.current=true;setFinishing(true)
  try{if(await feed.endSharing()===false)throw new Error((feed as {getError?:()=>string|null}).getError?.()??'Could not finish. Retry when connected.');feed.dispose();nav('/history',{replace:true})}
  catch(e){toast(e instanceof Error?e.message:'Could not finish','error')}
  finally{finishingRef.current=false;setFinishing(false)}
 }
 return <Screen><ScreenHeader title="Today's pickups" onBack={()=>nav(-1)}/><ScreenBody>
  {held&&<Banner tone="warning">Driver approval requires review. New pickups are on hold; your club has been notified. You can finish a trip for passengers already collected.</Banner>}
  {!state.sharingConsent&&<Banner tone="warning">Location sharing is off. Your agreed pickup points and club chat still work. Enable consent in driver settings to share your GPS.</Banner>}
  {error&&<Banner tone="error">{error}</Banner>}
  {s.status==='ended'&&<Banner tone="info">This sharing window has ended.</Banner>}
  <p className="small muted">Use pickup controls while safely parked. Select a passenger to see their own pickup and status.</p>
  <div className="stack-2" aria-label="Passenger pickups">{riders.map(p=><button key={p.passengerId} type="button" className="row" aria-pressed={selected===p.passengerId} onClick={()=>{feed.selectRider?.(p.passengerId);setSelected(p.passengerId)}}><span className="grow"><strong>{p.firstName}</strong><span className="small muted" style={{display:'block'}}>{p.pickupLabel}</span><span className="small muted">{pending[p.passengerId]?'Saving pickup update…':p.location?`Location updated ${Math.max(0,Math.round((Date.now()-p.location.updatedAt)/1000))}s ago`:'No current location · use the agreed pickup'}</span>{actionErrors[p.passengerId]&&<span className="field-error" role="alert">{actionErrors[p.passengerId]}</span>}</span><StatusBadge tone={p.status==='collected'?'success':'neutral'}>{riderStatusLabel(p.status)}</StatusBadge></button>)}</div>
  <MatchMap geometry={{path:instance.route,deviation:[],walking:s.walkingGeometry}} pickup={pickup} destination={instance.destination.location} pickupLabel={r?.pickupLabel} driver={s.driverLocation} passenger={s.passengerLocation} passengerLabel={r?.firstName} height={280} focus="pickup" animate={false} stale={stale}/>
  {r&&['expected','at_pickup'].includes(r.status)&&s.status!=='ended'&&<Card><strong>{r.firstName} · {r.pickupLabel}</strong>
   {!r.driverArrivedAt?<LiftyButton disabled={outsideWindow||!!pending[selected]||finishing} loading={pending[selected]==='arrive'} onClick={()=>void riderAction(selected,'arrive')}>Arrived at this pickup</LiftyButton>:<><GraceBar arrivedAt={r.driverArrivedAt} who="driver"/><LiftyButton disabled={outsideWindow||!!pending[selected]||finishing} loading={pending[selected]==='collect'} onClick={()=>void riderAction(selected,'collect')}>Confirm {r.firstName} collected</LiftyButton><SecondaryButton tone="danger" disabled={outsideWindow||!!pending[selected]||finishing||Date.now()-r.driverArrivedAt<180000} loading={pending[selected]==='no-show'} onClick={()=>setNoShowId(selected)}>Mark no-show</SecondaryButton></>}
   <NavigateButton destination={pickup} label={`Navigate to ${r.firstName}'s pickup`}/>
  </Card>}
  {!unresolved&&s.status!=='ended'&&<NavigateButton destination={instance.destination.location} label="Navigate to destination"/>}
  <LiftyButton loading={finishing} disabled={(unresolved&&!canFinishHeld)||Object.keys(pending).length>0||s.status==='ended'||s.status==='sharing-soon'} onClick={()=>void finish()}>Finish commute</LiftyButton>
  <SecondaryButton onClick={()=>nav(`/chat/${instance.legId}`)}>Lift club chat</SecondaryButton>
  <SecondaryButton onClick={async()=>{try{const result=await shareCommute(`My Lifty commute: ${instance.driver.firstName} · ${instance.vehicle.colour} ${instance.vehicle.make} ${instance.vehicle.model} · ${instance.vehicle.registrationSummary} · to ${instance.destination.label}. These are commute details, not a live location link.`);toast(result==='copied'?'Details copied':'Commute details shared')}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))toast('Could not share','error')}}}>Share commute details</SecondaryButton>
  <p className="small muted">Shares driver, vehicle and destination details. Live location is available only to authorised trip participants.</p>
 </ScreenBody><BottomSheet open={!!noShowId} onClose={()=>setNoShowId(null)} title="Confirm passenger no-show"><div className="stack-3"><p>Mark {riders.find(p=>p.passengerId===noShowId)?.firstName} as a no-show for this departure? Their other arrangements remain unchanged.</p><LiftyButton disabled={!noShowId||!!pending[noShowId]||outsideWindow} onClick={()=>{if(noShowId)void riderAction(noShowId,'no-show')}}>Confirm no-show</LiftyButton><SecondaryButton onClick={()=>setNoShowId(null)}>Keep waiting</SecondaryButton></div></BottomSheet></Screen>
}
