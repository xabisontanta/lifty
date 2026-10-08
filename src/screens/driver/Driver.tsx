import { useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { DestinationMarker, MapView, PickupMarker, RouteLine } from '@/components/map/MapView'
import { MatchMap } from '@/components/match/MatchMap'
import { KV, LiveTrackingStatus, MetricTile, PassengerCard, PaymentBadge, ScheduleCard } from '@/components/match/cards'
import { CallButton, GraceBar, NavigateButton, useGrace, VehiclePhotoCard } from '@/components/ui/extras'
import { Icon } from '@/components/ui/Icon'
import {
  Avatar, Banner, BottomNavigation, BottomSheet, Card, CardSkeleton, EmptyState, ErrorState, LiftyButton, ProfileRow, Rating, Screen, ScreenBody, ScreenFooter,
  ScreenHeader, SecondaryButton, SectionTitle, StatusBadge, TextButton, Toggle, VerificationBadge, IconButton, useToast, TextField,
} from '@/components/ui/kit'
import { DRIVERS, MATCHES } from '@/data/mock'
import type { Match } from '@/domain/types'
import { formatDays, greeting, rand, timeAgo } from '@/lib/format'
import { nextCommute } from '@/lib/club'
import { useAsync, useOnline } from '@/hooks/useAsync'
import { useTracking } from '@/hooks/useTracking'
import { useDriverLegs } from '@/hooks/useClubs'
import { api, ApiError, isLive, type CommuteInstance } from '@/services/api'
import { instanceToMatch } from '@/services/liveApi'
import { resetTrackingFeed } from '@/services/tracking'
import { currentUserId } from '@/services/supabase'
import { useApp } from '@/store/app'
import { shareCommute } from '@/services/share'
import { DevTools } from '../shared/Shared'
import { NoCommuteNow } from '../passenger/Flow'

const isOffline = (e: Error | null) => e instanceof ApiError && e.code === 'offline'

export function DriverTabs() {
  const { state } = useApp()
  const { data } = useAsync(() => api.listIncomingRequests(), [state.driver.members.length])
  const pending = data?.filter((r) => r.status === 'pending').length ?? 0
  return (
    <Screen>
      <Outlet />
      <BottomNavigation
        items={[
          { to: '/d/home', label: 'Home', icon: 'home' },
          { to: '/d/route', label: 'My Route', icon: 'route' },
          { to: '/d/requests', label: 'Requests', icon: 'users', badge: pending || undefined },
          { to: '/d/inbox', label: 'Messages', icon: 'inbox' },
          { to: '/d/profile', label: 'Profile', icon: 'user' },
        ]}
      />
    </Screen>
  )
}

/* ---------- Driver home ---------- */
export function DriverHome() {
  const nav = useNavigate()
  const { state } = useApp()
  const { user, driver } = state
  const { legs } = useDriverLegs()
  const morning = legs.find((l) => l.direction === 'to_work') ?? legs[0]
  const members = morning?.members ?? []
  const next = morning ? nextCommute(morning.days, morning.departureTime, state.exceptions) : null
  const { data: reqs } = useAsync(() => api.listIncomingRequests(), [members.length])
  const pending = reqs?.filter((r) => r.status === 'pending') ?? []
  const income = legs.reduce((sum, l) => sum + l.members.length * l.monthlyContribution, 0)
  const verified = isLive()?Object.values(state.verification).every(v=>v==='verified'):Object.values(driver.docs).every(Boolean)
  return (
    <ScreenBody>
      <div className="home-greeting">
        <div className="row-flex">
          <Avatar first={user?.firstName ?? 'D'} last={user?.lastInitial} hue={user?.avatarHue ?? 24} size={46} src={state.avatarUrl} />
          <div><p className="muted small">{greeting()},</p><h1>{user?.firstName ?? 'there'}</h1></div>
        </div>
        <IconButton icon="bell" label="Requests and updates" onClick={() => nav('/d/inbox')} />
      </div>

      {!verified && <div style={{ marginBottom: 12 }}><Banner tone="warning" icon="clock" action={<TextButton onClick={() => nav('/onboarding/driver/3')}>Finish</TextButton>}><strong>Verification in progress</strong>Your latest ID, licence, registration and insurance must be approved before new passengers can match with you.</Banner></div>}

      <Card className="navy" as="section">
        <div className="row-flex between"><span className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Today’s commute</span><StatusBadge tone="success">{members.length} passenger{members.length === 1 ? '' : 's'}</StatusBadge></div>
        <h2 className="h3" style={{ margin: '8px 0 2px' }}>{(morning?.originLabel ?? driver.commute.origin).split(',')[0]} → {(morning?.destinationLabel ?? driver.commute.destination).split(',')[0]}</h2>
        <p style={{ color: 'rgba(255,255,255,.75)' }}>{next ? next.label : 'No upcoming commute'}{morning ? ` · ${formatDays(morning.days)}` : ''}</p>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary btn-block" onClick={() => nav('/d/today')} disabled={members.length === 0}><Icon name="navigation" size={20} /> Open today’s commute</button>
        </div>
      </Card>

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <MetricTile icon="seat" label="Seats open" value={morning?.seatsOpen ?? driver.seatsOpen} tone="teal" />
        <MetricTile icon="users" label="Requests" value={pending.length} tone="amber" />
        <MetricTile icon="wallet" label="Monthly" value={rand(income)} tone="blue" />
      </div>

      {pending.length > 0 && (
        <>
          <SectionTitle action={<TextButton onClick={() => nav('/d/requests')}>See all</TextButton>}>Passengers asking to join</SectionTitle>
          <div className="stack-3">{pending.slice(0, 2).map((r) => <PassengerCard key={r.id} req={r} onClick={() => nav(`/d/request/${r.id}`)} />)}</div>
        </>
      )}
      <SectionTitle>Manage</SectionTitle>
      <div className="list">
        <ProfileRow icon="calendar" title="Not driving?" subtitle="Tell your passengers in one tap" onClick={() => nav('/d/exceptions')} />
        <ProfileRow icon="seat" title="Seat availability" subtitle={`${morning?.seatsOpen ?? driver.seatsOpen} of ${driver.vehicle.seats} seats open`} onClick={() => nav('/d/seats')} />
        <ProfileRow icon="wallet" title="Contributions" subtitle="Who has paid this month" onClick={() => nav('/d/contributions')} />
        <ProfileRow icon="shield" title="Safety Centre" onClick={() => nav('/safety')} />
      </div>
    </ScreenBody>
  )
}

/* ---------- My route + passenger management ---------- */
export function MyRoute() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, updateDriver } = useApp()
  const d = state.driver
  const { legs, loading, error, retry } = useDriverLegs()
  const [legIdx, setLegIdx] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const leg = legs[legIdx]
  const member = leg?.members.find((m) => m.id === sel)
  if (loading) return <ScreenBody><div className="title-block"><h1>My Route</h1></div><CardSkeleton /></ScreenBody>
  if (error) return <ScreenBody><ErrorState message={error.message} offline={isOffline(error)} onRetry={retry} /></ScreenBody>
  if (!leg) return <ScreenBody><div className="title-block"><h1>My Route</h1></div><EmptyState icon="route" title="No route yet" body="Finish your driver set-up so passengers on your route can find you." action={<LiftyButton block={false} onClick={() => nav('/onboarding/driver/2')}>Set up my commute</LiftyButton>} /></ScreenBody>
  return (
    <ScreenBody>
      <div className="title-block"><h1>My Route</h1><p>The commute you already make — and who shares it.</p></div>
      {legs.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="Commute leg" style={{ marginBottom: 12 }}>
          {legs.map((l, i) => <button key={l.legId} type="button" role="radio" aria-checked={i === legIdx} className={i === legIdx ? 'on' : ''} onClick={() => setLegIdx(i)}>{l.direction === 'to_work' ? 'Morning · to work' : 'Evening · home'}</button>)}
        </div>
      )}
      <div className="map-frame">
        <MapView fit={leg.route} height={200} padding={36} label="Your regular commute route">
          <RouteLine path={leg.route} animate={false} />
          <PickupMarker at={leg.route[0]} label="Start" />
          <DestinationMarker at={leg.route[leg.route.length - 1]} label={leg.destinationLabel.split(',')[0]} />
        </MapView>
      </div>
      <div style={{ marginTop: 12 }}>
        <ScheduleCard days={leg.days} pickupTime={`Depart ${leg.departureTime}`} pickup={leg.originLabel} destination={leg.destinationLabel} nextLabel={nextCommute(leg.days, leg.departureTime, state.exceptions)?.label} />
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        <ProfileRow icon="gauge" title="Maximum detour" subtitle={`${leg.maxDeviationMin} min`} onClick={() => nav('/d/settings')} />
        <ProfileRow icon="seat" title="Seat availability" subtitle={`${leg.seatsOpen} of ${d.vehicle.seats} open`} onClick={() => nav('/d/seats')} />
        <ProfileRow icon="calendar" title="Schedule exceptions" onClick={() => nav('/d/exceptions')} />
      </div>

      <SectionTitle>Passengers</SectionTitle>
      {leg.members.length === 0 ? (
        <EmptyState icon="users" title="No passengers yet" body="Accept a request to start sharing your commute." action={<LiftyButton block={false} onClick={() => nav('/d/requests')}>See requests</LiftyButton>} />
      ) : (
        <div className="list">
          {leg.members.map((m) => (
            <button key={m.id} className="row" onClick={() => setSel(m.id)}>
              <Avatar first={m.firstName} last={m.lastInitial} hue={m.avatarHue} size={40} src={m.avatarUrl} />
              <span className="row-text"><span className="row-title">{m.firstName} {m.lastInitial}.</span><span className="row-sub">{m.pickupLabel} · {m.pickupTime}</span></span>
              <PaymentBadge status={m.paymentStatus} />
            </button>
          ))}
        </div>
      )}
      <BottomSheet open={!!member} onClose={() => setSel(null)} title={member ? `${member.firstName} ${member.lastInitial}.` : ''}>
        <div className="stack-3">
          <SecondaryButton icon="message" onClick={() => nav(`/chat/${leg.legId}`, { state: { name: 'Lift club' } })}>Message lift club</SecondaryButton>
          <SecondaryButton icon="calendar" onClick={() => nav('/d/exceptions')}>Passenger absent today</SecondaryButton>
          <SecondaryButton tone="danger" icon="trash" onClick={async () => {
            if (!member) return
            try {
              await api.removeMember(leg.legId, member.id)
              updateDriver({ members: d.members.filter((m) => m.id !== member.id), seatsOpen: Math.min(d.vehicle.seats, d.seatsOpen + 1) })
              setSel(null)
              retry()
              toast(`${member.firstName} removed from your lift club`)
            } catch (e) { toast(e instanceof Error ? e.message : 'Could not remove', 'error') }
          }}>Remove from lift club</SecondaryButton>
        </div>
      </BottomSheet>
    </ScreenBody>
  )
}

/* ---------- Seats ---------- */
export function Seats() {
  const nav = useNavigate()
  const { state, updateDriver } = useApp()
  const d = state.driver
  const max = d.vehicle.seats - d.members.length
  return (
    <Screen>
      <ScreenHeader title="Seat availability" onBack={() => nav(-1)} />
      <ScreenBody>
        <Card>
          <p className="eyebrow">Seats you’re offering</p>
          <div className="row-flex between" style={{ marginTop: 10 }}>
            <button className="icon-btn" aria-label="Offer one fewer seat" disabled={d.seatsOpen <= 0} onClick={() => updateDriver({ seatsOpen: Math.max(0, d.seatsOpen - 1) })}><Icon name="minus" /></button>
            <div className="center"><p className="price-lg">{d.seatsOpen}</p><p className="small muted">open · {d.members.length} taken · {d.vehicle.seats} total</p></div>
            <button className="icon-btn" aria-label="Offer one more seat" disabled={d.seatsOpen >= max} onClick={() => updateDriver({ seatsOpen: Math.min(max, d.seatsOpen + 1) })}><Icon name="plus" /></button>
          </div>
        </Card>
        <p className="muted small" style={{ marginTop: 12 }}>When you’re full, passengers can’t request to join until a seat opens up.</p>
      </ScreenBody>
    </Screen>
  )
}

/* ---------- Incoming requests ---------- */
export function Requests() {
  const nav = useNavigate()
  const { state } = useApp()
  const { data, loading, error, retry } = useAsync(() => api.listIncomingRequests(), [state.driver.members.length])
  const pending = data?.filter((r) => r.status === 'pending') ?? []
  const done = data?.filter((r) => r.status !== 'pending') ?? []
  return (
    <ScreenBody>
      <div className="title-block"><h1>Requests</h1><p>Passengers who’d like to join your lift club.</p></div>
      {loading ? <div className="stack-3"><CardSkeleton /><CardSkeleton /></div> : error ? <ErrorState message={error.message} offline={isOffline(error)} onRetry={retry} /> : (
        <>
          {pending.length === 0 ? <EmptyState icon="users" title="No pending requests" body="When a passenger on a compatible route asks to join, you’ll see exactly how it affects your commute." /> : <div className="stack-3">{pending.map((r) => <PassengerCard key={r.id} req={r} onClick={() => nav(`/d/request/${r.id}`)} />)}</div>}
          {done.length > 0 && (<><SectionTitle>Earlier</SectionTitle><div className="list">{done.map((r) => <ProfileRow key={r.id} title={`${r.passenger.firstName} ${r.passenger.lastInitial}.`} subtitle={r.pickup.label} right={<StatusBadge tone={r.status === 'accepted' ? 'success' : 'neutral'}>{r.status === 'accepted' ? 'Accepted' : 'Declined'}</StatusBadge>} />)}</div></>)}
        </>
      )}
    </ScreenBody>
  )
}

/* ---------- Request detail: accept / decline with commute impact ---------- */
export function RequestDetail() {
  const nav = useNavigate()
  const toast = useToast()
  const { id = '' } = useParams()
  const { state, updateDriver } = useApp()
  const { data, loading, error, retry } = useAsync(async () => (await api.listIncomingRequests()).find((r) => r.id === id) ?? Promise.reject(new ApiError('We couldn’t find that request.', 'not-found')), [id])
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [declineSheet, setDeclineSheet] = useState(false)
  const full = !isLive() && state.driver.seatsOpen <= 0

  const respond = async (decision: 'accept' | 'decline') => {
    if (!data) return
    setBusy(decision)
    try {
      await api.respondToRequest(data.id, decision)
      if (decision === 'accept') {
        updateDriver({
          members: [...state.driver.members, { id: data.passenger.id, firstName: data.passenger.firstName, lastInitial: data.passenger.lastInitial, avatarHue: data.passenger.avatarHue, role: 'passenger', paymentStatus: 'upcoming' }],
          seatsOpen: Math.max(0, state.driver.seatsOpen - 1),
        })
        toast(`${data.passenger.firstName} is now in your lift club`, 'success')
      } else toast('Request declined — we’ll let them know kindly')
      nav('/d/requests', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not respond', 'error')
    } finally {
      setBusy(null)
      setDeclineSheet(false)
    }
  }
  const p = data?.passenger
  const newMin = data ? data.currentCommuteMinutes + data.deviationMinutes : 0
  const ok = data ? data.deviationMinutes <= state.driver.commute.maxDeviationMin : true
  return (
    <Screen>
      <ScreenHeader title="Passenger request" onBack={() => nav(-1)} />
      <ScreenBody className="flush">
        {loading ? <div style={{ padding: 16 }}><CardSkeleton /></div> : error || !data || !p ? <ErrorState message={error?.message ?? 'Not found'} offline={isOffline(error)} onRetry={retry} /> : (
          <div style={{ padding: '0 16px' }}>
            <div className="map-frame">
              <MatchMap geometry={data.geometry} pickup={data.pickup.location} destination={data.destination.location} pickupLabel={data.pickup.label} passengerLabel={p.firstName} passenger={data.geometry.walking[0]} height={280} deviationText={`+${data.deviationMinutes} min`} focus="pickup" inset padding={{ top: 56, right: 40, bottom: 56, left: 40 }} />
            </div>
            <Card style={{ marginTop: 12 }}>
              <div className="row-flex">
                <Avatar first={p.firstName} last={p.lastInitial} hue={p.avatarHue} size={56} />
                <div className="grow">
                  <h2 className="h3">{p.firstName} {p.lastInitial}.</h2>
                  <div className="row-flex"><Rating value={p.rating} count={p.ratingCount} size="sm" />{p.verified && <VerificationBadge label="Verified" />}</div>
                  <p className="small muted">{p.reliability}% reliable · pickup at {data.pickup.label}</p>
                </div>
              </div>
            </Card>

            <SectionTitle>Impact on your commute</SectionTitle>
            <Card>
              <div className="row-flex between" style={{ textAlign: 'center' }}>
                <div className="grow"><p className="small muted">Current commute</p><p className="price">{data.currentCommuteMinutes} min</p></div>
                <Icon name="chevron" size={18} className="row-chev" />
                <div className="grow"><p className="small muted">Pickup deviation</p><p className="price" style={{ color: ok ? '#b45309' : 'var(--error)' }}>+{data.deviationMinutes} min</p></div>
                <Icon name="chevron" size={18} className="row-chev" />
                <div className="grow"><p className="small muted">New commute</p><p className="price">{newMin} min</p></div>
              </div>
              <div className="metrics two">
                <MetricTile icon="route" label="Route overlap" value={`${data.routeOverlap}%`} tone="teal" />
                <MetricTile icon="navigation" label="Extra distance" value={`${data.additionalDistanceKm} km`} tone="amber" />
              </div>
              {!ok && <div style={{ marginTop: 10 }}><Banner tone="warning">This is above your {state.driver.commute.maxDeviationMin}-min detour limit.</Banner></div>}
            </Card>

            <SectionTitle>Their commute</SectionTitle>
            <Card>
              <div className="kv-list" style={{ marginTop: 0 }}>
                <KV icon="pin" k="Pickup point" v={data.pickup.label} />
                <KV icon="flag" k="Destination" v={data.destination.label} />
                {data.specificDates?.length ? (
                  <KV icon="calendar" k="Booked dates" v={`${data.specificDates.length} day${data.specificDates.length === 1 ? '' : 's'}: ${data.specificDates.slice(0, 4).map((d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })).join(', ')}${data.specificDates.length > 4 ? '…' : ''}`} />
                ) : (
                  <KV icon="calendar" k="Days" v={`${formatDays(data.days)}${data.startDate ? ` · from ${new Date(`${data.startDate}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}`} />
                )}
                <KV icon="clock" k="Arrive by" v={data.arriveBy} />
                <KV icon="walk" k="Walking flexibility" v={data.walkingFlexibilityM ? `Up to ${data.walkingFlexibilityM}m` : 'Pickup at home'} />
                <KV icon="wallet" k="Contribution to you" v={`${rand(data.monthlyContribution)}/month`} strong />
              </div>
            </Card>
            <p className="small muted" style={{ marginTop: 10 }}><Icon name="lock" size={12} /> You see their pickup point only — never their home address or phone number.</p>
            {full && <div style={{ marginTop: 12 }}><Banner tone="warning">You have no open seats. Open a seat to accept.</Banner></div>}
            <div style={{ height: 24 }} />
          </div>
        )}
      </ScreenBody>
      {data && data.status === 'pending' && (
        <ScreenFooter>
          <LiftyButton loading={busy === 'accept'} disabled={!!busy || full} onClick={() => respond('accept')}>Accept Passenger</LiftyButton>
          <SecondaryButton disabled={!!busy} onClick={() => setDeclineSheet(true)}>Decline</SecondaryButton>
        </ScreenFooter>
      )}
      <BottomSheet open={declineSheet} onClose={() => setDeclineSheet(false)} title="Decline this request?">
        <div className="stack-3">
          <p className="muted">{p?.firstName} will be told the arrangement isn’t a fit — no reason shown. They can keep searching.</p>
          <LiftyButton loading={busy === 'decline'} onClick={() => respond('decline')}>Yes, decline</LiftyButton>
          <SecondaryButton onClick={() => setDeclineSheet(false)}>Keep reviewing</SecondaryButton>
        </div>
      </BottomSheet>
    </Screen>
  )
}

/* ---------- Today's commute / live passenger tracking ---------- */
export function DriverToday() {
  const nav = useNavigate()
  const live = isLive()
  const q = useAsync<CommuteInstance | null>(() => (live ? api.getCurrentInstance() : Promise.resolve(null)), [live])
  if (!live) return <DriverTrackingBody key={MATCHES[0].id} match={MATCHES[0]} back={() => nav(-1)} />
  if (q.loading) return <Screen><ScreenHeader title="Today’s commute" onBack={() => nav(-1)} /><ScreenBody><CardSkeleton /></ScreenBody></Screen>
  if (q.error) return <Screen><ScreenHeader title="Today’s commute" onBack={() => nav(-1)} /><ScreenBody><ErrorState message={q.error.message} onRetry={q.retry} /></ScreenBody></Screen>
  if (!q.data) return <NoCommuteNow title="Today’s commute" />
  const match = instanceToMatch(q.data, currentUserId ?? undefined)
  const rider = q.data.riders.find((r) => r.status !== 'absent') ?? q.data.riders[0]
  return <DriverTrackingBody key={q.data.id} match={match} back={() => nav(-1)} riderName={rider ? { first: rider.firstName, last: rider.lastInitial } : undefined} />
}

function DriverTrackingBody({ match, back, riderName }: { match: Match; back: () => void; riderName?: { first: string; last: string } }) {
  const nav = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const { state } = useApp()
  const { snapshot: s, connection, stale, feed } = useTracking(match, { lowData: state.lowData })
  const grace = useGrace(s.driverArrivedAt)
  const pax = state.driver.members[state.driver.members.length - 1]
  const first = riderName?.first ?? pax?.firstName ?? 'Passenger'
  const paxName = riderName ? `${riderName.first} ${riderName.last}.` : pax ? `${pax.firstName} ${pax.lastInitial}.` : 'Your passenger'
  const feedError = (feed as { getError?: () => string | null }).getError?.()

  const phase = s.noShow ? 5 : s.collected
    ? s.status === 'destination-reached' || s.status === 'ended' ? 4 : 3
    : s.passengerAtPickup && s.driverArrived ? 2 : s.driverArrived ? 1 : 0
  const title = ['Heading to Pickup', 'Driver Arrived', 'Passenger at Pickup', 'On Route', 'Commute Complete', 'Passenger no-show'][phase]
  const pre = !s.collected && !s.noShow

  const detail = (() => {
    if (s.noShow) return `${first} was marked as a no-show. Continue to work.`
    if (s.collected) return s.status === 'destination-reached' || s.status === 'ended' ? 'Destination reached' : `Arriving in about ${s.destinationEta} min`
    if (s.passengerAtPickup && s.driverArrived) return `${first} is at the pickup point`
    if (s.passengerAtPickup) return `${first} is waiting at the pickup point`
    return s.passengerLocation ? `${first} is ${s.walkingEta} min from pickup` : `Waiting for ${first}’s location…`
  })()

  return (
    <Screen>
      <ScreenHeader title={title} subtitle={`Pickup · ${match.pickup.label}`} onBack={back} />
      {(stale || !online || feedError) && (
        <div style={{ padding: '0 16px 8px' }}>
          <Banner tone="warning" icon={online ? 'alert' : 'wifiOff'} action={<TextButton onClick={() => { feed.setLinkDown(false); feed.restart(); toast('Reconnecting…') }}>Retry</TextButton>}>
            <strong>{!online ? 'Connection lost' : feedError ?? 'Passenger location temporarily unavailable'}</strong>
            {connection.lastUpdate ? `Last updated ${timeAgo(connection.lastUpdate)}.` : 'Showing the last known location.'}
          </Banner>
        </div>
      )}
      <div className="map-fill">
        <MatchMap geometry={{ ...match.geometry, walking: s.walkingGeometry.length ? s.walkingGeometry : match.geometry.walking }} pickup={match.pickup.location} destination={match.destination.location} pickupLabel={match.pickup.label} passengerLabel={first} passenger={pre ? s.passengerLocation : null} driver={s.driverLocation} focus={pre ? 'pickup' : 'ride'} showWalking={pre} showDeviation={pre} height="100%" stale={stale} animate={false} padding={{ top: 130, right: 44, bottom: 56, left: 44 }}
          overlay={pre && s.passengerLocation && !s.passengerAtPickup ? <div className="map-chip" style={{ right: 12, bottom: 40 }}><Icon name="walk" size={14} /> {s.walkingEta} min · Walk to pickup</div> : undefined} />
        <div className="track-top" style={{ top: 8 }}><LiveTrackingStatus status={s.status} detail={detail} stale={stale} /></div>
      </div>
      <div className="sheet-panel">
        {pre && s.driverArrived && <GraceBar arrivedAt={s.driverArrivedAt} who="driver" />}
        {pre ? (
          <div className="eta-row">
            <MetricTile icon="walk" label={`${first}’s ETA`} value={s.passengerAtPickup ? 'There' : s.passengerLocation ? `${s.walkingEta} min` : '—'} tone="blue" />
            <MetricTile icon="pin" label="Distance" value={s.passengerAtPickup ? '0m' : `${s.walkingDistanceM}m`} />
            <MetricTile icon="car" label="Your ETA" value={s.driverArrived ? 'Arrived' : `${s.pickupEta} min`} tone="teal" sub={match.driverDeviationMinutes ? `+${match.driverDeviationMinutes} min detour` : undefined} />
          </div>
        ) : (
          <div className="eta-row" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            <MetricTile icon="flag" label="ETA destination" value={phase >= 4 ? 'Arrived' : `${s.destinationEta} min`} tone="teal" />
            <MetricTile icon="users" label="On board" value={s.noShow ? '—' : first} />
          </div>
        )}
        <ol className="pickup-steps" aria-label="Pickup progress">
          {['Heading', 'Arrived', 'At pickup', 'Collected'].map((l, i) => (
            <li key={l} className={i < phase || (i === 0 && phase >= 1) ? 'done' : i === phase ? 'active' : ''}>
              <span>{i < phase ? <Icon name="check" size={12} strokeWidth={3.5} /> : null}</span>
              {l}
            </li>
          ))}
        </ol>
        {phase === 0 && (
          <div className="row-flex">
            <div className="grow"><LiftyButton icon="pin" onClick={() => feed.markDriverArrived()}>I’ve arrived</LiftyButton></div>
            <NavigateButton destination={match.destination.location} waypoint={match.pickup.location} />
          </div>
        )}
        {phase === 1 && (
          <div className="stack-2">
            <SecondaryButton icon="user" onClick={() => feed.markPassengerAtPickup()}>{first} is here</SecondaryButton>
            {grace.expired && <SecondaryButton tone="danger" icon="alert" onClick={() => feed.markNoShow()}>{first} didn’t show — continue</SecondaryButton>}
          </div>
        )}
        {phase === 2 && <LiftyButton icon="check" onClick={() => feed.markCollected()}>{first} collected</LiftyButton>}
        {phase === 3 && <NavigateButton destination={match.destination.location} label="Navigate to work" block />}
        {(phase === 4 || phase === 5) && <LiftyButton onClick={() => { feed.endSharing(); resetTrackingFeed(match.id); nav('/d/home', { replace: true }) }}>Finish commute</LiftyButton>}
        <div className="actions-row">
          <button className="action" onClick={() => nav(`/chat/${match.id}`, { state: { name: paxName } })}><span className="a-ic"><Icon name="message" /></span>Message</button>
          <CallButton name={first} chatId={match.id} />
          <button className="action" onClick={async()=>{try{const result=await shareCommute(`Lifty commute: ${match.pickup.label} to ${match.destination.label}. ${match.driver.firstName}, ${match.driver.vehicle.colour} ${match.driver.vehicle.make} ${match.driver.vehicle.model}, ${match.driver.vehicle.registrationSummary}.`);toast(result==='copied'?'Commute details copied':'Commute shared','success')}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))toast(e instanceof Error?e.message:'Could not share','error')}}}><span className="a-ic"><Icon name="share" /></span>Share</button>
          <button className="action danger" onClick={() => nav('/safety?report=1')}><span className="a-ic"><Icon name="shield" /></span>Safety</button>
        </div>
        <p className="small muted center">{paxName}’s location is shared only until pickup is confirmed.</p>
      </div>
    </Screen>
  )
}

/* ---------- Contributions (tracked in v1) ---------- */
export function Contributions() {
  const nav = useNavigate()
  const toast = useToast()
  const { legs, retry } = useDriverLegs()
  const members = legs.flatMap((l) => l.members.map((m) => ({ ...m, legId: l.legId, amount: l.monthlyContribution, leg: l.direction })))
  const gross = members.reduce((s, m) => s + m.amount, 0)
  return (
    <Screen>
      <ScreenHeader title="Contributions" onBack={() => nav(-1)} />
      <ScreenBody>
        <Card className="navy">
          <p className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Monthly contributions towards your commute</p>
          <p className="price-lg">{rand(gross)}</p>
          <p style={{ color: 'rgba(255,255,255,.75)' }}>{members.length} passenger seat{members.length === 1 ? '' : 's'} across {legs.length} leg{legs.length === 1 ? '' : 's'}</p>
        </Card>
        <SectionTitle>This month</SectionTitle>
        {members.length === 0 ? <p className="muted small">No passengers yet.</p> : (
          <div className="list">
            {members.map((m) => (
              <div key={m.legId + m.id} className="row">
                <Avatar first={m.firstName} last={m.lastInitial} hue={m.avatarHue} size={40} src={m.avatarUrl} />
                <span className="row-text"><span className="row-title">{m.firstName} {m.lastInitial}.</span><span className="row-sub">{rand(m.amount)} / month · {m.leg === 'to_home' ? 'evening' : 'morning'}</span></span>
                {m.paymentStatus === 'paid' ? <PaymentBadge status="paid" /> : (
                  <TextButton onClick={async () => { try { await api.markContributionPaid(m.legId, m.id); toast(`Marked ${m.firstName} as paid`, 'success'); retry() } catch (e) { toast(e instanceof Error ? e.message : 'Could not update', 'error') } }}>Mark paid</TextButton>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 14 }}>Contributions are a fixed monthly share of running costs — not trip fares. For now passengers pay you directly (EFT or cash); mark it here so everyone sees the same status. In-app payouts are coming soon.</p>
      </ScreenBody>
    </Screen>
  )
}

/* ---------- Ratings ---------- */
export function Ratings() {
  const nav = useNavigate()
  const live = isLive()
  const {state}=useApp()
  const { data: me, loading } = useAsync(() => live ? (state.user?api.getDriver(state.user.id):Promise.reject(new Error('Sign in first'))) : Promise.resolve(DRIVERS[0]), [live,state.user?.id])
  return (
    <Screen>
      <ScreenHeader title="Ratings & reviews" onBack={() => nav(-1)} />
      <ScreenBody>
        {loading || !me ? <CardSkeleton /> : (
          <>
            <Card className="center"><p className="price-lg">{me.ratingCount ? me.rating.toFixed(1) : '—'}</p><div style={{ display: 'grid', placeItems: 'center' }}><Rating value={me.rating} count={me.ratingCount} /></div><p className="small muted">Your rating builds trust across the community.</p></Card>
            <SectionTitle>Recent reviews</SectionTitle>
            {me.reviews.length === 0 ? <p className="small muted">No reviews yet — they appear after your first commutes.</p> : (
              <div className="stack-3">
                {me.reviews.map((r) => (
                  <Card key={r.id}><div className="row-flex between"><strong>{r.author}</strong><Rating value={r.stars} size="sm" /></div>{r.comment && <p className="small" style={{ margin: '6px 0' }}>“{r.comment}”</p>}<div className="chips">{r.tags.map((t) => <StatusBadge key={t} tone="teal">{t}</StatusBadge>)}</div></Card>
                ))}
              </div>
            )}
          </>
        )}
      </ScreenBody>
    </Screen>
  )
}

/* ---------- Profile ---------- */
export function DriverProfile() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update, reset } = useApp()
  const [switching, setSwitching] = useState(false)
  const { data: admin } = useAsync(() => api.isAdmin(), [])
  const u = state.user
  const v = state.driver.vehicle
  const allDocs = isLive()?Object.values(state.verification).every(v=>v==='verified'):Object.values(state.driver.docs).every(Boolean)
  return (
    <ScreenBody>
      <div className="title-block"><h1>Profile</h1></div>
      <Card>
        <div className="row-flex">
          <Avatar first={u?.firstName ?? 'D'} last={u?.lastInitial} hue={u?.avatarHue ?? 24} size={64} src={state.avatarUrl} />
          <div className="grow"><h2 className="h3">{u?.fullName ?? 'Your name'}</h2><p className="small muted">{state.phone}</p><div className="row-flex wrap"><StatusBadge tone="teal" icon="car">Driver</StatusBadge><VerificationBadge status={allDocs ? 'verified' : 'pending'} label="Verified Driver" />{!isLive() && <StatusBadge tone="warning">Demo</StatusBadge>}</div></div>
        </div>
      </Card>
      <div style={{ marginTop: 12 }}><VehiclePhotoCard vehicle={{ make: v.make, model: v.model, colour: v.colour, year: Number(v.year), registrationSummary: v.registration.replace(/^(\w{2}).*?(\d{3})$/, '$1 ••• $2'), seatsTotal: v.seats, bodyType: v.bodyType, photoUrl: v.photoUrl }} /></div>
      <SectionTitle>Driving</SectionTitle>
      <div className="list">
        <ProfileRow icon="star" title="Ratings & reviews" onClick={() => nav('/d/ratings')} />
        <ProfileRow icon="wallet" title="Contributions" onClick={() => nav('/d/contributions')} />
        <ProfileRow icon="seat" title="Seat availability" onClick={() => nav('/d/seats')} />
        <ProfileRow icon="calendar" title="Schedule exceptions" onClick={() => nav('/d/exceptions')} />
        <ProfileRow icon="car" title="Vehicle & commute" subtitle="Update your car, photos or route" onClick={() => nav('/onboarding/driver/1')} />
      </div>
      <ProfileRow icon="calendar" title="Commute history" onClick={()=>nav('/history')} />
      <SectionTitle>Account</SectionTitle>
      <div className="list">
        <ProfileRow icon="settings" title="Settings" subtitle="Detour, contribution, location, low-data" onClick={() => nav('/d/settings')} />
        <ProfileRow icon="eye" title="Privacy & your data" onClick={() => nav('/privacy')} />
        <ProfileRow icon="shield" title="Safety Centre" onClick={() => nav('/safety')} />
        {admin && <ProfileRow icon="settings" title="Admin console" subtitle="Verify drivers, review reports" onClick={() => nav('/admin')} />}
        {!isLive() && <ProfileRow icon="user" title="Become a passenger" subtitle="Needs a short passenger set-up" onClick={() => setSwitching(true)} />}
        <ProfileRow icon="logout" title="Sign out" danger onClick={async () => {try{await api.signOut();reset();nav('/welcome',{replace:true})}catch(e){toast(e instanceof Error?e.message:'Could not sign out. Retry.','error')}}} />
      </div>
      <DevTools />
      <BottomSheet open={switching} onClose={() => setSwitching(false)} title="Switch to passenger?">
        <div className="stack-3">
          <p className="muted">Passenger is a separate role with its own set-up. Your driver lift club remains until you close it.</p>
          <LiftyButton onClick={() => { update({ role: 'passenger', onboarded: false }); nav('/onboarding/passenger/1') }}>Start passenger set-up</LiftyButton>
          <SecondaryButton onClick={() => setSwitching(false)}>Not now</SecondaryButton>
        </div>
      </BottomSheet>
    </ScreenBody>
  )
}

/* ---------- Settings ---------- */
export function DriverSettings() {
  const toast=useToast()
  const nav = useNavigate()
  const { state, update, updateDriver } = useApp()
  const d = state.driver
  return (
    <Screen>
      <ScreenHeader title="Settings" onBack={() => nav(-1)} />
      <ScreenBody>
        <div className="stack-4">
          <Card>
            <div className="row-flex between"><label id="mx" style={{ fontWeight: 500 }}>Maximum detour</label><strong style={{ color: 'var(--teal-700)' }}>{d.commute.maxDeviationMin} min</strong></div>
            <input aria-labelledby="mx" className="range" type="range" min={2} max={15} value={d.commute.maxDeviationMin} onChange={(e) => updateDriver({ commute: { ...d.commute, maxDeviationMin: Number(e.target.value) } })} />
            <p className="small muted">Passengers needing a bigger detour are never matched to you.</p>
          </Card>
          <TextField label="Monthly contribution per passenger (R)" value={String(d.monthlyContribution)} onChange={(v) => updateDriver({ monthlyContribution: Number(v.replace(/\D/g, '')) || 0 })} inputMode="numeric" hint="Changes apply to new passengers. Re-save your commute to publish." />
          <div className="list">
            <div className="row"><span className="row-text"><span className="row-title">Share live location during commutes</span><span className="row-sub">Only within your commute window</span></span><Toggle label="Share live location during commutes" checked={state.sharingConsent} onChange={(v) => { update({ sharingConsent: v }); void api.setConsent({ location: v }).catch(e => { if(v) update({sharingConsent:false}); toast(e instanceof Error?e.message:'Consent could not be saved','error') }) }} /></div>
            <div className="row"><span className="row-text"><span className="row-title">Low-data mode</span><span className="row-sub">Simple maps and slower location updates</span></span><Toggle label="Low-data mode" checked={state.lowData} onChange={(v) => { update({ lowData: v }); void api.setConsent({ lowData: v }).catch(() => {}) }} /></div>
          </div>
        </div>
      </ScreenBody>
    </Screen>
  )
}
