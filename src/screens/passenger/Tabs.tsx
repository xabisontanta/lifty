import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { MapView, PickupMarker, DestinationMarker, SavedLocationMarker, LocationDot } from '@/components/map/MapView'
import { PaymentBadge } from '@/components/match/cards'
import { AvatarStack, CallButton, VehiclePhotoCard } from '@/components/ui/extras'
import { Icon } from '@/components/ui/Icon'
import { Avatar, BottomNavigation, Card, CardSkeleton, EmptyState, ErrorState, IconButton, LiftyButton, Modal, ProfileRow, Screen, ScreenBody, SecondaryButton, SectionTitle, Segmented, StatusBadge, TextButton, Toggle, useToast, Select, DayPicker } from '@/components/ui/kit'
import type { LiftClub } from '@/domain/types'
import { addMinutes, formatDate, formatDays, formatDistance, greeting, rand, timeAgo, walkLabel } from '@/lib/format'
import { nextClubCommute } from '@/lib/club'
import { validCoordinate } from '@/lib/mapLocation'
import { useApp } from '@/store/app'
import { useAsync } from '@/hooks/useAsync'
import { usePassengerClubs } from '@/hooks/useClubs'
import { api, type AppNotification } from '@/services/api'
import { ClubChats } from '@/components/chat/ClubChats'
import { useClubChats } from '@/hooks/useClubChats'

export const WALK_M_PER_MIN = 70

/** Invite people on your route — the quickest way to create matches where there are none. */
export async function shareInvite(toast: (m: string, t?: 'success' | 'error' | 'info') => void, area?: string) {
  const text = `I’m using Lifty to find people who commute${area ? ` from ${area}` : ''} on the same route. Join and we can share the drive: ${window.location.origin}`
  try {
    if (navigator.share) await navigator.share({ title: 'Commute with me on Lifty', text })
    else {
      await navigator.clipboard.writeText(text)
      toast('Invite link copied — share it with colleagues', 'success')
    }
  } catch {
    /* share sheet dismissed */
  }
}

/* ---------- Layout with bottom navigation ---------- */
export function PassengerTabs() {
  const { state } = useApp()
  const chats = useClubChats()
  const { data: notes } = useAsync(() => api.listNotifications(), [state.user?.id])
  const unread = (notes?.filter((n) => !n.read && n.kind !== 'message').length ?? 0) + chats.totalUnread
  return (
    <Screen>
      <Outlet />
      <BottomNavigation
        items={[
          { to: '/p/home', label: 'Home', icon: 'home' },
          { to: '/p/commute', label: 'My Commute', icon: 'route' },
          { to: '/p/find', label: 'Find Lifts', icon: 'search' },
          { to: '/p/inbox', label: 'Messages', icon: 'inbox', badge: unread || undefined },
          { to: '/p/profile', label: 'Profile', icon: 'user' },
        ]}
      />
    </Screen>
  )
}

/* ---------- 10 Home (design 10: large map) ---------- */
export function PassengerHome() {
  const nav = useNavigate()
  const toast = useToast()
  const { state } = useApp()
  const { club } = usePassengerClubs()
  const { user, plan, request } = state
  const home = plan.origin.location
  const homeReady = !!plan.origin.label.trim() && validCoordinate(home)
  const destinationReady = !!plan.destination.label.trim() && validCoordinate(plan.destination.location)
  // pickup points near where the user actually is (after auto-locate), else near home
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const centre = here ?? (homeReady ? home : null)
  const { data: points } = useAsync(() => centre ? api.listPickupPoints(centre) : Promise.resolve([]), [state.user?.id, centre?.lat.toFixed(3), centre?.lng.toFixed(3)])
  const next = club ? nextClubCommute(club, state.exceptions) : null
  const pins = (points ?? []).filter(p => validCoordinate(p.location)).slice(0, 6)
  return (
    <ScreenBody>
      <div className="home-greeting">
        <div className="row-flex">
          <Avatar first={user?.firstName ?? 'A'} last={user?.lastInitial ?? ''} hue={user?.avatarHue ?? 160} size={46} src={state.avatarUrl} />
          <div>
            <p className="muted small">{greeting()},</p>
            <h1>{user?.firstName ?? 'there'}</h1>
          </div>
        </div>
        <IconButton icon="bell" label="Notifications" onClick={() => nav('/p/inbox')} />
      </div>

      {club ? (
        <Card className="navy" as="section">
          <div className="row-flex between">
            <span className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>Your lift club</span>
            <StatusBadge tone={club.paused ? 'warning' : 'success'}>{club.paused ? 'Paused' : 'Active'}</StatusBadge>
          </div>
          <h2 className="h3" style={{ margin: '8px 0 2px' }}>{club.pickup.label} → {club.destination.label}</h2>
          <p style={{ color: 'rgba(255,255,255,.75)' }}>with {club.driver.firstName} {club.driver.lastInitial}. · {club.schedule?.scheduleMode === 'dates' ? `${club.schedule.dates.length} agreed dates` : formatDays(club.days)}</p>
          <div className="row-flex between" style={{ marginTop: 14 }}>
            <div>
              <p className="small" style={{ color: 'rgba(255,255,255,.65)' }}>Next commute</p>
              <strong>{club.paused ? 'Paused — no pickups scheduled' : next ? next.label : 'No upcoming commute'}</strong>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => nav('/p/track')}><Icon name="navigation" size={18} /> Live tracking</button>
          </div>
        </Card>
      ) : (
        <button type="button" className="commute-cta" onClick={() => nav('/p/find')}>
          <span className="role-ic" style={{ width: 52, height: 52 }}><Icon name="pin" size={26} /></span>
          <span className="grow">
            <strong className="h3" style={{ display: 'block' }}>Plan Your Commute</strong>
            <span className="muted small">Find and join trusted lift clubs in your area.</span>
          </span>
          <Icon name="chevron" size={20} className="row-chev" />
        </button>
      )}

      {request && request.status !== 'accepted' && !club && (
        <Card className="mint" onClick={() => nav('/p/sent')} style={{ marginTop: 12 }}>
          <div className="row-flex">
            <span className="row-icon"><Icon name="clock" size={20} /></span>
            <div className="grow">
              <strong>Request awaiting driver response</strong>
              <p className="small muted">We’ll notify you as soon as they reply.</p>
            </div>
            <Icon name="chevron" size={18} className="row-chev" />
          </div>
        </Card>
      )}

      <div className="map-frame" style={{ marginTop: 12 }}>
        <MapView fit={[...(homeReady ? [home] : []), ...pins.map(p => p.location), ...(!pins.length && destinationReady ? [plan.destination.location] : [])]} height={320} padding={50} label="Your area with nearby pickup points" locate autoLocate onLocate={setHere}>
          {pins.map((p) => <LocationDot key={p.label + p.location.lat} at={p.location} color="#00b386" />)}
          {homeReady && <SavedLocationMarker at={home} label="Saved home" />}
          {plan.preferredPickup && validCoordinate(plan.preferredPickup.location) && <PickupMarker at={plan.preferredPickup.location} label={`Selected pickup: ${plan.preferredPickup.label}`} />}
          {pins.length === 0 && destinationReady && <DestinationMarker at={plan.destination.location} label={plan.destination.label} />}
        </MapView>
      </div>
      <p className="small muted" style={{ margin: '8px 4px 0' }}><Icon name="pin" size={14} /> Blue is your current device location. Purple is your saved home. Green dots are community pickup points.</p>

      <SectionTitle>Quick actions</SectionTitle>
      <div className="list">
        <ProfileRow icon="calendar" title="Not commuting?" subtitle="Tell your lift club in one tap" onClick={() => nav('/p/exceptions')} />
        <ProfileRow icon="users" title="Invite colleagues on your route" subtitle="More people on your route means better matches" onClick={() => shareInvite(toast, plan.origin.area.split(',')[0])} />
        <ProfileRow icon="shield" title="Safety Centre" subtitle="Share your commute, report an issue" onClick={() => nav('/safety')} />
      </div>
    </ScreenBody>
  )
}

/* ---------- 17 My Lift Club (design 17) — morning + evening legs ---------- */
export function MyCommute() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, updatePlan } = useApp()
  const { club, returnClub, loading, error, retry } = usePassengerClubs()
  const [leg, setLeg] = useState<'to_work' | 'to_home'>('to_work')
  const current = leg === 'to_work' ? club : returnClub

  if (loading) return <ScreenBody><div className="title-block"><h1>My Lift Club</h1></div><CardSkeleton /></ScreenBody>
  if (error && !club) return <ScreenBody><ErrorState message={error.message} onRetry={retry} /></ScreenBody>
  if (!club && !returnClub) {
    return (
      <ScreenBody>
        <div className="title-block"><h1>My Commute</h1></div>
        <EmptyState
          title="No lift club yet"
          body="Once a driver accepts your request, your recurring commute lives here — schedule, pickup point, contribution and live tracking."
          action={<LiftyButton block={false} icon="search" onClick={() => nav('/p/find')}>Find Lift Clubs</LiftyButton>}
        />
      </ScreenBody>
    )
  }
  return (
    <ScreenBody>
      <div className="title-block row-flex between">
        <h1>My Lift Club</h1>
        {current && <StatusBadge tone={current.paused ? 'warning' : 'success'} icon={current.paused ? 'pause' : 'check'}>{current.paused ? 'Paused' : 'Active'}</StatusBadge>}
      </div>
      <Segmented label="Commute leg" value={leg} onChange={setLeg} options={[{ value: 'to_work', label: 'Morning · to work' }, { value: 'to_home', label: 'Evening · home' }]} />
      <div style={{ height: 12 }} />
      {current ? (
        <ClubLeg club={current} />
      ) : (
        <Card className="leg-card evening">
          <strong>No lift {leg === 'to_home' ? 'home' : 'to work'} yet</strong>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>Each trip is a separate leg — it can be with {club ? club.driver.firstName : 'your driver'} or someone else travelling at a similar time.</p>
          <LiftyButton size="sm" icon="search" onClick={() => { updatePlan({ direction: leg }); nav('/p/find') }}>Find a lift {leg === 'to_home' ? 'home' : 'to work'}</LiftyButton>
        </Card>
      )}
      {state.exceptions.length > 0 && (
        <>
          <SectionTitle action={<TextButton onClick={() => nav('/p/exceptions')}>Manage</TextButton>}>Upcoming exceptions</SectionTitle>
          <div className="list">
            {state.exceptions.slice(0, 3).map((e) => (
              <ProfileRow key={e.id} icon="calendar" title={e.note ?? e.kind} subtitle={e.date === 'ongoing' ? 'Ongoing' : e.date} />
            ))}
          </div>
        </>
      )}
      <div style={{ height: 8 }} />
      <SecondaryButton icon="share" onClick={() => shareInvite(toast)}>Invite someone on your route</SecondaryButton>
    </ScreenBody>
  )
}

function ClubLeg({ club }: { club: LiftClub }) {
  const nav = useNavigate()
  const { state } = useApp()
  const d = club.driver
  const next = nextClubCommute(club, state.exceptions)
  const others = club.members.filter((m) => m.role === 'passenger' && m.id !== state.user?.id)
  return (
    <div className="stack-3">
      <Card className={`leg-card ${club.direction === 'to_home' ? 'evening' : ''}`}>
        <div className="row-flex">
          <Avatar first={d.firstName} last={d.lastInitial} hue={d.avatarHue} size={52} src={d.avatarUrl} />
          <div className="grow">
            <button className="h3 btn-text" style={{ padding: 0, minHeight: 28, color: 'var(--text)' }} onClick={() => nav(`/p/driver/${d.id}`)}>{d.firstName} {d.lastInitial}.</button>
            <p className="small muted"><Icon name="star" size={12} filled style={{ color: '#f59e0b' }} /> {d.rating.toFixed(1)} ({d.ratingCount})</p>
            {d.isTest&&<StatusBadge tone="warning">Test driver</StatusBadge>}
          </div>
          <CallButton name={d.firstName} chatId={club.matchId} className="icon-btn" />
          <IconButton icon="message" label={`Message ${d.firstName}`} onClick={() => nav(`/chat/${club.matchId}`, { state: { name: `${d.firstName} ${d.lastInitial}.` } })} />
        </div>
        <div className="trip-line" style={{ marginTop: 14 }}>
          <span className="dotcol"><i /><b /></span>
          <div><p className="small muted">Pickup at</p><strong>{club.pickup.label}</strong></div>
          <strong>{club.pickupTime}</strong>
          <span className="dotcol"><i className="end" /></span>
          <div><p className="small muted">Drop-off at</p><strong>{club.destination.label}</strong></div>
          <span className="small muted">{club.arrivalTime?`~${club.arrivalTime}`:'Confirm arrival with your driver'}</span>
        </div>
        <div className="kv-list">
          <div className="kv"><span className="kv-k"><Icon name="calendar" size={16} /> {club.schedule?.scheduleMode === 'dates' ? `${club.schedule.dates.length} agreed dates` : formatDays(club.schedule?.days ?? club.days)}</span><span className="kv-v">from {formatDate(club.schedule?.startDate ?? club.startDate).replace(/^\w+, /, '')}</span></div>
          {club.schedule?.scheduleMode === 'dates' && <p className="small muted">{club.schedule.dates.map(date => formatDate(date).replace(/,? \d{4}$/, '')).join(' · ')}</p>}
          {club.schedule?.endDate && <p className="small muted">Ends {formatDate(club.schedule.endDate)}</p>}
          <button className="kv" style={{ background: 'none', border: 0, width: '100%', borderTop: '1px solid var(--grey-100)' }} onClick={() => nav('/p/payments')}>
            <span className="kv-k"><Icon name="wallet" size={16} /> Monthly contribution</span>
            <span className="kv-v strong">{rand(club.monthlyContribution)} <PaymentBadge status={club.paymentStatus} /></span>
          </button>
        </div>
      </Card>

      <Card className="mint">
        <p className="eyebrow">Next commute</p>
        <h2 className="h3">{club.paused ? 'Paused — no pickups scheduled' : next ? next.label : 'No upcoming commute'}</h2>
        <div className="actions-row" style={{ marginTop: 8 }}>
          <button className="action" onClick={() => nav('/p/track')}><span className="a-ic"><Icon name="navigation" /></span>Track</button>
          <button className="action" onClick={() => nav('/p/exceptions')}><span className="a-ic"><Icon name="calendar" /></span>Schedule</button>
          <button className="action" onClick={() => nav('/safety')}><span className="a-ic"><Icon name="shield" /></span>Safety</button>
          <button className="action danger" onClick={() => nav('/safety?report=1')}><span className="a-ic"><Icon name="alert" /></span>Report</button>
        </div>
      </Card>

      <VehiclePhotoCard vehicle={d.vehicle} />

      <div>
        <SectionTitle>Lift club members</SectionTitle>
        <Card>
          <div className="row-flex between">
            <AvatarStack people={[{ firstName: d.firstName, avatarHue: d.avatarHue, avatarUrl: d.avatarUrl }, ...others]} max={5} />
            <span className="small muted">{club.seatsTaken}/{club.seatsTotal || '—'} seats used</span>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ---------- Messages (notifications + lift club chat) ---------- */
export function Inbox() {
  const nav = useNavigate()
  const { state } = useApp()
  const { data, loading, error, retry } = useAsync(() => api.listNotifications(), [state.user?.id])
  const [items, setItems] = useState<AppNotification[]>([])
  useEffect(() => {
    if (data) setItems(data)
    if (data?.some((n) => !n.read)) void api.markNotificationsRead()
  }, [data])
  useEffect(() => { setItems([]); return api.subscribeNotifications((n) => setItems((x) => [n, ...x])) }, [state.user?.id])
  return (
    <ScreenBody>
      <div className="title-block"><h1>Messages</h1><p>Your lift club chat and commute updates.</p></div>
      <ClubChats />
      <SectionTitle>Updates</SectionTitle>
      {loading ? <CardSkeleton /> : error ? <ErrorState message={error.message} onRetry={retry} /> : (
        <div className="list">
          {state.request && state.request.status !== 'accepted' && <ProfileRow icon="clock" title="Request sent" subtitle="Waiting for the driver to respond." onClick={() => nav('/p/sent')} />}
          {items.length === 0 && !state.request && <p className="muted small" style={{ padding: 16 }}>No updates yet.</p>}
          {items.map((n) => (
            <ProfileRow key={n.id} icon={n.kind === 'accepted' ? 'check' : n.kind === 'arrived' ? 'car' : 'bell'} title={n.title} subtitle={n.body} onClick={n.link ? () => nav(n.link!) : undefined} right={<span className="row-flex" style={{ gap: 6 }}>{!n.read && <i className="notif-dot" aria-label="unread" />}<span className="small muted">{timeAgo(n.createdAt)}</span></span>} />
          ))}
        </div>
      )}
    </ScreenBody>
  )
}

/* ---------- Profile / Settings ---------- */
export function PassengerProfile() {
  const toast=useToast()
  const nav = useNavigate()
  const { state, update, reset } = useApp()
  const [savingLowData, setSavingLowData] = useState(false)
  const { data: admin } = useAsync(() => api.isAdmin(), [state.user?.id])
  const u = state.user
  return (
    <ScreenBody>
      <div className="title-block"><h1>Profile</h1></div>
      <Card>
        <div className="row-flex">
          <Avatar first={u?.firstName ?? 'A'} last={u?.lastInitial} hue={u?.avatarHue ?? 160} size={64} src={state.avatarUrl} />
          <div className="grow">
            <h2 className="h3">{u?.fullName ?? 'Your name'}</h2>
            <p className="small muted">{state.phone}</p>
            <div className="row-flex wrap"><StatusBadge tone="teal" icon="user">Passenger</StatusBadge></div>
          </div>
        </div>
      </Card>
      <SectionTitle>Commuting</SectionTitle>
      <div className="list">
        <ProfileRow icon="route" title="My Commute" subtitle={state.club ? 'Active lift club' : 'Find a lift club'} onClick={() => nav('/p/commute')} />
        <ProfileRow icon="calendar" title="Schedule & exceptions" onClick={() => nav('/p/exceptions')} />
        <ProfileRow icon="wallet" title="Contribution ledger" onClick={() => nav('/p/payments')} />
        <ProfileRow icon="pin" title="Addresses" subtitle={state.plan.origin.label} onClick={() => nav('/onboarding/passenger/1')} />
      </div>
      <SectionTitle>Privacy & data</SectionTitle>
      <div className="list">
        <div className="row">
          <span className="row-icon"><Icon name="lock" size={20} /></span>
          <span className="row-text"><span className="row-title">Live location during commutes</span><span className="row-sub">Only inside your commute window</span></span>
          <Toggle label="Live location during commutes" checked={state.sharingConsent} onChange={(v) => { update({ sharingConsent: v }); void api.setConsent({ location: v }).catch(e => { if(v) update({sharingConsent:false}); toast(e instanceof Error?e.message:'Consent could not be saved','error') }) }} />
        </div>
        <div className="row">
          <span className="row-icon"><Icon name="wifiOff" size={20} /></span>
          <span className="row-text"><span className="row-title">Low-data mode</span><span className="row-sub">Simple maps, fewer images, slower updates</span></span>
          <Toggle label="Low-data mode" checked={state.lowData} onChange={async (v) => {
            if (savingLowData) return
            setSavingLowData(true)
            try { await api.setConsent({ lowData: v }); update({ lowData: v }) }
            catch (e) { toast(e instanceof Error ? e.message : 'Low-data preference could not be saved', 'error') }
            finally { setSavingLowData(false) }
          }} />
        </div>
        <ProfileRow icon="eye" title="Privacy & your data" subtitle="Download or delete your data" onClick={() => nav('/privacy')} />
      </div>
      <SectionTitle>Safety & support</SectionTitle>
      <div className="list">
        <ProfileRow icon="shield" title="Safety Centre" onClick={() => nav('/safety')} />
        <ProfileRow icon="help" title="Help & support" onClick={() => nav('/safety')} />
        {admin && <ProfileRow icon="settings" title="Admin console" subtitle="Verify drivers, review reports" onClick={() => nav('/admin')} />}
      </div>
      <ProfileRow icon="calendar" title="Commute history" onClick={()=>nav('/history')} />
      <SectionTitle>Account</SectionTitle>
      <div className="list">
        <ProfileRow icon="logout" title="Sign out" danger onClick={async () => {try{await api.signOut();reset();nav('/welcome',{replace:true})}catch(e){toast(e instanceof Error?e.message:'Could not sign out. Retry.','error')}}} />
      </div>
    </ScreenBody>
  )
}
