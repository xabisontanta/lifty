import type { ReactNode } from 'react'
import type { ContributionBreakdown, DriverProfile, IncomingRequest, Match, PaymentStatus, TrackingStatus, Weekday } from '@/domain/types'
import { WEEKDAYS } from '@/domain/types'
import { formatDays, formatDistance, rand, walkLabel } from '@/lib/format'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Avatar, Card, Rating, StatusBadge, VerificationBadge } from '@/components/ui/kit'
import { AvatarStack } from '@/components/ui/extras'
import { AvatarStack } from '@/components/ui/extras'

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

export function MatchCard({ match, rank, onView }: { match: Match; rank?: number; onView: () => void }) {
  const d = match.driver
  return (
    <Card className="match-card">
      {rank === 0 && <span className="best-pill">Best match · {match.compatibility}% compatible</span>}
      <div className="row-flex between">
        <strong className="small">{match.pickup.label} → {match.destination.label}</strong>
        <StatusBadge tone="teal" icon="seat">{match.availableSeats} seat{match.availableSeats === 1 ? '' : 's'}</StatusBadge>
      </div>
      <button type="button" className="compact-match" style={{ background: 'none', border: 0, padding: 0, marginTop: 12 }} onClick={onView} aria-label={}>
        <Avatar first={d.firstName} last={d.lastInitial} hue={d.avatarHue} size={52} src={d.avatarUrl} />
        <span className="grow">
          <span className="row-flex between">
            <strong className="h3">{d.firstName} {d.lastInitial}.</strong>
            <Icon name="chevron" size={18} className="row-chev" />
          </span>
          <Rating value={d.rating} count={d.ratingCount} size="sm" />
          <span className="small muted" style={{ display: 'block' }}>{d.vehicle.make} {d.vehicle.model} · {d.vehicle.colour}</span>
          <span className="match-chips">
            <StatusBadge tone="teal" icon="route">{match.routeOverlap}% route overlap</StatusBadge>
            {d.verification.identity === 'verified' && <StatusBadge tone="success" icon="shieldCheck">Verified</StatusBadge>}
          </span>
        </span>
      </button>

      <div className="metrics">
        <MetricTile icon="walk" label="Walk to pickup" value={} sub={formatDistance(match.walkingDistanceM)} tone="blue" />
        <MetricTile icon="navigation" label="Driver deviation" value={} tone="amber" />
        <MetricTile icon="calendar" label={formatDays(match.days)} value={match.pickupEta} sub="pickup" />
      </div>

      <div className="row-flex between wrap" style={{ marginTop: 14 }}>
        <div className="row-flex" style={{ gap: 8 }}>
          <AvatarStack people={match.members} />
          <span className="small muted">{match.members.length ? 'already in this club' : ''}</span>
        </div>
        <div className="right">
          <strong className="price">{rand(match.monthlyContribution.total)}</strong>
          <span className="muted small">/month</span>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={onView} aria-label={[?1049h[22;0;0t[>4;2m[?1h=[?2004h[?1004h[1;24r[?12h[?12l[22;2t[22;1t[27m[23m[29m[m[H[2J[?25l[24;1H"match" [New][2;1H[94m~                                                                               [3;1H~                                                                               [4;1H~                                                                               [5;1H~                                                                               [6;1H~                                                                               [7;1H~                                                                               [8;1H~                                                                               [9;1H~                                                                               [10;1H~                                                                               [11;1H~                                                                               [12;1H~                                                                               [13;1H~                                                                               [14;1H~                                                                               [15;1H~                                                                               [16;1H~                                                                               [17;1H~                                                                               [18;1H~                                                                               [19;1H~                                                                               [20;1H~                                                                               [21;1H~                                                                               [22;1H~                                                                               [m[23;1H[1m[7mmatch[RO] [unix] (01:59 01/01/1970)                                    0,0-1 All[?25h[1;1H[?4m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[?2004l[>4;m[?2004h[>4;2m[24;1H[?2004l[>4;m[m[?1004l[?2004l[?1l>[?1049l[23;0;0t[>4;mVim: Error reading input, exiting...
Vim: Finished.
[24;1H[23;2t[23;1t4 files to edit}>
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
        <div className="row-flex" style={{ marginTop: 4 }}>
          <Rating value={driver.rating} count={driver.ratingCount} size="sm" />
          {driver.verification.identity === 'verified' && <VerificationBadge label="Verified" />}
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
