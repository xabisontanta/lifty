import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useAsync} from '@/hooks/useAsync'
import {api} from '@/services/api'
import {useApp} from '@/store/app'
import {rand,isoDate} from '@/lib/format'
import type {ExceptionKind,Place} from '@/domain/types'
import {AddressField} from '@/components/ui/extras'
import {MapPicker} from '@/components/map/MapPicker'
import {Banner,Card,CardSkeleton,EmptyState,ErrorState,LiftyButton,Screen,ScreenBody,ScreenHeader,SecondaryButton,StatusBadge,TextField,Select,useToast} from '@/components/ui/kit'

export function ContributionLedger(){
 const nav=useNavigate(),toast=useToast(),{state}=useApp()
 const driver=state.role==='driver'
 const q=useAsync(()=>api.listContributions(),[state.user?.id])
 const [busy,setBusy]=useState<string|null>(null)
 const [note,setNote]=useState('')
 async function act(id:string){setBusy(id);try{if(driver)await api.confirmContribution(id);else await api.reportContribution(id,note);q.retry();toast(driver?'Receipt confirmed':'Payment reported — awaiting driver confirmation','success')}catch(e){toast(e instanceof Error?e.message:'Could not save','error')}finally{setBusy(null)}}
 return <Screen><ScreenHeader title="Contribution ledger" onBack={()=>nav(-1)}/><ScreenBody>
  <Banner tone="info">Pay your driver directly by EFT or cash. The passenger reports payment and the driver confirms receipt.</Banner>
  {!driver&&<TextField label="Payment reference (optional)" value={note} onChange={setNote}/>}
  {q.loading?<CardSkeleton/>:q.error?<ErrorState message={q.error.message} onRetry={q.retry}/>:!q.data?.length?<EmptyState icon="wallet" title="No contributions yet" body="Applicable periods appear after a driver accepts your arrangement."/>:q.data.map(c=><Card key={c.id} style={{marginTop:12}}>
   <div className="row-flex between"><strong>{rand(c.amount)}</strong><StatusBadge tone={c.status==='confirmed'?'success':'warning'}>{c.status==='confirmed'?'Receipt confirmed':c.status==='reported'?'Awaiting confirmation':'Due'}</StatusBadge></div>
   <p className="small muted">{c.period.slice(0,7)}{driver?` · ${c.passengerName}`:''}</p>
   {c.note&&<p className="small">Reference: {c.note}</p>}
   {((driver&&c.status==='reported')||(!driver&&c.status==='due'))&&<LiftyButton loading={busy===c.id} onClick={()=>void act(c.id)}>{driver?'Confirm receipt':'I have paid'}</LiftyButton>}
  </Card>)}
 </ScreenBody></Screen>
}
export function CommuteHistory(){
 const nav=useNavigate(),{state}=useApp()
 const q=useAsync(()=>api.listHistory(),[state.user?.id])
 return <Screen><ScreenHeader title="Commute history" onBack={()=>nav(-1)}/><ScreenBody>
 {q.loading?<CardSkeleton/>:q.error?<ErrorState message={q.error.message} onRetry={q.retry}/>:!q.data?.length?<EmptyState icon="calendar" title="No trips yet" body="Your upcoming, completed, cancelled and missed trips appear here."/>:q.data.map(h=><Card key={h.id} style={{marginBottom:12}}>
  <div className="row-flex between"><strong>{h.date} · {h.direction==='to_home'?'Evening':'Morning'}</strong><StatusBadge>{h.status}</StatusBadge></div>
  <p>{h.pickupLabel} → {h.destinationLabel}</p><p className="small muted">{h.driverName} · {new Date(h.departsAt).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}</p>
  {h.canRate&&!h.rated&&<SecondaryButton onClick={()=>nav(`/p/rate?instance=${h.id}`)}>Rate this commute</SecondaryButton>}
 </Card>)}
 </ScreenBody></Screen>
}

export function ScheduleExceptions(){
 const nav=useNavigate(),toast=useToast(),{state,addException,removeException}=useApp()
 const clubs=useAsync(()=>api.getMyClubs(),[state.user?.id])
 const changes=useAsync(()=>api.listPickupChanges(),[state.user?.id])
 const driver=state.role==='driver'
 const [legId,setLegId]=useState('')
 const [date,setDate]=useState(isoDate(1))
 const [kind,setKind]=useState<ExceptionKind>('absent')
 const [note,setNote]=useState('')
 const [pickup,setPickup]=useState<Place|null>(null)
 const [pickupText,setPickupText]=useState('')
 const [map,setMap]=useState(false)
 const [busy,setBusy]=useState(false)
 const options=[{value:'',label:'All my arrangements'},...(driver?clubs.data?.asDriver??[]:clubs.data?.asPassenger??[]).map(c=>({value:'legId' in c?c.legId:c.matchId,label:c.direction==='to_home'?'Evening · home':'Morning · to work'}))]
 async function save(){setBusy(true);try{await addException({kind,date:kind==='pause'?'ongoing':date,note:note||undefined,legId:legId||undefined});toast('Availability saved and members notified','success')}catch(e){toast(e instanceof Error?e.message:'Could not save','error')}finally{setBusy(false)}}
 async function undo(id:string){try{await removeException(id);clubs.retry();toast('Exception undone on the server','success')}catch(e){toast(e instanceof Error?e.message:'Could not undo','error')}}
 return <Screen><ScreenHeader title="Schedules & exceptions" onBack={()=>nav(-1)}/><ScreenBody>
  <Banner tone="info">Changes apply after they are saved. Temporary pickup changes need the driver's approval.</Banner>
  {clubs.error&&<ErrorState message={clubs.error.message} onRetry={clubs.retry}/>}
  <div className="stack-3"><Select label="Arrangement" value={legId} onChange={setLegId} options={options}/>
   <Select label="Availability" value={kind} onChange={v=>setKind(v as ExceptionKind)} options={[{value:driver?'unavailable':'absent',label:'Not commuting'},{value:'wfh',label:'Working from home'},{value:'leave',label:'Leave'},{value:'holiday',label:'Holiday'},{value:'pause',label:'Pause until resumed'}]}/>
   {kind!=='pause'&&<TextField label="Date" type="date" value={date} onChange={setDate}/>}
   <TextField label="Note (optional)" value={note} onChange={setNote}/><LiftyButton loading={busy} onClick={()=>void save()}>Save availability</LiftyButton>
  </div>
  <h2 className="h3" style={{marginTop:20}}>Saved exceptions</h2>
  {state.exceptions.map(e=><Card key={e.id}><div className="row-flex between"><span>{e.kind==='pause'?'Paused until resumed':e.kind} · {e.date}</span><SecondaryButton size="sm" onClick={()=>void undo(e.id)}>{e.kind==='pause'?'Resume':'Undo'}</SecondaryButton></div>{e.note&&<p className="small muted">{e.note}</p>}</Card>)}
  {!driver&&<Card style={{marginTop:16}}><h2 className="h3">Temporary pickup</h2><p className="small muted">Select an arrangement and a dated point. Your agreed pickup stays in use until approved.</p>
   <AddressField label="Proposed pickup" value={pickupText} onSelect={p=>{setPickup(p);setPickupText(p.label)}} onText={v=>{setPickupText(v);setPickup(null)}}/>
   <SecondaryButton onClick={()=>setMap(true)}>Choose on map</SecondaryButton>
   <LiftyButton disabled={!legId||!pickup} onClick={async()=>{if(!pickup)return;try{await api.requestPickupChange({legId,date,pickup});changes.retry();toast('Pickup sent for driver approval','success')}catch(e){toast(e instanceof Error?e.message:'Could not request','error')}}}>Request change for {date}</LiftyButton>
  </Card>}
  {changes.error&&<ErrorState message={changes.error.message} onRetry={changes.retry}/>}
  {(changes.data??[]).map(c=><Card key={c.id} style={{marginTop:12}}><strong>{c.passengerName} · {c.date}</strong><p>{c.pickup.label}</p><StatusBadge>{c.status}</StatusBadge>
   {driver&&c.status==='pending'&&<div className="row-flex">{[true,false].map(approve=><SecondaryButton key={String(approve)} onClick={async()=>{try{await api.reviewPickupChange(c.id,approve);changes.retry();toast(approve?'Pickup approved':'Pickup declined')}catch(e){toast(e instanceof Error?e.message:'Could not review','error')}}}>{approve?'Approve':'Decline'}</SecondaryButton>)}</div>}
  </Card>)}
  {map&&<MapPicker title="Temporary pickup" start={pickup?.location??state.plan.origin.location} onClose={()=>setMap(false)} onPick={p=>{setPickup(p);setPickupText(p.label);setMap(false)}}/>}
 </ScreenBody></Screen>
}
