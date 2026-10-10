import { useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { DestinationMarker, MapView, PickupMarker, RouteLine } from '@/components/map/MapView'
import { MatchMap } from '@/components/match/MatchMap'
import { KV, MetricTile, PassengerCard, PaymentBadge, ScheduleCard } from '@/components/match/cards'
import { CallButton, VehiclePhotoCard } from '@/components/ui/extras'
import { Icon } from '@/components/ui/Icon'
import {
  Avatar, Banner, BottomNavigation, BottomSheet, Card, CardSkeleton, EmptyState, ErrorState, LiftyButton, ProfileRow, Rating, Screen, ScreenBody, ScreenFooter,
  ScreenHeader, SecondaryButton, SectionTitle, StatusBadge, TextButton, Toggle, VerificationBadge, IconButton, useToast, TextField,
} from '@/components/ui/kit'
import { formatDays, greeting, rand } from '@/lib/format'
import { nextCommute } from '@/lib/club'
import { useAsync } from '@/hooks/useAsync'
import { useDriverLegs } from '@/hooks/useClubs'
import { api, ApiError } from '@/services/api'
import { useApp } from '@/store/app'
import { shareCommute } from '@/services/share'

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
  const verified = Object.values(state.verification).every(v=>v==='verified')
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
            <div style={{ height: 24 }} />
          </div>
        )}
      </ScreenBody>
      {data && data.status === 'pending' && (
        <ScreenFooter>
          <LiftyButton loading={busy === 'accept'} disabled={!!busy} onClick={() => respond('accept')}>Accept Passenger</LiftyButton>
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
  const {state}=useApp()
  const { data: me, loading, error, retry } = useAsync(() => state.user?api.getDriver(state.user.id):Promise.reject(new Error('Sign in first')), [state.user?.id])
  return (
    <Screen>
      <ScreenHeader title="Ratings & reviews" onBack={() => nav(-1)} />
      <ScreenBody>
        {loading ? <CardSkeleton /> : error || !me ? <ErrorState message={error?.message ?? 'Your ratings could not be loaded.'} onRetry={retry} /> : (
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
  const { data: admin } = useAsync(() => api.isAdmin(), [])
  const u = state.user
  const v = state.driver.vehicle
  const allDocs = Object.values(state.verification).every(v=>v==='verified')
  return (
    <ScreenBody>
      <div className="title-block"><h1>Profile</h1></div>
      <Card>
        <div className="row-flex">
          <Avatar first={u?.firstName ?? 'D'} last={u?.lastInitial} hue={u?.avatarHue ?? 24} size={64} src={state.avatarUrl} />
          <div className="grow"><h2 className="h3">{u?.fullName ?? 'Your name'}</h2><p className="small muted">{state.phone}</p><div className="row-flex wrap"><StatusBadge tone="teal" icon="car">Driver</StatusBadge>{u?.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}<VerificationBadge status={allDocs ? 'verified' : 'pending'} label="Verified Driver" /></div></div>
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
        <ProfileRow icon="logout" title="Sign out" danger onClick={async () => {try{await api.signOut();reset();nav('/welcome',{replace:true})}catch(e){toast(e instanceof Error?e.message:'Could not sign out. Retry.','error')}}} />
      </div>
    </ScreenBody>
  )
}

