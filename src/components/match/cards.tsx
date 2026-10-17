import type { ReactNode } from 'react'
import type { ContributionBreakdown, DriverProfile, IncomingRequest, Match, PaymentStatus, TrackingStatus, Weekday } from '@/domain/types'
import { WEEKDAYS } from '@/domain/types'
import { formatDays, formatDistance, rand, walkLabel } from '@/lib/format'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Avatar, Card, Rating, StatusBadge, VerificationBadge } from '@/components/ui/kit'
import { AvatarStack } from '@/components/ui/extras'
import { driverIsVerified } from '@/domain/verification'

/* ---------- Metric tile — the four numbers that explain a match ---------- */

export function MetricTile({ icon, label, value, sub, tone }: { icon: IconName; label: string; value: ReactNode; sub?: ReactNode; tone?: 'teal' | 'blue' | 'amber' }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span className="metric-label">
        <Icon name={icon} size={14} /> {label}
      </span>
      <span className="metric-value">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  )
}

export function DayChips({ days }: { days: Weekday[] }) {
  return (
    <span className="day-chips" aria-label={formatDays(days)}>
      {WEEKDAYS.map((d, i) => (
        <span key={d} className={days.includes(i as Weekday) ? 'on' : ''} aria-hidden>
          {d.charAt(0)}
        </span>
      ))}
    </span>
  )
}

/* ---------- MatchCard (design system §07 Lift Club / Match Card) ---------- */

/** "Drives 3 of your 5 dates — not Thu 15 Oct…" — readable, never raw ISO dates. */
export function partialLine(m: Match): string {
  const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
  const miss = m.uncoveredDates ?? []
  if (miss.length) {
    const covered = m.coveredDates?.length ?? 0
    return `Drives ${covered} of your ${covered + miss.length} dates — not ${miss.slice(0, 3).map(short).join(', ')}${miss.length > 3 ? ` +${miss.length - 3} more` : ''}`
  }
  return `Doesn’t drive ${formatDays(m.uncoveredDays ?? [])}`
}

export function MatchCard({ match, rank, onView }: { match: Match; rank?: number; onView: () => void }) {
  const d = match.driver
  return (
    <Card className="match-card">
      {rank === 0 && <span className="best-pill">Best match · {match.compatibility}% compatible</span>}
      <div className="row-flex between">
        <strong className="small">{match.pickup.label} → {match.destination.label}</strong>
        <StatusBadge tone="teal" icon="seat">{match.availableSeats} seat{match.availableSeats === 1 ? '' : 's'}</StatusBadge>
      </div>
      <button type="button" className="compact-match" style={{ background: 'none', border: 0, padding: 0, marginTop: 12 }} onClick={onView} aria-label={`View ${d.firstName} lift club`}>
        <Avatar first={d.firstName} last={d.lastInitial} hue={d.avatarHue} size={52} src={d.avatarUrl} />
        <span className="grow">
          <span className="row-flex between">
            <strong className="h3">{d.firstName} {d.lastInitial}.</strong>
            <Icon name="chevron" size={18} className="row-chev" />
          </span>
          <Rating value={d.rating} count={d.ratingCount} size="sm" />
          <span className="small muted" style={{ display: 'block' }}>{d.vehicle.make} {d.vehicle.model} · {d.vehicle.colour}</span>
          <span className="match-chips">
            {d.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}
            <StatusBadge tone="teal" icon="route">{match.routeOverlap}% route overlap</StatusBadge>
            {driverIsVerified(d.verification) && <StatusBadge tone="success" icon="shieldCheck">Verified</StatusBadge>}
            {match.partial && <StatusBadge tone="warning" icon="calendar">Partial schedule</StatusBadge>}
          </span>
        </span>
      </button>

      {match.partial && <p className="small" role="status" style={{ marginTop: 8, color: '#92600a' }}>{partialLine(match)}</p>}
      <div className="metrics">
        {match.walkingDistanceM === 0
          ? <MetricTile icon="pin" label="Pickup" value="Door" sub="no walking" tone="blue" />
          : <MetricTile icon="walk" label="Walk to pickup" value={`${match.walkingMinutes} min`} sub={formatDistance(match.walkingDistanceM)} tone="blue" />}
        <MetricTile icon="navigation" label="Driver deviation" value={`${match.driverDeviationMinutes} min`} tone="amber" />
        <MetricTile icon="clock" label="Arrives" value={match.arrivalEta} sub={`pickup ${match.pickupEta}`} />
      </div>

      <div className="row-flex between wrap" style={{ marginTop: 14 }}>
        <div className="row-flex" style={{ gap: 8 }}>
          <AvatarStack people={match.members} />
          <span className="small muted">{match.members.length ? 'already in this club' : ''}</span>
        </div>
        {match.pricing === 'per_day' ? (
          <div className="right">
            <strong className="price">{rand(match.perDayContribution ?? 0)}</strong>
            <span className="muted small">/day</span>
            <p className="small muted">{match.bookedDays} day{match.bookedDays === 1 ? '' : 's'} = {rand(match.monthlyContribution.total)}</p>
          </div>
        ) : (
          <div className="right">
            <strong className="price">{rand(match.monthlyContribution.total)}</strong>
            <span className="muted small">/month</span>
          </div>
        )}
      </div>

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={onView} aria-label={`View match with ${d.firstName}`}>
        <span>View Match</span>
      </button>
    </Card>
  )
}

/* ---------- DriverCard (compact) ---------- */

export function DriverCard({ driver, onClick, trailing }: { driver: DriverProfile; onClick?: () => void; trailing?: ReactNode }) {
  const inner = (
    <>
      <Avatar first={driver.firstName} last={driver.lastInitial} hue={driver.avatarHue} size={52} src={driver.avatarUrl} />
      <div className="grow">
        <h3 className="h3">
          {driver.firstName} {driver.lastInitial}.
        </h3>
        <p className="muted small">
          {driver.vehicle.make} {driver.vehicle.model} · {driver.vehicle.colour}
        </p>
        <div className="row-flex wrap" style={{ marginTop: 4 }}>
          {driver.isTest && <StatusBadge tone="warning">Test driver</StatusBadge>}
          <Rating value={driver.rating} count={driver.ratingCount} size="sm" />
          {driverIsVerified(driver.verification) && <VerificationBadge label="Documents reviewed" />}
        </div>
      </div>
      {trailing ?? (onClick ? <Icon name="chevron" size={18} className="row-chev" /> : null)}
    </>
  )
  return onClick ? (
    <button type="button" className="card card-press row-flex driver-card" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="card row-flex driver-card">{inner}</div>
  )
}

/* ---------- PassengerCard ---------- */

export function PassengerCard({ req, onClick }: { req: IncomingRequest; onClick?: () => void }) {
  const p = req.passenger
  return (
    <button type="button" className="card card-press passenger-card" onClick={onClick}>
      <div className="row-flex">
        <Avatar first={p.firstName} last={p.lastInitial} hue={p.avatarHue} size={48} />
        <div className="grow">
          <h3 className="h3">
            {p.firstName} {p.lastInitial}.
          </h3>
          <div className="row-flex">
            <Rating value={p.rating} count={p.ratingCount} size="sm" />
            {p.verified && <VerificationBadge label="Verified" />}
          </div>
        </div>
        <Icon name="chevron" size={18} className="row-chev" />
      </div>
      <div className="metrics two">
        <MetricTile icon="navigation" label="Your detour" value={`+${req.deviationMinutes} min`} tone="amber" />
        <MetricTile icon="route" label="Route overlap" value={`${req.routeOverlap}%`} tone="teal" />
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        <Icon name="pin" size={14} /> {req.pickup.label} · {formatDays(req.days)} · arrive {req.arriveBy}
      </p>
    </button>
  )
}

/* ---------- ScheduleCard ---------- */

export function ScheduleCard({ days, pickupTime, nextLabel, destination, pickup }: { days: Weekday[]; pickupTime: string; nextLabel?: string; destination?: string; pickup?: string }) {
  return (
    <Card>
      <div className="row-flex between">
        <div>
          <p className="eyebrow">Recurring schedule</p>
          <h3 className="h3">{formatDays(days)}</h3>
        </div>
        <DayChips days={days} />
      </div>
      <div className="kv-list">
        <KV icon="clock" k="Pickup time" v={pickupTime} />
        {pickup && <KV icon="pin" k="Pickup point" v={pickup} />}
        {destination && <KV icon="flag" k="Destination" v={destination} />}
        {nextLabel && <KV icon="calendar" k="Next commute" v={nextLabel} />}
      </div>
    </Card>
  )
}

export function KV({ icon, k, v, strong }: { icon?: IconName; k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-k">
        {icon && <Icon name={icon} size={16} />} {k}
      </span>
      <span className={`kv-v ${strong ? 'strong' : ''}`}>{v}</span>
    </div>
  )
}

/* ---------- ContributionCard ---------- */

export function ContributionCard({ breakdown, status, nextDate }: { breakdown: ContributionBreakdown; status?: PaymentStatus; nextDate?: string }) {
  return (
    <Card>
      <div className="row-flex between">
        <div>
          <p className="eyebrow">Monthly contribution</p>
          <p className="price-lg">
            {rand(breakdown.total)}
            <span className="muted small">/month</span>
          </p>
        </div>
        {status && <PaymentBadge status={status} />}
      </div>
      <div className="kv-list">
        <KV k="Driver contribution" v={rand(breakdown.driverContribution)} />
        <KV k="Platform / service amount" v={rand(breakdown.platformFee)} />
        <KV k="Payment processing" v={rand(breakdown.processingFee)} />
        <KV k="Total" v={rand(breakdown.total)} strong />
        {nextDate && <KV icon="calendar" k="Next contribution" v={nextDate} />}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        A fixed monthly contribution towards fuel and wear — not a per-trip fare.
      </p>
    </Card>
  )
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const map = {
    paid: { tone: 'success', icon: 'check', label: 'Paid' },
    due: { tone: 'warning', icon: 'clock', label: 'Due soon' },
    overdue: { tone: 'error', icon: 'alert', label: 'Overdue' },
    upcoming: { tone: 'info', icon: 'calendar', label: 'Upcoming' },
  } as const
  const m = map[status]
  return (
    <StatusBadge tone={m.tone} icon={m.icon}>
      {m.label}
    </StatusBadge>
  )
}

/* ---------- LiveTrackingStatus ---------- */

const STATUS_COPY: Record<TrackingStatus, { title: string; icon: IconName; tone: 'teal' | 'blue' | 'amber' | 'navy' | 'grey' }> = {
  'sharing-soon': { title: 'Location sharing starts soon', icon: 'clock', tone: 'grey' },
  'driver-approaching': { title: 'Driver approaching', icon: 'car', tone: 'teal' },
  'passenger-approaching': { title: 'Passenger approaching pickup', icon: 'walk', tone: 'blue' },
  'both-at-pickup': { title: 'Both at pickup', icon: 'check', tone: 'teal' },
  underway: { title: 'Commute underway', icon: 'navigation', tone: 'navy' },
  'destination-reached': { title: 'Destination reached', icon: 'flag', tone: 'teal' },
  ended: { title: 'Location sharing ended', icon: 'lock', tone: 'grey' },
}
export const trackingTitle = (s: TrackingStatus) => STATUS_COPY[s].title

export function LiveTrackingStatus({ status, detail, stale }: { status: TrackingStatus; detail?: ReactNode; stale?: boolean }) {
  const c = STATUS_COPY[status]
  return (
    <div className={`track-status tone-${c.tone}`} role="status" aria-live="polite">
      <span className="ts-icon">
        <Icon name={c.icon} size={20} />
      </span>
      <div>
        <strong>{c.title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      {!stale && status !== 'ended' && status !== 'sharing-soon' && (
        <span className="live-pill">
          <i /> Live
        </span>
      )}
    </div>
  )
}

export const walk = walkLabel
