import {useEffect,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {api,type CommuteInstance} from '@/services/api'
import {useAsync} from '@/hooks/useAsync'
import {useTracking} from '@/hooks/useTracking'
import {useDriverLegs} from '@/hooks/useClubs'
import {instanceToMatch} from '@/services/liveApi'
import {useApp} from '@/store/app'
import {MatchMap} from '@/components/match/MatchMap'
import {NavigateButton,GraceBar} from '@/components/ui/extras'
import {Banner,Card,CardSkeleton,ErrorState,LiftyButton,Screen,ScreenBody,ScreenHeader,SecondaryButton,Select,StatusBadge,TextField,Toggle,useToast} from '@/components/ui/kit'
import {shareCommute} from '@/services/share'

export function DriverControls({seatsOnly=false}:{seatsOnly?:boolean}){
 const nav=useNavigate(),toast=useToast(),{state,update}=useApp(),q=useDriverLegs()
 const [index,setIndex]=useState(0),leg=q.legs[index]
 const [seats,setSeats]=useState(''),[deviation,setDeviation]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{if(leg){setSeats(String(leg.seatsOpen+leg.members.length));setDeviation(String(leg.maxDeviationMin));setAmount(String(leg.monthlyContribution))}},[leg])
 async function save(){if(!leg)return;setBusy(true);try{await api.saveDriverSettings(leg.legId,{seats:Number(seats),maxDeviationMin:Number(deviation),monthlyContribution:Number(amount)});q.retry();toast('Driver settings published','success')}catch(e){toast(e instanceof Error?e.message:'Could not save','error')}finally{setBusy(false)}}
 async function preference(input:{location?:boolean;lowData?:boolean}){if(input.location===false)update({sharingConsent:false});try{await api.setConsent(input);if(input.location!==undefined)update({sharingConsent:input.location});if(input.lowData!==undefined)update({lowData:input.lowData})}catch(e){toast(e instanceof Error?e.message:'Could not save preference','error')}}
 return <Screen><ScreenHeader title={seatsOnly?'Seat availability':'Driver settings'} onBack={()=>nav(-1)}/><ScreenBody>
 {q.loading?<CardSkeleton/>:q.error?<ErrorState message={q.error.message} onRetry={q.retry}/>:<div className="stack-3">
  <Select label="Commute" value={String(index)} onChange={v=>setIndex(Number(v))} options={q.legs.map((l,i)=>({value:String(i),label:l.direction==='to_home'?'Evening · home':'Morning · work'}))}/>
  <TextField label="Total seats offered" inputMode="numeric" value={seats} onChange={setSeats} hint={`${leg?.members.length??0} seats already taken · vehicle limit ${state.driver.vehicle.seats}`}/>
  {!seatsOnly&&<><TextField label="Maximum detour (minutes)" inputMode="numeric" value={deviation} onChange={setDeviation}/><TextField label="Monthly contribution for new passengers (R)" inputMode="numeric" value={amount} onChange={setAmount}/><Banner tone="info">Existing passengers keep their agreed contribution. The server validates vehicle capacity and the cost-sharing cap.</Banner></>}
  <LiftyButton disabled={!leg} loading={busy} onClick={()=>void save()}>Publish settings</LiftyButton>
  {!seatsOnly&&<Card><div className="row-flex between"><span>Live location consent</span><Toggle label="Live location consent" checked={state.sharingConsent} onChange={v=>void preference({location:v})}/></div><div className="row-flex between"><span>Low-data mode</span><Toggle label="Low-data mode" checked={state.lowData} onChange={v=>void preference({lowData:v})}/></div></Card>}
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
 const r=riders.find(r=>r.passengerId===selected)
 const unresolved=riders.some(r=>r.status==='expected'||r.status==='at_pickup')
 const error=(feed as {getError?:()=>string|null}).getError?.()
 async function finish(){try{const {error}=await import('@/services/supabase').then(({sb})=>sb().rpc('complete_instance',{p_instance:instance.id}));if(error)throw new Error(error.message);feed.dispose();nav('/history',{replace:true})}catch(e){toast(e instanceof Error?e.message:'Could not finish','error')}}
 return <Screen><ScreenHeader title="Today's pickups" onBack={()=>nav(-1)}/><ScreenBody>
  {!state.sharingConsent&&<Banner tone="warning">Location sharing is off. Enable consent in driver settings to share your GPS.</Banner>}
  {error&&<Banner tone="error">{error}</Banner>}
  {s.status==='ended'&&<Banner tone="info">This sharing window has ended.</Banner>}
  <div className="stack-2" aria-label="Passenger pickups">{riders.map(p=><button key={p.passengerId} className="row" aria-pressed={selected===p.passengerId} onClick={()=>setSelected(p.passengerId)}><span className="grow"><strong>{p.firstName}</strong><span className="small muted" style={{display:'block'}}>{p.pickupLabel}</span><span className="small muted">{p.location?`Location updated ${Math.max(0,Math.round((Date.now()-p.location.updatedAt)/1000))}s ago`:'No current location'}</span></span><StatusBadge tone={p.status==='collected'?'success':'neutral'}>{p.status.replace('_',' ')}</StatusBadge></button>)}</div>
  <MatchMap geometry={{path:instance.route,deviation:[],walking:s.walkingGeometry}} pickup={s.pickup} destination={instance.destination.location} pickupLabel={r?.pickupLabel} driver={s.driverLocation} passenger={s.passengerLocation} passengerLabel={r?.firstName} height={280} focus="pickup" animate={false} stale={stale}/>
  {r&&['expected','at_pickup'].includes(r.status)&&s.status!=='ended'&&<Card><strong>{r.firstName} · {r.pickupLabel}</strong>
   {!r.driverArrivedAt?<LiftyButton onClick={()=>feed.markDriverArrived()}>Arrived at this pickup</LiftyButton>:<><GraceBar arrivedAt={r.driverArrivedAt} who="driver"/><LiftyButton onClick={()=>feed.markCollected()}>Confirm {r.firstName} collected</LiftyButton><SecondaryButton tone="danger" disabled={Date.now()-r.driverArrivedAt<180000} onClick={()=>feed.markNoShow()}>Mark no-show</SecondaryButton></>}
   <NavigateButton waypoint={s.pickup} destination={instance.destination.location}/>
  </Card>}
  <LiftyButton disabled={unresolved||s.status==='ended'||s.status==='sharing-soon'} onClick={()=>void finish()}>Finish commute</LiftyButton>
  <SecondaryButton onClick={()=>nav(`/chat/${instance.legId}`)}>Lift club chat</SecondaryButton>
  <SecondaryButton onClick={async()=>{try{const result=await shareCommute(`My Lifty commute: ${instance.driver.firstName} · ${instance.vehicle.colour} ${instance.vehicle.make} ${instance.vehicle.model} · ${instance.vehicle.registrationSummary} · to ${instance.destination.label}`);toast(result==='copied'?'Details copied':'Commute shared')}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))toast('Could not share','error')}}}>Share commute</SecondaryButton>
 </ScreenBody></Screen>
}
