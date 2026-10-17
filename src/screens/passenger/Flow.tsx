import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LoadingMatchAnimation } from '@/components/match/LoadingMatchAnimation'
import { MatchMap } from '@/components/match/MatchMap'
import { ContributionCard, DriverCard, KV, LiveTrackingStatus, MatchCard, MetricTile, trackingTitle } from '@/components/match/cards'
import { MapChip } from '@/components/map/MapView'
import { CallButton, Confetti, GraceBar, NavigateButton, VehiclePhotoCard } from '@/components/ui/extras'
import { Icon } from '@/components/ui/Icon'
import {
  Avatar, Banner, BottomSheet, Card, CardSkeleton, EmptyState, ErrorState, LiftyButton, Rating, Screen, ScreenBody, ScreenFooter, ScreenHeader,
  SecondaryButton, SectionTitle, StarInput, StatusBadge, TextButton, Timeline, VerificationBadge, useToast, Select,
} from '@/components/ui/kit'
import type { Match } from '@/domain/types'
import { addMinutes, formatDate, formatDays, formatDistance, rand, timeAgo } from '@/lib/format'
import { useAsync, useOnline } from '@/hooks/useAsync'
import { useTracking } from '@/hooks/useTracking'
import { api, ApiError, getLastMatchSuggestions, type CommuteInstance } from '@/services/api'
import { instanceToMatch } from '@/services/liveApi'
import { resetTrackingFeed } from '@/services/tracking'
import { currentUserId } from '@/services/supabase'
import { useApp } from '@/store/app'
import { driverIsVerified } from '@/domain/verification'
import { shareInvite } from './Tabs'
import {shareCommute} from '@/services/share'

const isOffline = (e: Error | null) => e instanceof ApiError && e.code === 'offline'

/* ---------- 12 Finding your lift clubs ---------- */
export function Finding() {
  const nav = useNavigate()
  const { state } = useApp()
  const [error, setError] = useState<Error | null>(null)
  const [done, setDone] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setDone(false)
    const minDelay = new Promise((r) => setTimeout(r, 350))
    Promise.all([api.findMatches(state.plan), minDelay])
      .then(([matches]) => {
        if (!alive) return
        setDone(true)
        setTimeout(() => alive && nav(matches.length ? '/p/matches' : '/p/no-match', { replace: true, state: { matches } }), 150)
      })
      .catch((e) => alive && setError(e instanceof Error ? e : new Error('Failed')))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  return (
    <Screen dark>
      <ScreenHeader back title="" onBack={() => nav('/p/find')} />
      <ScreenBody>
        {error ? (
          <div style={{ color: '#fff' }}>
            <ErrorState message={error.message} offline={isOffline(error)} onRetry={() => setAttempt((a) => a + 1)} />
          </div>
        ) : (
          <LoadingMatchAnimation done={done} />
        )}
      </ScreenBody>
    </Screen>
  )
}

/* ---------- 13 Available lift clubs ---------- */
export function Matches() {
  const nav = useNavigate()
  const loc = useLocation()
  const { state } = useApp()
  const pre = (loc.state as { matches?: Match[] } | null)?.matches
  const { data, loading, error, retry } = useAsync(() => (pre ? Promise.resolve(pre) : api.findMatches(state.plan)), [])
  useEffect(() => {
    if (data && data.length === 0) nav('/p/no-match', { replace: true })
  }, [data, nav])

  return (
    <Screen>
      <ScreenHeader title="Available Lift Clubs" onBack={() => nav('/p/find')} />
      <ScreenBody>
        {loading ? (
          <div className="stack-3"><CardSkeleton /><CardSkeleton /></div>
        ) : error ? (
          <ErrorState message={error.message} offline={isOffline(error)} onRetry={retry} />
        ) : data ? (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              We found <strong style={{ color: 'var(--text)' }}>{data.length} compatible driver{data.length > 1 ? 's' : ''}</strong> for your {state.plan.direction === 'to_home' ? 'trip home' : 'commute'} ({formatDays(state.plan.days)}). Sorted by route compatibility — not by who’s closest.
            </p>
            <div className="stack-3">
              {data.map((m, i) => (
                <MatchCard key={m.id} match={m} rank={i} onView={() => nav(`/p/match/${m.id}`)} />
              ))}
            </div>
            <div style={{ height: 12 }} />
            <SecondaryButton icon="walk" onClick={() => nav('/p/find')}>Adjust my commute</SecondaryButton>
          </>
        ) : null}
      </ScreenBody>
    </Screen>
  )
}

/* ---------- 14 Driver route details / commute match ---------- */
export function MatchDetail() {
  const nav = useNavigate()
  const { id = '' } = useParams()
  const toast = useToast()
  const { update } = useApp()
  const { data: m, loading, error, retry } = useAsync(() => api.getMatch(id), [id])
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (!m) return
    setSending(true)
    try {
      const req = await api.requestToJoin(m.id)
      update({ request: req })
      setConfirm(false)
      nav('/p/sent?request='+req.id, { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send request', 'error')
    } finally {
      setSending(false)
    }
  }
  const fees = m ? m.monthlyContribution.platformFee + m.monthlyContribution.processingFee : 0

  return (
    <Screen>
      <ScreenHeader title="Driver Route Details" onBack={() => nav(-1)} />
      <ScreenBody className="flush">
        {loading ? (
          <div style={{ padding: 16 }} className="stack-3"><CardSkeleton /><CardSkeleton /></div>
        ) : error || !m ? (
          <ErrorState message={error?.message ?? 'Match not found'} offline={isOffline(error)} onRetry={retry} />
        ) : (
          <div style={{ padding: '0 16px' }}>
            <div className="map-frame">
              <MatchMap geometry={m.geometry} pickup={m.pickup.location} destination={m.destination.location} pickupLabel={m.pickup.label} passenger={m.geometry.walking[0]} focus="pickup" inset height={320} padding={{ top: 56, right: 40, bottom: 56, left: 40 }} deviationText={`+${m.driverDeviationMinutes} min`} overlay={<MapChip style={{ top: 12, left: 12, color: 'var(--teal-700)' }}><Icon name="route" size={16} /> {m.routeOverlap}% route overlap</MapChip>} />
            </div>
            <ul className="stack-2" style={{ padding: '12px 4px 0' }}>
              <li className="row-flex small"><i className="legend-swatch" style={{ background: 'var(--map-blue)' }} /> Driver’s regular route</li>
              <li className="row-flex small"><i className="legend-swatch" style={{ background: 'var(--warning)' }} /> Short detour to your pickup point</li>
              <li className="row-flex small"><i className="legend-swatch" style={{ borderTop: '3px dotted var(--navy)' }} /> Your walk to {m.pickup.label}</li>
            </ul>

            {m.partial&&<Banner tone="warning">Partial match. Uncovered: {m.uncoveredDates?.length?m.uncoveredDates.join(', '):formatDays(m.uncoveredDays??[])}. Trips will only be scheduled for the covered days.</Banner>}
            <Card className="mint" style={{ marginTop: 12 }}>
              <p className="eyebrow" style={{ color: 'var(--teal-700)' }}>Why this works</p>
              {m.explanation?.length ? (
                <ul className="stack-2 small" style={{ marginTop: 6 }}>
                  {m.explanation.map((line) => <li key={line}>• {line}</li>)}
                </ul>
              ) : (
                <p>{m.driver.firstName} already drives this way and passes <strong>{m.pickup.label}</strong>. You walk <strong>{m.walkingMinutes} min</strong>; they detour just <strong>{m.driverDeviationMinutes} min</strong>.</p>
              )}
              {m.routingEstimated && <p className="tiny muted" style={{ marginTop: 6 }}>Detour, walk and overlap are estimates — road routing was unavailable. Search again later for exact figures.</p>}
              {m.walkingEstimated && <p className="tiny muted" style={{ marginTop: 6 }}>Walking time is an estimate — no pedestrian route was available for this spot.</p>}
              {m.partial && <p className="small" style={{ marginTop: 8, color: '#92600a' }}><strong>Partial schedule:</strong> {m.driver.firstName} doesn’t drive on {m.uncoveredDates?.length ?? 0} of your selected day{(m.uncoveredDates?.length ?? 0) === 1 ? '' : 's'}.</p>}
            </Card>

            <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <MetricTile icon="route" label="Route overlap" value={`${m.routeOverlap}%`} tone="teal" />
              {m.walkingDistanceM === 0
                ? <MetricTile icon="pin" label="Pickup" value="Door" sub="no walking" tone="blue" />
                : <MetricTile icon="walk" label="Walk to pickup" value={`${m.walkingMinutes} min`} sub={formatDistance(m.walkingDistanceM)} tone="blue" />}
              <MetricTile icon="navigation" label="Est. driver deviation" value={`${m.driverDeviationMinutes} min`} sub={`+${m.additionalDistanceKm} km`} tone="amber" />
              <MetricTile icon="seat" label="Seats available" value={m.availableSeats} sub={formatDays(m.days)} />
            </div>

            <Card style={{ marginTop: 12 }}>
              <div className="kv-list" style={{ marginTop: 0 }}>
                <KV icon="car" k="Driver departs" v={m.departureTime} />
                <KV icon="pin" k="Est. pickup time" v={m.pickupEta} />
                <KV icon="flag" k="Estimated arrival" v={m.arrivalEta} />
                <KV icon="calendar" k="Schedule" v={formatDays(m.days)} />
              </div>
            </Card>

            <SectionTitle>Your driver</SectionTitle>
            <DriverCard driver={m.driver} onClick={() => nav(`/p/driver/${m.driver.id}`)} />
            <div style={{ marginTop: 12 }}><VehiclePhotoCard vehicle={m.driver.vehicle} seatsAvailable={m.availableSeats} /></div>
            <SectionTitle>Contribution</SectionTitle>
            {m.pricing === 'per_day' && (
              <Card className="mint" style={{ marginBottom: 12 }}>
                <p className="eyebrow" style={{ color: 'var(--teal-700)' }}>Pay per day used</p>
                <p><strong>{rand(m.perDayContribution ?? 0)}/day × {m.bookedDays} day{m.bookedDays === 1 ? '' : 's'}</strong> = {rand(m.monthlyContribution.driverContribution)} for your first booked month. Only the dates you picked that {m.driver.firstName} drives are counted.</p>
              </Card>
            )}
            <ContributionCard breakdown={m.monthlyContribution} />
            <div className="row-flex" style={{ margin: '12px 0 20px' }}>
              <SecondaryButton size="sm" icon="user" onClick={() => nav(`/p/driver/${m.driver.id}`)}>View Driver Profile</SecondaryButton>
            </div>
          </div>
        )}
      </ScreenBody>
      {m && (
        <ScreenFooter>
          <LiftyButton icon="users" onClick={() => setConfirm(true)}>Request to Join</LiftyButton>
        </ScreenFooter>
      )}

      <BottomSheet open={confirm} onClose={() => setConfirm(false)} title="Before you request">
        {m && (
          <div className="stack-3">
            <p className="muted">{m.driver.firstName} will review your request. You’re only part of the lift club once they accept. You can chat once you’re in — numbers stay private.</p>
            <Card className="mint">
              <div className="kv-list" style={{ marginTop: 0 }}>
                <KV k="Driver contribution" v={rand(m.monthlyContribution.driverContribution)} />
                {fees > 0 && <KV k="Platform & processing" v={rand(fees)} />}
                <KV k="Total" v={m.pricing === 'per_day' ? `${rand(m.monthlyContribution.total)} for ${m.bookedDays} day${m.bookedDays === 1 ? '' : 's'}` : `${rand(m.monthlyContribution.total)}/month`} strong />
              </div>
            </Card>
            <p className="small muted">{m.pricing === 'per_day' ? `${rand(m.perDayContribution ?? 0)} per day you travel — a share of running costs, agreed up front.` : 'A fixed monthly share of running costs, agreed up front.'} Nothing is charged until you’re accepted.</p>
            <LiftyButton loading={sending} onClick={send}>Send Request</LiftyButton>
            <SecondaryButton onClick={() => setConfirm(false)}>Cancel</SecondaryButton>
          </div>
        )}
      </BottomSheet>
    </Screen>
  )
}

/* ---------- 15 Request sent (polls for the driver's decision) ---------- */
export function RequestSent() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update } = useApp()
  const requestedId = new URLSearchParams(useLocation().search).get('request')
  const requestQuery = useAsync(() => requestedId ? api.getJoinRequest(requestedId) : Promise.resolve(state.request), [state.user?.id, requestedId, state.request?.id])
  const req = requestQuery.data
  const [status, setStatus] = useState(req?.status ?? 'pending')
  const [pollError, setPollError] = useState<string | null>(null)
  const driverName = useRef('the driver')
  const matchId = req?.matchId
  const { data: m } = useAsync(() => (matchId ? api.getMatch(matchId) : Promise.reject(new Error('none'))), [matchId])
  if (m) driverName.current = m.driver.firstName
  useEffect(()=>{setStatus(req?.status??'pending')},[req?.id,req?.status])

  useEffect(() => {
    if (!req) return
    let alive = true
    const tick = async () => {
      try {
        const r = await api.getJoinRequest(req.id)
        if (!alive) return
        setPollError(null)
        setStatus(r.status)
        if (r.status === 'accepted') {
          update({ request: r })
          setTimeout(() => alive && nav('/p/accepted?request='+r.id, { replace: true }), 1200)
        }
      } catch (e) {
        if (alive) setPollError(e instanceof Error ? e.message : 'Could not check your request')
      }
    }
    void tick()
    const t = setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.id])

  if (requestQuery.loading) return <Screen><ScreenHeader title="Request" onBack={()=>nav('/p/home')} /><ScreenBody><CardSkeleton /></ScreenBody></Screen>
  if (requestQuery.error) return <Screen><ScreenHeader title="Request" onBack={()=>nav('/p/home')} /><ScreenBody><ErrorState message={requestQuery.error.message} onRetry={requestQuery.retry} /></ScreenBody></Screen>
  if (!req) return <Screen><ScreenHeader title="Request" onBack={() => nav('/p/home')} /><ScreenBody><EmptyState title="No active request" body="Find a lift club and send a request to join." action={<LiftyButton block={false} onClick={() => nav('/p/find')}>Find Lift Clubs</LiftyButton>} /></ScreenBody></Screen>

  if (status === 'declined') {
    return (
      <Screen>
        <ScreenHeader title="" onBack={() => nav('/p/home')} />
        <ScreenBody>
          <EmptyState icon="route" title="Not a fit this time" body={`${driverName.current}’s lift club can’t take you right now. That’s normal — let’s find another driver on your route.`} action={<LiftyButton block={false} icon="search" onClick={() => { update({ request: null }); nav('/p/finding') }}>Find More Lift Clubs</LiftyButton>} />
        </ScreenBody>
      </Screen>
    )
  }

  return (
    <Screen>
      <ScreenHeader back onBack={() => nav('/p/home')} title="" />
      <ScreenBody>
        <div className="center stack-4" style={{ paddingTop: 8, position: 'relative' }}>
          {!state.lowData && <Confetti />}
          <div className="success-burst"><span className="tick"><Icon name="check" size={40} strokeWidth={3} /></span></div>
          <h1 className="h1" style={{ fontSize: 28 }}>Request Sent!</h1>
          <p className="muted">Your request to join {driverName.current}’s lift club has been sent. You’ll be notified once the driver accepts.</p>
        </div>
        <Card style={{ marginTop: 24 }}>
          <Timeline
            steps={[
              { label: 'Request sent', sub: 'Just now', state: 'done' },
              { label: 'Driver reviewing', sub: 'They’ll check your pickup point and schedule', state: status === 'pending' ? 'active' : 'done' },
              { label: 'Awaiting response', sub: status === 'accepted' ? 'Accepted!' : 'Usually within a few hours', state: status === 'accepted' ? 'done' : status === 'reviewing' ? 'active' : 'todo' },
            ]}
          />
        </Card>
        {pollError && <div style={{ marginTop: 12 }}><Banner tone="warning">{pollError} We’ll keep trying.</Banner></div>}
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton onClick={() => m && nav(`/p/match/${m.id}`)} disabled={!m}>View Details</LiftyButton>
        <SecondaryButton onClick={() => nav('/p/find')}>Find More Lift Clubs</SecondaryButton>
        <TextButton onClick={async () => { try { await api.cancelJoinRequest(req.id); update({ request: null }); toast('Request cancelled'); nav('/p/home', { replace: true }) } catch (e) { toast(e instanceof Error ? e.message : 'Could not cancel', 'error') } }}>Cancel request</TextButton>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- 16 Match accepted ---------- */
export function Accepted() {
  const nav = useNavigate()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const { state, update } = useApp()
  const requestedId = new URLSearchParams(useLocation().search).get('request') ?? state.request?.id
  const { data: accepted, loading, error, retry } = useAsync(async () => {
    if (!requestedId) throw new Error('Choose an accepted request from your messages or lift club.')
    const request = await api.getJoinRequest(requestedId)
    if (request.status !== 'accepted') throw new Error('The driver has not accepted this request yet.')
    return {request,match:await api.getMatch(request.matchId)}
  }, [state.user?.id, requestedId])
  const req = accepted?.request
  const m = accepted?.match
  if (loading) return <Screen><ScreenHeader title="Your request" onBack={()=>nav('/p/home')}/><ScreenBody><CardSkeleton /></ScreenBody></Screen>
  if (error || !m || !req) return <Screen><ScreenHeader title="" onBack={() => nav('/p/home')} /><ScreenBody><ErrorState message={error?.message ?? 'Something went wrong'} onRetry={retry} /></ScreenBody></Screen>
  const go = async () => {
    setSaving(true)
    try {
      const saved = await api.getMyClubs()
      if (!saved?.asPassenger.some(c => c.matchId === req.matchId)) throw new Error('Could not restore the accepted lift club. Please try again.')
      update({ club: saved.asPassenger.find(c => c.direction === 'to_work') ?? null, returnClub: saved.asPassenger.find(c => c.direction === 'to_home') ?? null, request: null })
      nav('/p/commute', { replace: true })
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not restore your lift club', 'error') }
    finally { setSaving(false) }
  }
  return (
    <Screen>
      <ScreenHeader back={false} title="" />
      <ScreenBody>
        <div className="center stack-3" style={{ position: 'relative' }}>
          {!state.lowData && <Confetti />}
          <div className="success-burst"><span className="tick"><Icon name="check" size={40} strokeWidth={3} /></span></div>
          <h1 className="h1" style={{ fontSize: 30 }}>You’re In!</h1>
          {m.driver.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}
          <p className="muted">{m.driver.firstName} has accepted your request. Welcome to the lift club!</p>
        </div>
        <Card style={{ marginTop: 24 }}>
          <div className="row-flex" style={{ marginBottom: 8 }}>
            <Avatar first={m.driver.firstName} last={m.driver.lastInitial} hue={m.driver.avatarHue} size={48} src={m.driver.avatarUrl} />
            <div><strong>{m.driver.firstName} {m.driver.lastInitial}.</strong><p className="small muted">{m.driver.vehicle.make} {m.driver.vehicle.model} · {m.driver.vehicle.colour}</p></div>
          </div>
          <div className="kv-list">
            <KV icon="calendar" k="Start date" v={formatDate(req.startDate)} />
            <KV icon="calendar" k="Days" v={formatDays(m.days)} />
            <KV icon="pin" k="Pickup point" v={m.pickup.label} />
            <KV icon="clock" k="Pickup time" v={`${m.pickupEta} (±5 min)`} />
            <KV icon="wallet" k={m.pricing === 'per_day' ? 'Contribution' : 'Monthly contribution'} v={m.pricing === 'per_day' ? `${rand(m.perDayContribution ?? 0)}/day · ${rand(m.monthlyContribution.total)} first month` : rand(m.monthlyContribution.total)} strong />
          </div>
        </Card>
      </ScreenBody>
      <ScreenFooter>
        <LiftyButton loading={saving} onClick={go}>View Lift Club Details</LiftyButton>
      </ScreenFooter>
    </Screen>
  )
}

/* ---------- No strong match yet ---------- */
export function NoMatch() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update, updatePlan } = useApp()
  const [sheet, setSheet] = useState<'time' | 'pickup' | null>(null)
  const from = state.plan.direction==='to_home'?state.plan.destination:state.plan.origin
  const { data: points, loading:pointsLoading, error:pointsError, retry:retryPoints } = useAsync(() => api.listPickupPoints(from.location), [from.location.lat,from.location.lng])
  const times = ['07:30', '07:45', '08:00', '08:15', '08:30', '09:00'].map((t) => ({ value: t, label: t }))
  return (
    <Screen>
      <ScreenHeader title="" onBack={() => nav('/p/find')} />
      <ScreenBody>
        <EmptyState icon="route" title="No strong match yet" body="No drivers on your exact route and schedule right now — but new lift clubs are added all the time. Here’s how to widen the net." />
        {getLastMatchSuggestions().length > 0 && (
          <Banner tone="info" icon="info">
            <strong>What’s blocking matches</strong>
            <ul className="small">{getLastMatchSuggestions().map((s) => <li key={s}>• {s}</li>)}</ul>
          </Banner>
        )}
        <div className="stack-3" style={{ marginTop: 12 }}>
          <Card className={state.savedAlert ? 'mint' : ''}>
            <div className="row-flex">
              <span className="row-icon"><Icon name="bell" size={20} /></span>
              <div className="grow"><strong>{state.savedAlert ? 'We’ll notify you' : 'Notify me when a match appears'}</strong><p className="small muted">Your commute is saved. We’ll alert you the moment a compatible driver joins.</p></div>
            </div>
            <div style={{ marginTop: 12 }}>
              {state.savedAlert ? <StatusBadge tone="success" icon="check">Commute saved · alerts on</StatusBadge> : <LiftyButton size="sm" onClick={async () => { try{await api.savePassengerCommute(state.plan);await api.setMatchAlert(true);update({savedAlert:true});toast('Commute saved — alerts enabled','success')}catch(e){toast(e instanceof Error?e.message:'Could not save alert','error')} }}>Save My Commute</LiftyButton>}
            </div>
          </Card>
          <div className="list">
            <button className="row" disabled={state.plan.maxWalkMeters>=1000} onClick={() => { updatePlan({ maxWalkMeters: Math.min(1000, state.plan.maxWalkMeters + 250) }); nav('/p/finding', { replace: true }) }}>
              <span className="row-icon"><Icon name="walk" size={20} /></span><span className="row-text"><span className="row-title">{state.plan.maxWalkMeters>=1000?'Maximum walking distance reached':'Increase walking distance'}</span><span className="row-sub">Now {state.plan.maxWalkMeters ? `${state.plan.maxWalkMeters}m` : 'no walking'} → {Math.min(1000, state.plan.maxWalkMeters + 250)}m</span></span><Icon name="chevron" size={18} className="row-chev" />
            </button>
            <button className="row" onClick={() => setSheet('time')}>
              <span className="row-icon"><Icon name="clock" size={20} /></span><span className="row-text"><span className="row-title">{state.plan.direction==='to_home'?'Adjust leaving time':'Adjust arrival time'}</span><span className="row-sub">{state.plan.direction==='to_home'?`Currently after ${state.plan.returnTime}`:`Currently before ${state.plan.arriveBy}`}</span></span><Icon name="chevron" size={18} className="row-chev" />
            </button>
            <button className="row" onClick={() => setSheet('pickup')}>
              <span className="row-icon"><Icon name="pin" size={20} /></span><span className="row-text"><span className="row-title">Try a nearby pickup point</span><span className="row-sub">{(points ?? []).slice(0, 3).map((p) => p.label).join(', ') || 'Garages, centres, safe meeting spots'}</span></span><Icon name="chevron" size={18} className="row-chev" />
            </button>
            <button className="row" onClick={() => shareInvite(toast, state.plan.origin.area.split(',')[0])}>
              <span className="row-icon"><Icon name="users" size={20} /></span><span className="row-text"><span className="row-title">Invite colleagues on your route</span><span className="row-sub">Bring a driver you know onto Lifty</span></span><Icon name="chevron" size={18} className="row-chev" />
            </button>
          </div>
        </div>
      </ScreenBody>
      <ScreenFooter><SecondaryButton onClick={() => nav('/p/home')}>Back to Home</SecondaryButton></ScreenFooter>
      <BottomSheet open={sheet === 'time'} onClose={() => setSheet(null)} title={state.plan.direction==='to_home'?'Adjust leaving time':'Adjust arrival time'}>
        <div className="stack-3">
          <Select label={state.plan.direction==='to_home'?'Leave work after':'Arrive before'} value={state.plan.direction==='to_home'?state.plan.returnTime:state.plan.arriveBy} onChange={(v) => updatePlan(state.plan.direction==='to_home'?{returnTime:v}:{arriveBy:v,arriveWindowStart:addMinutes(v,-15)})} options={state.plan.direction==='to_home'?['16:00','16:30','17:00','17:30','18:00','18:30','19:00'].map(value=>({value,label:value})):times} />
          <LiftyButton onClick={() => nav('/p/finding', { replace: true })}>Search again</LiftyButton>
        </div>
      </BottomSheet>
      <BottomSheet open={sheet === 'pickup'} onClose={() => setSheet(null)} title="Nearby pickup points">
        {pointsLoading?<CardSkeleton/>:pointsError?<ErrorState message={pointsError.message} onRetry={retryPoints}/>:!points?.length?<EmptyState icon="pin" title="No nearby pickup points" body="Choose a meeting point when you adjust your commute."/>:null}
        <div className="list">
          {(points ?? []).map((p) => (
            <button key={p.label + p.location.lat} className="row" onClick={() => { updatePlan({ preferredPickup: p }); nav('/p/finding', { replace: true }) }}>
              <span className="row-icon"><Icon name="pin" size={20} /></span><span className="row-text"><span className="row-title">{p.label}</span><span className="row-sub">{p.area}</span></span><Icon name="chevron" size={18} className="row-chev" />
            </button>
          ))}
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Live tracking (passenger) ---------- */
export function PassengerTracking() {
  const nav = useNavigate()
  const q = useAsync(() => api.getCurrentInstance(), [])
  if (q.loading) return <Screen><ScreenHeader title="Live tracking" onBack={() => nav(-1)} /><ScreenBody><CardSkeleton /></ScreenBody></Screen>
  if (q.error) return <Screen><ScreenHeader title="Live tracking" onBack={() => nav(-1)} /><ScreenBody><ErrorState message={q.error.message} offline={isOffline(q.error)} onRetry={q.retry} /></ScreenBody></Screen>
  if (!q.data) return <NoCommuteNow title="Live tracking" />
  const match = instanceToMatch(q.data, currentUserId ?? undefined)
  return <TrackingBody match={match} />
}

export function NoCommuteNow({ title }: { title: string }) {
  const nav = useNavigate()
  return (
    <Screen>
      <ScreenHeader title={title} onBack={() => nav(-1)} />
      <ScreenBody>
        <EmptyState icon="clock" title="No commute in progress" body="Live location sharing switches on automatically 20 minutes before a scheduled pickup, and stops at drop-off. Check back closer to your pickup time." action={<SecondaryButton block={false} icon="calendar" onClick={() => nav(-1)}>Back to my commute</SecondaryButton>} />
      </ScreenBody>
    </Screen>
  )
}

function TrackingBody({ match }: { match: Match }) {
  const nav = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const { state } = useApp()
  const { snapshot: s, connection, stale, feed } = useTracking(match, { lowData: state.lowData })
  const [privacy, setPrivacy] = useState(false)
  const [safety, setSafety] = useState(false)
  const d = match.driver
  const verificationHold = s.verificationHold ?? (match as Match & {liveInstance?: {verificationHold?:boolean}}).liveInstance?.verificationHold
  const pre = s.status === 'sharing-soon' || s.status === 'driver-approaching' || s.status === 'passenger-approaching' || s.status === 'both-at-pickup'
  const title = s.status === 'underway' ? 'On Your Way' : s.status === 'destination-reached' || s.status === 'ended' ? (s.noShow ? 'Commute missed' : 'You’ve arrived') : s.status === 'sharing-soon' ? 'Starting soon' : s.status === 'both-at-pickup' ? 'At Pickup' : 'Driver Approaching'
  const feedError = (feed as { getError?: () => string | null }).getError?.()

  const detail = (() => {
    switch (s.status) {
      case 'sharing-soon': return 'Live locations switch on 20 minutes before pickup.'
      case 'driver-approaching': return s.driverLocation ? `${d.firstName} is ${s.pickupEta} min from pickup` : `Waiting for ${d.firstName}’s location…`
      case 'passenger-approaching': return `${d.firstName} has arrived — you’re ${s.walkingEta} min away`
      case 'both-at-pickup': return 'You’re both at the pickup point'
      case 'underway': return `Arriving in about ${s.destinationEta} min`
      case 'destination-reached': return 'You’ve reached your destination'
      default: return s.noShow ? 'Your driver waited 3 minutes and had to continue.' : 'Location sharing has ended for this commute'
    }
  })()

  return (
    <Screen>
      <ScreenHeader title={title} subtitle={pre ? `Pickup · ${match.pickup.label}` : `To ${match.destination.label}`} onBack={() => nav(-1)} right={<button className="icon-btn" aria-label="Location privacy" onClick={() => setPrivacy(true)}><Icon name="lock" size={20} /></button>} />
      {verificationHold&&<Banner tone="warning">Your driver's approval requires review. New pickups are on hold. Contact your lift club before travelling; passengers already collected can finish their journey.</Banner>}
      {(stale || !online || feedError) && (
        <div style={{ padding: '0 16px 8px' }}>
          <Banner tone="warning" icon={online ? 'alert' : 'wifiOff'} action={<TextButton onClick={() => { feed.setLinkDown(false); feed.restart(); toast('Reconnecting…') }}>Retry</TextButton>}>
            <strong>{!online ? 'Connection lost' : feedError ?? 'Driver location temporarily unavailable'}</strong>
            {connection.lastUpdate ? `Last updated ${timeAgo(connection.lastUpdate)}.` : 'Showing the last known location.'}
          </Banner>
        </div>
      )}
      <div className="map-fill">
        <MatchMap geometry={{ ...match.geometry, walking: s.walkingGeometry.length ? s.walkingGeometry : match.geometry.walking }} pickup={match.pickup.location} destination={match.destination.location} pickupLabel={match.pickup.label} destinationLabel="Destination" passenger={s.status === 'underway' ? null : s.passengerLocation} driver={s.driverLocation} focus={pre ? 'pickup' : 'ride'} showWalking={pre} showDeviation={pre} showRoute height="100%" stale={stale} deviationText={pre && match.driverDeviationMinutes ? `+${match.driverDeviationMinutes} min` : undefined} animate={false} padding={{ top: 130, right: 44, bottom: 56, left: 44 }}
          fallbackNoticeTop={120} overlay={pre && s.driverLocation && !s.driverArrived ? <div className="map-chip" style={{ right: 12, bottom: 40, background: 'var(--navy)', color: '#fff' }}>{s.pickupEta} min · Driver away</div> : undefined} />
        <div className="track-top" style={{ top: 8 }}><LiveTrackingStatus status={s.status} detail={detail} stale={stale} /></div>
      </div>

      <div className="sheet-panel">
        {pre && s.driverArrived && !s.collected && <GraceBar arrivedAt={s.driverArrivedAt} who="passenger" />}
        {pre ? (
          <div className="eta-row">
            <MetricTile icon="car" label="Driver ETA" value={s.driverArrived ? 'Arrived' : s.driverLocation ? `${s.pickupEta} min` : '—'} tone="teal" />
            <MetricTile icon="walk" label="Your walk" value={s.passengerAtPickup ? 'There' : `${s.walkingEta} min`} tone="blue" />
            <MetricTile icon="pin" label="To pickup" value={s.passengerAtPickup ? '0m' : formatDistance(s.walkingDistanceM)} />
          </div>
        ) : (
          <div className="eta-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <MetricTile icon="flag" label="ETA destination" value={s.status === 'destination-reached' || s.status === 'ended' ? 'Arrived' : `${s.destinationEta} min`} sub={`Due ~${match.arrivalEta}`} tone="teal" />
            <MetricTile icon="route" label="Current route" value="Normal route" sub={`To ${match.destination.label}`} />
          </div>
        )}

        <div className="row-flex">
          <Avatar first={d.firstName} last={d.lastInitial} hue={d.avatarHue} size={44} src={d.avatarUrl} />
          <div className="grow">
            <strong>{d.firstName} {d.lastInitial}.</strong>
            <p className="small muted">{d.vehicle.make} {d.vehicle.model} · {d.vehicle.colour} · <span className="nowrap">{d.vehicle.registrationSummary}</span></p>
          </div>
          {d.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}
          <VerificationBadge status={d.verification.identity} label="Identity" />
        </div>
        {pre && !state.lowData && <VehiclePhotoCard vehicle={d.vehicle} compact />}

        {s.status==='both-at-pickup'&&<Banner tone="info">Your driver confirms collection for your pickup.</Banner>}
        {(s.status === 'driver-approaching' || s.status === 'passenger-approaching') && !s.passengerAtPickup && (
          <div className="row-flex">
            <div className="grow"><SecondaryButton size="sm" icon="pin" onClick={() => {void feed.markPassengerAtPickup().catch(e=>toast(e instanceof Error?e.message:'Could not update your pickup status','error'))}}>I’m at the pickup</SecondaryButton></div>
            <NavigateButton destination={match.pickup.location} mode="walking" label="Walk there" />
          </div>
        )}
        {s.status === 'destination-reached' && <LiftyButton onClick={async () => {const ok=await feed.endSharing();if(ok!==false)nav('/p/complete'+((match as Match&{liveInstance?:CommuteInstance}).liveInstance?`?instance=${(match as Match&{liveInstance:CommuteInstance}).liveInstance.id}`:''), { replace: true })}}>End my sharing</LiftyButton>}
        {s.status === 'ended' && <LiftyButton onClick={() => nav(s.noShow ? '/p/commute' : '/p/complete'+((match as Match&{liveInstance?:CommuteInstance}).liveInstance?`?instance=${(match as Match&{liveInstance:CommuteInstance}).liveInstance.id}`:''), { replace: true })}>{s.noShow ? 'Back to my commute' : 'View summary'}</LiftyButton>}

        <div className="actions-row">
          <button className="action" onClick={() => nav(`/chat/${match.id}`, { state: { name: `${d.firstName} ${d.lastInitial}.` } })}><span className="a-ic"><Icon name="message" /></span>Message</button>
          <CallButton name={d.firstName} chatId={match.id} />
          <button className="action" onClick={async()=>{try{const result=await shareCommute(`Lifty: ${d.firstName} ${d.lastInitial}. · ${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model} · ${d.vehicle.registrationSummary} · ${match.pickup.label} to ${match.destination.label}`);toast(result==='copied'?'Details copied':'Commute shared','success')}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))toast('Could not share','error')}}}><span className="a-ic"><Icon name="share" /></span>Share</button>
          <button className={`action ${pre ? '' : 'danger'}`} onClick={() => (pre ? nav('/safety?report=1') : setSafety(true))}><span className="a-ic"><Icon name={pre ? 'alert' : 'shield'} /></span>{pre ? 'Report' : 'Safety'}</button>
        </div>
      </div>

      <BottomSheet open={privacy} onClose={() => setPrivacy(false)} title="Your location & privacy">
        <div className="stack-3">
          <p className="muted">Live locations are only shared during your scheduled commute window — starting 20 minutes before pickup and ending when you reach your destination.</p>
          <ul className="stack-2 small">
            <li>• {d.firstName} sees your walking progress to the pickup point only.</li>
            <li>• Your home address and phone number are never shown.</li>
            <li>• Sharing stops automatically when the commute ends. Safety breadcrumbs are deleted after 30 days.</li>
          </ul>
          <Banner tone="info">Current state: <strong>{trackingTitle(s.status)}</strong></Banner>
          <LiftyButton onClick={() => setPrivacy(false)}>Got it</LiftyButton>
        </div>
      </BottomSheet>
      <BottomSheet open={safety} onClose={() => setSafety(false)} title="Safety">
        <div className="stack-3">
          <SecondaryButton icon="share" onClick={() => { void shareInvite(toast); setSafety(false) }}>Share live commute</SecondaryButton>
          <SecondaryButton icon="phone" onClick={() => { window.location.href = 'tel:10111' }}>Call emergency services (10111)</SecondaryButton>
          <SecondaryButton icon="alert" tone="danger" onClick={() => nav('/safety?report=1')}>Report an incident</SecondaryButton>
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Commute completed ---------- */
export function Complete(){
 const nav=useNavigate(),selected=new URLSearchParams(useLocation().search).get('instance')
 const {state}=useApp(),q=useAsync(()=>api.listHistory(),[state.user?.id])
 const trip=selected?q.data?.find(t=>t.id===selected):q.data?.find(t=>['completed','missed','cancelled'].includes(t.status))
 // The driver confirms completion, which can land a few seconds after the rider reaches the destination: pick it up by
 // itself instead of leaving the rider to keep tapping Refresh. Earlier results stay on screen while it re-checks.
 const waiting=!!trip&&!['completed','missed','cancelled'].includes(trip.status)
 useEffect(()=>{if(!waiting)return;const t=setInterval(q.retry,8000);return()=>clearInterval(t)},[waiting,q.retry])
 return <Screen><ScreenHeader title="Commute summary" onBack={()=>nav('/p/home')}/><ScreenBody>
  {q.loading&&!q.data?<CardSkeleton/>:q.error&&!q.data?<ErrorState message={q.error.message} onRetry={q.retry}/>:trip?<div className="stack-3"><h1 className="h2">{trip.status==='completed'?'Commute completed':trip.status==='missed'?'Commute missed':trip.status==='cancelled'?'Commute cancelled':'Awaiting driver completion'}</h1>
   <Card><KV icon="user" k="Driver" v={trip.driverName}/><KV icon="route" k="Route" v={`${trip.pickupLabel} → ${trip.destinationLabel}`}/><KV icon="calendar" k="Date" v={formatDate(trip.date)}/><KV icon="clock" k="Trip status" v={trip.status}/></Card>
   {trip.canRate&&!trip.rated&&<LiftyButton onClick={()=>nav(`/p/rate?instance=${trip.id}`)}>Rate this commute</LiftyButton>}
   {!['completed','missed','cancelled'].includes(trip.status)&&<Banner tone="info" action={<TextButton onClick={q.retry}>Refresh</TextButton>}>Your driver confirms the completed trip before a rating is available.</Banner>}
  </div>:<Banner tone="info">Your confirmed commute records appear in history.</Banner>}
 </ScreenBody><ScreenFooter><SecondaryButton onClick={()=>nav('/history')}>Commute history</SecondaryButton><SecondaryButton onClick={()=>nav('/p/home')}>Back to home</SecondaryButton></ScreenFooter></Screen>
}
/* ---------- 20 Rate driver ---------- */
const TAGS = ['Punctuality', 'Safe Driving', 'Communication', 'Clean Vehicle', 'Respectful', 'Reliable']
export function RateDriver() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update } = useApp()
  const selected=new URLSearchParams(useLocation().search).get('instance')
  const history=useAsync(()=>api.listHistory(),[state.user?.id])
  const trip = selected ? history.data?.find(h => h.id === selected) : history.data?.find(h => h.canRate && !h.rated)
  const eligible = !!trip && trip.canRate && !trip.rated && trip.status === 'completed'
  const { data: driver, loading: driverLoading, error:driverError, retry:retryDriver } = useAsync(() =>
    eligible && trip ? api.getDriver(trip.driverId) : Promise.resolve(null), [state.user?.id, trip?.id, eligible])
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => { setStars(0); setTags([]); setComment('') }, [trip?.id])
  const submit = async () => {
    if (!driver || !eligible || !trip || driver.id !== trip.driverId) return
    setSending(true)
    try {
      await api.submitRating({ driverId: driver.id, stars, tags, comment, legId: trip.legId,instanceId:trip.id })
      update({ ratedMatchIds: [...state.ratedMatchIds, trip.id] })
      resetTrackingFeed(trip.legId)
      toast('Thanks — your feedback helps the community', 'success')
      nav('/p/home', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not submit', 'error')
    } finally {
      setSending(false)
    }
  }
  return (
    <Screen>
      <ScreenHeader title="Rate Your Driver" onBack={() => nav('/p/home')} />
      <ScreenBody>
        {driverError && <ErrorState message={driverError.message} onRetry={retryDriver} />}
        {(history.loading || driverLoading) && <CardSkeleton />}
        {history.error && <ErrorState message={history.error.message} onRetry={history.retry} />}
        {!history.loading && !eligible && <Banner tone="info">Choose an unrated completed commute from your history.</Banner>}
        {driver && (
          <div className="center stack-2" style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', placeItems: 'center' }}><Avatar first={driver.firstName} last={driver.lastInitial} hue={driver.avatarHue} size={76} src={driver.avatarUrl} /></div>
            <h2 className="h3">{driver.firstName} {driver.lastInitial}.</h2>
            <p className="small muted">{driver.vehicle.make} {driver.vehicle.model} · {driver.vehicle.colour}</p>
            <p className="muted">How was your experience with {driver.firstName}? Your feedback helps build a trusted community.</p>
          </div>
        )}
        <StarInput value={stars} onChange={setStars} />
        <p className="eyebrow" style={{ margin: '24px 0 10px' }}>What went well?</p>
        <div className="chips">
          {TAGS.map((t) => (
            <button key={t} type="button" className={`chip ${tags.includes(t) ? 'on' : ''}`} aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
          ))}
        </div>
        <p className="eyebrow" style={{ margin: '24px 0 10px' }}>Anything else? (optional)</p>
        <textarea className="field-area" aria-label="Comment" placeholder="Add a comment for the community…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={400} />
      </ScreenBody>
      <ScreenFooter><LiftyButton disabled={(!eligible || history.loading || !!history.error || driverLoading || driver?.id !== trip?.driverId) || stars === 0 || !driver} loading={sending} onClick={submit}>Submit Review</LiftyButton></ScreenFooter>
    </Screen>
  )
}

/* ---------- 19 Driver profile (safe public info only) ---------- */
export function DriverPublicProfile() {
  const nav = useNavigate()
  const { id = '' } = useParams()
  const { data: d, loading, error, retry } = useAsync(() => api.getDriver(id), [id])
  return (
    <Screen>
      <ScreenHeader title="Driver Profile" onBack={() => nav(-1)} />
      <ScreenBody>
        {loading ? <CardSkeleton /> : error || !d ? <ErrorState message={error?.message ?? 'Not found'} offline={isOffline(error)} onRetry={retry} /> : (
          <>
            <Card>
              <div className="row-flex">
                <Avatar first={d.firstName} last={d.lastInitial} hue={d.avatarHue} size={72} src={d.avatarUrl} />
                <div className="grow">
                  <h2 className="h3" style={{ fontSize: 22 }}>{d.firstName} {d.lastInitial}.</h2>
                  <Rating value={d.rating} count={d.ratingCount} />
                  <p className="small muted">Member since {formatDate(d.memberSince).replace(/^\w+, \d+ /, '')}</p>
                </div>
              </div>
              <div className="row-flex wrap" style={{ marginTop: 12 }}>
                {d.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}
                <VerificationBadge status={driverIsVerified(d.verification)?'verified':Object.values(d.verification).includes('expired')?'expired':'pending'} label="Documents reviewed" />
                <VerificationBadge label="Verified Vehicle" status={d.verification.vehicle} />
                <StatusBadge tone="info" icon="clock">{d.reliability == null ? 'No trip history yet' : `${d.reliability}% reliable`}</StatusBadge>
              </div>
            </Card>
            <div style={{ marginTop: 12 }}><VehiclePhotoCard vehicle={d.vehicle} seatsAvailable={d.seatsAvailable || undefined} /></div>
            {d.about && (
              <>
                <SectionTitle>About</SectionTitle>
                <Card><p>{d.about}</p>{d.routeSummary && <p className="small muted" style={{ marginTop: 6 }}><Icon name="route" size={14} /> {d.routeSummary}</p>}</Card>
              </>
            )}
            <div className="metrics">
              <MetricTile icon="car" label="Completed trips" value={d.completedTrips ?? 0} />
              <MetricTile icon="star" label="Ratings" value={d.ratingCount} tone="teal" />
              <MetricTile icon="clock" label="Reliability" value={d.reliability == null ? 'No history yet' : `${d.reliability}%`} tone="blue" />
            </div>
            <SectionTitle>Recent Reviews</SectionTitle>
            {d.reviews.length === 0 ? <p className="small muted">No reviews yet.</p> : (
              <div className="stack-3">
                {d.reviews.map((r) => (
                  <Card key={r.id}>
                    <div className="row-flex between"><strong>{r.author}</strong><Rating value={r.stars} size="sm" /></div>
                    {r.comment && <p className="small" style={{ margin: '6px 0' }}>“{r.comment}”</p>}
                    <div className="chips">{r.tags.map((t) => <StatusBadge key={t} tone="teal">{t}</StatusBadge>)}</div>
                  </Card>
                ))}
              </div>
            )}
            <div style={{ height: 12 }} />
            <Banner tone="info" icon="lock"><span className="small">For safety, Lifty never shows a driver’s address, phone number, ID, licence number, documents or bank details. Verification status is shown instead.</span></Banner>
            <div style={{ height: 8 }} />
          </>
        )}
      </ScreenBody>
    </Screen>
  )
}
