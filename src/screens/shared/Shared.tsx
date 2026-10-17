import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { PaymentBadge } from '@/components/match/cards'
import { Icon, type IconName } from '@/components/ui/Icon'
import {
  Banner, BottomSheet, Card, CardSkeleton, EmptyState, ErrorState, LiftyButton, Modal, ProfileRow, Screen, ScreenBody, ScreenHeader, SecondaryButton, SectionTitle,
  StatusBadge, TextButton, Toggle, useToast, TextField, Select,
} from '@/components/ui/kit'
import { PAYMENT_METHODS } from '@/data/mock'
import type { ExceptionKind } from '@/domain/types'
import { isoDate, rand, timeAgo } from '@/lib/format'
import { useAsync } from '@/hooks/useAsync'
import { api, type ChatMessage, type PendingDocument, type SafetyReport } from '@/services/api'
import {mergeMessages,outgoingMessage,unconfirmedMessages,type OutgoingMessage} from '@/lib/chat'
import {exportArchive} from '@/services/dataExport'
import { useApp } from '@/store/app'

/* ---------- 18 Payment methods & contributions (tracked in v1) ---------- */
export function Payments() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update } = useApp()
  const [add, setAdd] = useState(false)
  const club = state.club
  const icons: Record<string, IconName> = { card: 'card', eft: 'bank', mobile: 'phone' }
  return (
    <Screen>
      <ScreenHeader title="Payment Method" onBack={() => nav(-1)} />
      <ScreenBody>
        <p className="muted" style={{ marginBottom: 12 }}>Choose how you want to pay your monthly contribution.</p>
        {club ? (
          <Card className="navy">
            <p className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Monthly contribution</p>
            <p className="price-lg">{rand(club.monthlyContribution)}</p>
            <div className="row-flex between" style={{ marginTop: 8 }}>
              <span style={{ color: 'rgba(255,255,255,.75)' }}>Next contribution · {club.nextContributionDate}</span>
              <PaymentBadge status={club.paymentStatus} />
            </div>
          </Card>
        ) : (
          <Banner tone="info" icon="info">Your monthly contribution appears here once you join a lift club.</Banner>
        )}
        <SectionTitle>Pay with</SectionTitle>
        <div className="list" role="radiogroup" aria-label="Payment method">
          {PAYMENT_METHODS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={state.paymentMethodId === p.id} className="row" onClick={() => update({ paymentMethodId: p.id })}>
              <span className="row-icon"><Icon name={icons[p.kind]} size={20} /></span>
              <span className="row-text"><span className="row-title">{p.label}</span><span className="row-sub">{p.detail}</span></span>
              {state.paymentMethodId === p.id && <span style={{ color: 'var(--teal)' }}><Icon name="check" size={22} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <SecondaryButton icon="plus" onClick={() => setAdd(true)}>Add New Payment Method</SecondaryButton>
        </div>
        <Banner tone="info" icon="wallet">
          <span className="small">For now, pay your driver directly (EFT, card or cash) and mark it as paid here — both of you see the status. In-app payments are coming soon. Contributions are a fixed share of running costs, never a per-trip fare.</span>
        </Banner>
        {club && club.paymentStatus !== 'paid' && (
          <div style={{ marginTop: 16 }}>
            <LiftyButton icon="check" onClick={async () => {
              try {
                await api.markContributionPaid(club.matchId, 'me')
                update({ club: { ...club, paymentStatus: 'paid' } })
                toast('Marked as paid — your driver can see this', 'success')
              } catch (e) { toast(e instanceof Error ? e.message : 'Could not update', 'error') }
            }}>I’ve paid {rand(club.monthlyContribution)} this month</LiftyButton>
          </div>
        )}
      </ScreenBody>
      <BottomSheet open={add} onClose={() => setAdd(false)} title="Add payment method">
        <div className="stack-3">
          <p className="muted small">In-app card and instant-EFT payments are launching soon. You’ll be able to set up a monthly contribution that pays your driver automatically.</p>
          <LiftyButton onClick={() => setAdd(false)}>Got it</LiftyButton>
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Schedule exceptions (passenger & driver) ---------- */
export function Exceptions() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update, addException, removeException } = useApp()
  const isDriver = state.role === 'driver'
  const [sheet, setSheet] = useState(false)
  const [pickup, setPickup] = useState('Ballito centre')
  const club = state.club
  const tomorrow = isoDate(1)

  const quick: { kind: ExceptionKind; icon: IconName; title: string; note: string; date: string }[] = [
    { kind: isDriver ? 'unavailable' : 'absent', icon: 'calendar', title: 'Not commuting tomorrow', note: 'Not commuting tomorrow', date: tomorrow },
    { kind: 'wfh', icon: 'home', title: 'Working from home today', note: 'Working from home', date: isoDate(0) },
    { kind: 'leave', icon: 'sun', title: 'Annual leave', note: 'Annual leave (this week)', date: isoDate(2) },
    { kind: 'holiday', icon: 'flag', title: 'Public holiday', note: 'Public holiday', date: isoDate(3) },
  ]
  const paused = club?.paused ?? false
  const add = async (e: { kind: ExceptionKind; date: string; note: string }) => {
    addException(e)
    try {
      await api.addException({ ...e, legId: club?.matchId })
    } catch {
      toast('Saved on this phone — we’ll sync it when you’re back online', 'info')
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Schedule & exceptions" onBack={() => nav(-1)} />
      <ScreenBody>
        <p className="muted" style={{ marginBottom: 14 }}>Real life changes. Tell your lift club in one tap so nobody waits for nothing.</p>
        <div className="exception-grid">
          {quick.map((q) => {
            const on = state.exceptions.some((e) => e.kind === q.kind && e.date === q.date)
            return (
              <button key={q.title} type="button" className={`tile ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => {
                if (on) { const ex = state.exceptions.find((e) => e.kind === q.kind && e.date === q.date); if (ex) removeException(ex.id) }
                else { void add({ kind: q.kind, date: q.date, note: q.note }); toast(`${isDriver ? 'Passengers' : 'Your driver'} will be told: ${q.note.toLowerCase()}`, 'success') }
              }}>
                <span className="row-icon"><Icon name={on ? 'check' : q.icon} size={20} /></span>
                <strong>{q.title}</strong>
              </button>
            )
          })}
        </div>

        <SectionTitle>Arrangement</SectionTitle>
        <div className="list">
          <div className="row">
            <span className="row-icon"><Icon name={paused ? 'play' : 'pause'} size={20} /></span>
            <span className="row-text"><span className="row-title">{paused ? 'Arrangement paused' : 'Pause arrangement'}</span><span className="row-sub">{paused ? 'No pickups until you resume' : 'Skip all commutes until you resume'}</span></span>
            <Toggle label="Pause arrangement" checked={paused} onChange={(v) => { if (club) update({ club: { ...club, paused: v } }); if (v) void add({ kind: 'pause', date: 'ongoing', note: 'Arrangement paused' }); toast(v ? 'Arrangement paused' : 'Arrangement resumed', 'success') }} />
          </div>
          <ProfileRow icon="pin" title="Temporary pickup change" subtitle="Use a different pickup point for a day" onClick={() => setSheet(true)} />
        </div>
        {!club && !isDriver && <p className="small muted" style={{ marginTop: 8 }}>Pause becomes available once you’ve joined a lift club.</p>}

        <SectionTitle>Upcoming exceptions</SectionTitle>
        {state.exceptions.length === 0 ? (
          <p className="muted small">Nothing scheduled — you’re commuting as normal.</p>
        ) : (
          <div className="list">
            {state.exceptions.map((e) => (
              <div key={e.id} className="row">
                <span className="row-icon"><Icon name="calendar" size={20} /></span>
                <span className="row-text"><span className="row-title">{e.note ?? e.kind}</span><span className="row-sub">{e.date}</span></span>
                <TextButton onClick={() => removeException(e.id)} aria-label={`Remove ${e.note ?? e.kind}`}>Undo</TextButton>
              </div>
            ))}
          </div>
        )}
      </ScreenBody>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Temporary pickup change">
        <div className="stack-3">
          <Select label="Pickup point for tomorrow" value={pickup} onChange={setPickup} options={['Ballito centre', 'Ballito Drive (town centre)', 'Hotel Road', 'Salt Rock Main Road'].map((p) => ({ value: p, label: p }))} />
          <LiftyButton onClick={() => { void add({ kind: 'pickup-change', date: tomorrow, note: `Pickup at ${pickup}` }); setSheet(false); toast('Pickup change sent', 'success') }}>Send change</LiftyButton>
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Safety Centre ---------- */
export function Safety() {
  const nav = useNavigate()
  const toast = useToast()
  const loc = useLocation()
  const { state, update } = useApp()
  const isDriver = state.role === 'driver'
  const [report, setReport] = useState(new URLSearchParams(loc.search).get('report') === '1')
  const [kind, setKind] = useState<'driver' | 'passenger' | 'incident'>(isDriver ? 'passenger' : 'driver')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [contact, setContact] = useState(state.emergencyContact)
  const [editContact, setEditContact] = useState(false)
  const shareCommute = async () => {
    const text = `I’m on my Lifty commute${state.club ? ` with ${state.club.driver.firstName} (${state.club.driver.vehicle.colour} ${state.club.driver.vehicle.make} ${state.club.driver.vehicle.model}, ${state.club.driver.vehicle.registrationSummary})` : ''}.`
    try {
      if (navigator.share) await navigator.share({ title: 'My Lifty commute', text })
      else { await navigator.clipboard.writeText(text); toast('Commute details copied', 'success') }
    } catch { /* dismissed */ }
  }
  return (
    <Screen>
      <ScreenHeader title="Safety Centre" onBack={() => nav(-1)} />
      <ScreenBody>
        <Card className="mint">
          <div className="row-flex"><span className="row-icon" style={{ background: '#fff' }}><Icon name="shieldCheck" size={22} /></span>
            <div><strong>You’re travelling with a verified community</strong><p className="small muted">Drivers need approved identity, licence, registration and insurance documents before appearing in matches.</p></div></div>
        </Card>
        <SectionTitle>During your commute</SectionTitle>
        <div className="list">
          <ProfileRow icon="share" title="Share Commute" subtitle="Send your driver and car details to someone you trust" onClick={shareCommute} />
          <ProfileRow icon="phone" title="Emergency contact" subtitle={contact || 'Not set — add one'} onClick={() => setEditContact(true)} />
          <ProfileRow icon="alert" title="Emergency services" subtitle="SAPS 10111 · Ambulance 10177" onClick={() => { window.location.href = 'tel:10111' }} />
        </div>
        <SectionTitle>Report</SectionTitle>
        <div className="list">
          <ProfileRow icon="user" title={isDriver ? 'Report Passenger' : 'Report Driver'} onClick={() => { setKind(isDriver ? 'passenger' : 'driver'); setReport(true) }} />
          <ProfileRow icon="alert" title="Report Incident" onClick={() => { setKind('incident'); setReport(true) }} />
        </div>
        <SectionTitle>Safety tips</SectionTitle>
        <Card>
          <ul className="stack-2 small">
            <li>• Match the car photo, colour and partial plate before getting in.</li>
            <li>• Meet at the agreed pickup point — avoid isolated spots.</li>
            <li>• Keep chats in Lifty; nobody needs your personal number.</li>
            <li>• Share your commute the first few times you travel.</li>
          </ul>
        </Card>
      </ScreenBody>
      <BottomSheet open={report} onClose={() => setReport(false)} title={kind === 'incident' ? 'Report Incident' : kind === 'driver' ? 'Report Driver' : 'Report Passenger'}>
        <div className="stack-3">
          <p className="muted small">Tell us what happened. Reports are queued for safety review. The person reported never sees who filed it. In an emergency, call 10111 first.</p>
          <textarea className="field-area" aria-label="What happened" placeholder="What happened?" value={text} onChange={(e) => setText(e.target.value)} />
          <LiftyButton loading={sending} disabled={text.trim().length < 5} onClick={async () => {
            setSending(true)
            try {
              await api.submitReport({ kind, body: text.trim(), subjectId: kind === 'driver' ? state.club?.driver.id : undefined })
              setReport(false); setText(''); toast('Report saved for review.', 'success')
            } catch (e) { toast(e instanceof Error ? e.message : 'Could not send report', 'error') } finally { setSending(false) }
          }}>Send report</LiftyButton>
        </div>
      </BottomSheet>
      <BottomSheet open={editContact} onClose={() => setEditContact(false)} title="Emergency contact">
        <div className="stack-3">
          <TextField label="Phone number" value={contact} onChange={setContact} inputMode="tel" icon="phone" hint="Saved for your reference. Automatic contact alerts are not enabled in this pilot." />
          <LiftyButton onClick={async () => { update({ emergencyContact: contact }); await api.setConsent({ emergencyContact: contact }).catch(() => {}); setEditContact(false); toast('Emergency contact saved', 'success') }}>Save</LiftyButton>
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Lift club chat (numbers stay private) ---------- */
export function Chat() {
  const nav = useNavigate()
  const loc = useLocation()
  const { id = '' } = useParams()
  const name = (loc.state as { name?: string } | null)?.name ?? 'Lift club'
  const {state}=useApp()
  const { data, loading, error, retry } = useAsync(async () => ({clubId:id,accountId:state.user?.id,messages:await api.listMessages(id)}), [id,state.user?.id])
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [pending,setPending]=useState<OutgoingMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [syncError,setSyncError]=useState('')
  const [olderBusy,setOlderBusy]=useState(false)
  const [hasOlder,setHasOlder]=useState(false)
  const busy=useRef(false)
  const generation=useRef(0)
  const readCursor=useRef('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(()=>{generation.current++;setMsgs([]);setPending([]);setText('');setSending(false);setSyncError('');readCursor.current='';busy.current=false},[id,state.user?.id])
  useEffect(() => {
    if (data?.clubId===id&&data.accountId===state.user?.id){setMsgs(prev=>mergeMessages(prev,data.messages));setHasOlder(data.messages.length===100)}
  }, [data,id,state.user?.id])
  useEffect(() => api.subscribeMessages(id, (m) => setMsgs((x) => mergeMessages(x,[m]))), [id,state.user?.id])
  useEffect(()=>{setPending(current=>unconfirmedMessages(current,msgs))},[msgs])
  useEffect(()=>{
    let active=true
    const catchUp=()=>{
      if(document.visibilityState==='hidden')return
      void api.listMessages(id).then(messages=>{if(active){setMsgs(current=>mergeMessages(current,messages));setSyncError('')}}).catch(()=>{if(active)setSyncError('Could not refresh this conversation. Check your connection and try again.')})
    }
    window.addEventListener('focus',catchUp);window.addEventListener('online',catchUp)
    document.addEventListener('visibilitychange',catchUp)
    const timer=window.setInterval(catchUp,30_000)
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',catchUp);window.removeEventListener('online',catchUp);document.removeEventListener('visibilitychange',catchUp)}
  },[id,state.user?.id])
  useEffect(()=>{
    let active=true
    const latest=msgs[msgs.length-1]
    const markRead=()=>{
      if(!latest||document.visibilityState==='hidden'||readCursor.current===latest.id)return
      readCursor.current=latest.id
      void api.markClubRead(id,latest.id).then(()=>{if(active)window.dispatchEvent(new Event('lifty:chat-read'))}).catch(()=>{if(active&&readCursor.current===latest.id)readCursor.current=''})
    }
    markRead();document.addEventListener('visibilitychange',markRead);window.addEventListener('focus',markRead)
    const timer=window.setInterval(markRead,15_000)
    return ()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',markRead);window.removeEventListener('focus',markRead)}
  },[id,msgs])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs,pending.length])
  const send = async (previous?:OutgoingMessage) => {
    const t = previous?.body??text.trim()
    if (!t||busy.current||error||!state.user?.id) return
    const outgoing=previous?{...previous,status:'sending' as const,error:undefined}:outgoingMessage(crypto.randomUUID(),t,state.user?.id??'',Date.now())
    const currentGeneration=generation.current
    busy.current=true
    if(!previous)setText('')
    setPending(current=>[...current.filter(m=>m.id!==outgoing.id),outgoing])
    setSending(true)
    try {
      await api.sendMessage(id, t,outgoing.id)
      if(currentGeneration!==generation.current)return
      setPending(current=>current.map(m=>m.id===outgoing.id?{...m,status:'sent',error:undefined}:m))
      void api.listMessages(id).then(messages=>{if(currentGeneration===generation.current)setMsgs(current=>mergeMessages(current,messages))}).catch(()=>{})
    } catch (e) {
      if(currentGeneration===generation.current)setPending(current=>current.map(m=>m.id===outgoing.id?{...m,status:'failed',error:e instanceof Error?e.message:'Message could not be sent. Check your connection.'}:m))
    } finally {
      if(currentGeneration===generation.current){setSending(false);busy.current=false}
    }
  }
  const loadOlder=async()=>{
    if(!msgs[0]||olderBusy)return
    const currentGeneration=generation.current
    setOlderBusy(true)
    try{
      const older=await api.listMessages(id,msgs[0].createdAt,msgs[0].sequence)
      if(currentGeneration===generation.current){setMsgs(current=>mergeMessages(current,older));setHasOlder(older.length===100)}
    }catch(e){if(currentGeneration===generation.current)setSyncError(e instanceof Error?e.message:'Older messages could not be loaded.')}
    finally{if(currentGeneration===generation.current)setOlderBusy(false)}
  }
  const visibleMessages=mergeMessages(pending,msgs)
  return (
    <Screen>
      <ScreenHeader title={name} subtitle="Group chat · driver and accepted passengers" onBack={() => nav(-1)} />
      <ScreenBody>
        <p className="muted small" style={{marginBottom:12}}>Messages are shared with this lift club group. Phone numbers stay private.</p>
        {syncError&&<ErrorState message={syncError} onRetry={()=>{setSyncError('');retry()}}/>}
        {error&&<ErrorState message={error.message} onRetry={retry}/>}
        {loading&&msgs.length===0?<CardSkeleton/>:(
          <div className="stack-2">
            {!error&&visibleMessages.length === 0 && <p className="muted small center">Say hello — agree on the pickup spot and timing here.</p>}
            {hasOlder&&msgs.length>0&&<SecondaryButton loading={olderBusy} onClick={()=>void loadOlder()}>Load older messages</SecondaryButton>}
            {visibleMessages.map((m) => {
              const delivery=pending.find(p=>p.id===m.id)
              return (
              <div key={m.id} style={{ justifySelf: m.mine ? 'end' : 'start', maxWidth: '82%' }}>
                <div style={{ padding: '10px 14px', borderRadius: 18, background: m.mine ? 'var(--teal)' : '#fff', color: m.mine ? '#fff' : 'var(--text)', boxShadow: 'var(--shadow-1)',whiteSpace:'pre-wrap',overflowWrap:'anywhere' }}>{m.body}</div>
                <p className="tiny muted" style={{ textAlign: m.mine ? 'right' : 'left', marginTop: 2 }} aria-live={delivery?'polite':undefined}>{!m.mine && m.senderName ? `${m.senderName} · ` : ''}{delivery?.status==='sending'?'Sending…':delivery?.status==='failed'?'Not sent':m.mine?'Sent · '+timeAgo(m.createdAt):timeAgo(m.createdAt)}</p>
                {delivery?.status==='failed'&&<div role="alert"><p className="small muted">{delivery.error}</p><TextButton disabled={sending} onClick={()=>void send(delivery)}>Retry message</TextButton></div>}
              </div>
            )})}
            <div ref={end} />
          </div>
        )}
      </ScreenBody>
      <footer className="screen-footer" style={{ gridAutoFlow: 'column', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
        <div className="field-box"><input aria-label="Message" value={text} placeholder="Write a message…" maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}} /></div>
        <button className="icon-btn" aria-label="Send" disabled={sending||!text.trim()||!!error} aria-busy={sending||undefined} onClick={() => void send()} style={{ background: 'var(--teal)', color: '#fff', width: 52, height: 52 }}><Icon name="navigation" size={22} /></button>
      </footer>
    </Screen>
  )
}

/* ---------- POPIA: privacy notice, access & erasure ---------- */
export function Privacy() {
  const nav = useNavigate()
  const toast = useToast()
  const { reset } = useApp()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const download = async () => {
    try {
      const blob = await exportArchive()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `lifty-my-data-${isoDate(0)}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('Your data was downloaded', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not export your data', 'error')
    }
  }
  return (
    <Screen>
      <ScreenHeader title="Privacy & your data" onBack={() => nav(-1)} />
      <ScreenBody>
        <div className="stack-3">
          <Card>
            <strong>What we collect and why</strong>
            <ul className="stack-2 small" style={{ marginTop: 8 }}>
              <li>• <b>Account:</b> name, mobile number — to verify you and keep the community trusted.</li>
              <li>• <b>Commute:</b> home and work locations, days and times — only to match you with people on your route. Other members never see your home address.</li>
              <li>• <b>Live location:</b> only during a scheduled commute window (20 min before pickup until drop-off). Safety breadcrumbs are deleted after 30 days.</li>
              <li>• <b>Drivers’ documents:</b> ID, licence, registration, insurance — reviewed by Lifty only, stored encrypted, never shown to passengers.</li>
              <li>• <b>Ratings, reports and chat</b> — to keep the community safe.</li>
            </ul>
          </Card>
          <Card>
            <strong>Your rights (POPIA)</strong>
            <p className="small muted" style={{ marginTop: 6 }}>You can access, correct or delete your personal information at any time, and withdraw location consent in Profile. Questions or complaints: privacy@lifty.co.za, or the Information Regulator (inforegulator.org.za).</p>
          </Card>
          <div className="list">
            <ProfileRow icon="upload" title="Download my data" subtitle="Your owned records and stored files (ZIP)" onClick={download} />
            <ProfileRow icon="trash" title="Delete my account" subtitle="Removes your profile, commutes and lift-club memberships" danger onClick={() => setConfirm(true)} />
          </div>
          <TextButton onClick={() => nav('/terms')}>Terms of Service</TextButton>
        </div>
      </ScreenBody>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete your account?">
        <p className="muted">This permanently removes your profile, commutes, requests and lift-club memberships. Your drivers or passengers will be told you’ve left. This can’t be undone.</p>
        <SecondaryButton tone="danger" loading={busy} onClick={async () => {
          setBusy(true)
          try { await api.deleteMyAccount(); reset(); nav('/welcome', { replace: true }) } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete your account', 'error') } finally { setBusy(false); setConfirm(false) }
        }}>Yes, delete my account</SecondaryButton>
        <LiftyButton onClick={() => setConfirm(false)}>Keep my account</LiftyButton>
      </Modal>
    </Screen>
  )
}

export function Terms() {
  const nav = useNavigate()
  return (
    <Screen>
      <ScreenHeader title="Terms of Service" onBack={() => nav(-1)} />
      <ScreenBody>
        <div className="stack-3 small">
          <Card><strong>Lift clubs, not taxis</strong><p className="muted">Lifty connects people who already commute the same way. Drivers share seats on a trip they would make anyway; Lifty does not dispatch drivers or offer rides for hire.</p></Card>
          <Card><strong>Cost-sharing contributions</strong><p className="muted">Monthly contributions cover a fair share of running costs (fuel and wear). Lifty suggests an amount per route and caps it at 1.5× the estimated cost so arrangements stay cost-sharing, not profit-making. There are no per-trip fares or surge pricing.</p></Card>
          <Card><strong>Reliability</strong><p className="muted">Tell your lift club when you’re not commuting. Drivers wait 3 minutes at the pickup point after arriving; after that a no-show may be recorded, which lowers your reliability score.</p></Card>
          <Card><strong>Safety & conduct</strong><p className="muted">Be respectful, be on time, and keep communication in Lifty. Reports are reviewed by our team; serious or repeated issues lead to removal.</p></Card>
          <Card><strong>Insurance</strong><p className="muted">Drivers must hold valid vehicle insurance and a valid licence. Check with your insurer that regular lift-club passengers are covered.</p></Card>
          <p className="muted">These terms are a plain-language summary for the beta and will be replaced by the full legal terms before public launch.</p>
        </div>
      </ScreenBody>
    </Screen>
  )
}

/* ---------- Admin: driver verification + reports ---------- */
export function Admin() {
  const nav = useNavigate()
  const toast = useToast()
  const { data: allowed, loading: checking } = useAsync(() => api.isAdmin(), [])
  const docs = useAsync(() => (allowed ? api.listPendingDocuments() : Promise.resolve([])), [allowed])
  const reports = useAsync(() => (allowed ? api.listReports() : Promise.resolve([])), [allowed])
  const health=useAsync(()=>allowed?api.getAdminHealth():Promise.resolve(null),[allowed])
  const [subject,setSubject]=useState('')
  const [reason,setReason]=useState('')
  const [open, setOpen] = useState<PendingDocument | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [hidden, setHidden] = useState<string[]>([])

  useEffect(() => {
    setUrl(null)
    if (open) void api.documentUrl(open.storagePath).then(setUrl)
  }, [open])

  if (checking) return <Screen><ScreenHeader title="Admin" onBack={() => nav(-1)} /><ScreenBody><CardSkeleton /></ScreenBody></Screen>
  if (!allowed) return <Screen><ScreenHeader title="Admin" onBack={() => nav(-1)} /><ScreenBody><EmptyState icon="lock" title="Admins only" body="Your account doesn’t have access to the admin console." /></ScreenBody></Screen>

  const review = async (approve: boolean) => {
    if (!open) return
    try {
      await api.reviewDocument(open.id, approve, note || undefined)
      setHidden((h) => [...h, open.id]);health.retry();docs.retry()
      toast(approve ? 'Document approved' : 'Document rejected — the driver was notified', 'success')
      setOpen(null)
      setNote('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save review', 'error')
    }
  }
  const pending = (docs.data ?? []).filter((d) => !hidden.includes(d.id))

  return (
    <Screen>
      <ScreenHeader title="Admin console" subtitle="Driver verification and safety" onBack={() => nav(-1)} />
      <ScreenBody>
        <SectionTitle>Pilot operations</SectionTitle>
        {health.error&&<ErrorState message={health.error.message} onRetry={health.retry}/>}
        {health.data&&<Card><p>{health.data.pendingDocuments} pending documents · {health.data.openReports} open reports · {health.data.suspendedUsers} suspended accounts</p>
         <p className="small muted">Push: {health.data.notifications.providerConfigured?'Configured':'Firebase configuration required'} · {health.data.notifications.pending} pending · {health.data.notifications.failed} failed · {health.data.notifications.delivered} delivered</p>
         {health.data.jobs.map(j=><p className="small" key={j.name}>{j.name}: {j.status}{j.lastRun?' · '+j.lastRun:''}</p>)}
         <TextButton onClick={health.retry}>Refresh job health</TextButton>
        </Card>}
        <Card style={{marginTop:12}}><TextField label="Account ID" value={subject} onChange={setSubject}/><TextField label="Safety reason" value={reason} onChange={setReason}/>
          <div className="row-flex">{[true,false].map(suspended=><SecondaryButton key={String(suspended)} tone={suspended?'danger':undefined} disabled={!subject||(!reason&&suspended)} onClick={async()=>{try{await api.suspendUser(subject,suspended,reason);health.retry();toast(suspended?'Account suspended':'Account restored','success')}catch(e){toast(e instanceof Error?e.message:'Could not update account','error')}}}>{suspended?'Suspend':'Restore'}</SecondaryButton>)}</div>
        </Card>
        <SectionTitle>Verification queue ({pending.length})</SectionTitle>
        {docs.loading ? <CardSkeleton /> : docs.error ? <ErrorState message={docs.error.message} onRetry={docs.retry} /> : pending.length === 0 ? (
          <p className="muted small">All caught up — no documents waiting.</p>
        ) : (
          <div className="list">
            {pending.map((d) => (
              <ProfileRow key={d.id} icon="doc" title={`${d.userName} · ${d.kind.replace('_', ' ')}`} subtitle={`${d.detail ? d.detail + ' · ' : ''}${timeAgo(d.createdAt)}`} onClick={() => setOpen(d)} />
            ))}
          </div>
        )}
        <SectionTitle>Safety reports</SectionTitle>
        {reports.loading ? <CardSkeleton /> : (reports.data ?? []).length === 0 ? <p className="muted small">No reports.</p> : (
          <div className="stack-3">
            {(reports.data as SafetyReport[]).map((r) => (
              <Card key={r.id}>
                <div className="row-flex between"><StatusBadge tone={r.status === 'open' ? 'warning' : r.status === 'closed' ? 'neutral' : 'info'}>{r.status}</StatusBadge><span className="small muted">{r.kind} · {timeAgo(r.createdAt)}</span></div>
                <p className="small muted">Reported by {r.reporterName??r.reporterId??'Member'}{r.subjectId?' · Subject: '+(r.subjectName??r.subjectId):''}</p>
                {r.subjectId&&<TextButton onClick={()=>setSubject(r.subjectId!)}>Review this account</TextButton>}
                <p className="small" style={{ margin: '8px 0' }}>{r.body}</p>
                {r.status !== 'closed' && (
                  <div className="row-flex">
                    <SecondaryButton size="sm" onClick={async () => { try{await api.updateReport(r.id,'reviewing');reports.retry()}catch(e){toast(e instanceof Error?e.message:'Could not update','error')} }}>Reviewing</SecondaryButton>
                    <SecondaryButton size="sm" onClick={async () => { try{await api.updateReport(r.id,'closed');reports.retry()}catch(e){toast(e instanceof Error?e.message:'Could not update','error')} }}>Close</SecondaryButton>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </ScreenBody>
      <BottomSheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.userName} · ${open.kind.replace('_', ' ')}` : ''}>
        {open && (
          <div className="stack-3">
            {url ? (/\.pdf($|\?)/i.test(url) ? <a className="btn btn-secondary btn-block" href={url} target="_blank" rel="noreferrer">Open PDF</a> : <img className="doc-preview" src={url} alt="Uploaded document" />) : <p className="muted small">Loading document…</p>}
            {open.detail && <p className="small">Detail: <strong>{open.detail}</strong></p>}
            <p className="small">Expiry recorded by driver: <strong>{open.expiresOn ?? 'Not recorded'}</strong>. Check this against the uploaded document before approving.</p>
            <TextField label="Note to driver (if rejecting)" value={note} onChange={setNote} placeholder="e.g. Photo is blurry — please retake" />
            <LiftyButton icon="check" onClick={() => review(true)}>Approve</LiftyButton>
            <SecondaryButton tone="danger" onClick={() => review(false)}>Reject</SecondaryButton>
          </div>
        )}
      </BottomSheet>
    </Screen>
  )
}
