import type { ClubMember, JoinRequest, LiftClub, Match, ScheduleException, Weekday } from '@/domain/types'
import { formatDate, isoDate } from './format'

/** JS Date.getDay() is Sun=0; Lifty weekdays are Mon=0. */
const toLifty = (d: Date): Weekday => ((d.getDay() + 6) % 7) as Weekday

export interface NextCommute {
  date: string // ISO
  label: string
  isToday: boolean
  skipped: boolean
}

/** Next scheduled commute, honouring "not commuting" exceptions. */
export function nextCommute(days: Weekday[], time: string, exceptions: ScheduleException[], paused = false): NextCommute | null {
  if (days.length === 0) return null
  const now = new Date()
  for (let i = 0; i < 21; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    if (!days.includes(toLifty(d))) continue
    const iso = d.toISOString().slice(0, 10)
    const [h, m] = time.split(':').map(Number)
    if (i === 0 && (now.getHours() > h || (now.getHours() === h && now.getMinutes() > m + 30))) continue
    const skipped = paused || exceptions.some((e) => e.date === iso || e.date === 'ongoing')
    if (skipped && !paused) continue
    return {
      date: iso,
      isToday: i === 0,
      skipped,
      label: `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDate(iso).replace(/,? \d{4}$/, '')} · ${time}`,
    }
  }
  return null
}

export function buildClub(match: Match, req: JoinRequest, me: { firstName: string; lastInitial: string; avatarHue: number }): LiftClub {
  const members: ClubMember[] = [
    { id: match.driver.id, firstName: match.driver.firstName, lastInitial: match.driver.lastInitial, avatarHue: match.driver.avatarHue, role: 'driver' },
    { id: 'me', firstName: me.firstName, lastInitial: me.lastInitial, avatarHue: me.avatarHue, role: 'passenger', paymentStatus: 'due' },
    { id: 'pax-other', firstName: 'Lindiwe', lastInitial: 'S', avatarHue: 300, role: 'passenger', paymentStatus: 'paid' },
  ]
  return {
    id: `club-${match.id}`,
    matchId: match.id,
    direction: match.direction,
    driver: match.driver,
    members,
    pickup: match.pickup,
    destination: match.destination,
    days: match.days,
    pickupTime: match.pickupEta,
    startDate: req.startDate,
    seatsTotal: match.driver.vehicle.seatsTotal,
    seatsTaken: match.driver.vehicle.seatsTotal - match.availableSeats + 1,
    monthlyContribution: match.monthlyContribution.total,
    nextContributionDate: isoDate(21),
    paymentStatus: 'due',
    paused: false,
  }
}
