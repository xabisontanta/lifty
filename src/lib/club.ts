import type { AgreedSchedule, ClubMember, CommutePlan, JoinRequest, LiftClub, Match, ScheduleException, Weekday } from '@/domain/types'
import { isoDate } from './format'
import { holidayName } from './holidays'

const DAY_MS = 86_400_000
// South Africa has no daylight-saving changes. Calendar dates and pickup times
// belong to the club's time zone, including when a member travels abroad.
const saDate = (date: Date) => new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)
const toLifty = (iso: string): Weekday => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) as Weekday
const addDays = (iso: string, count: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + count * DAY_MS).toISOString().slice(0, 10)
const calendarLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })

export interface NextCommute {
  date: string // ISO
  label: string
  isToday: boolean
  skipped: boolean
}

/** Next scheduled commute, honouring "not commuting" exceptions. */
export function nextCommute(
  days: Weekday[], time: string, exceptions: ScheduleException[], paused = false,
  options: { schedule?: AgreedSchedule; legId?: string; startDate?: string; now?: Date } = {},
): NextCommute | null {
  const now = options.now ?? new Date()
  const today = saDate(now)
  const schedule = options.schedule
  const startDate = schedule?.startDate ?? options.startDate ?? today
  const selectedDays = schedule?.days ?? days
  if (!/^\d{2}:\d{2}/.test(time) || (!selectedDays.length && schedule?.scheduleMode !== 'dates')) return null
  const applicable = exceptions.filter(e => !e.legId || !options.legId || e.legId === options.legId)
  const firstDate = startDate > today ? startDate : today
  const candidates = schedule?.scheduleMode === 'dates'
    ? [...new Set(schedule.dates)].filter(date => date >= firstDate).sort()
    : Array.from({ length: 366 }, (_, offset) => addDays(firstDate, offset))
  for (const iso of candidates) {
    if (schedule?.endDate && iso > schedule.endDate) break
    if (schedule?.scheduleMode !== 'dates' && !selectedDays.includes(toLifty(iso))) continue
    if (schedule?.skipHolidays && holidayName(iso)) continue
    if (new Date(`${iso}T${time.slice(0, 5)}:00+02:00`).getTime() + 30 * 60_000 < now.getTime()) continue
    const skipped = paused || applicable.some(e => e.kind !== 'pickup-change' && (e.date === iso || e.date === 'ongoing'))
    if (skipped && !paused) continue
    const isToday = iso === today
    return {
      date: iso,
      isToday,
      skipped,
      label: `${isToday ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : calendarLabel(iso)} · ${time}`,
    }
  }
  return null
}

export function nextClubCommute(club: LiftClub, exceptions: ScheduleException[], now?: Date): NextCommute | null {
  return nextCommute(club.days, club.pickupTime, exceptions, club.paused, { schedule: club.schedule, legId: club.matchId, startDate: club.startDate, now })
}

export function buildClub(match: Match, req: JoinRequest, me: { id?: string; firstName: string; lastInitial: string; avatarHue: number }, plan?: CommutePlan): LiftClub {
  const members: ClubMember[] = [
    { id: match.driver.id, firstName: match.driver.firstName, lastInitial: match.driver.lastInitial, avatarHue: match.driver.avatarHue, role: 'driver' },
    { id: me.id ?? 'demo-passenger', firstName: me.firstName, lastInitial: me.lastInitial, avatarHue: me.avatarHue, role: 'passenger', paymentStatus: 'due' },
  ]
  return {
    id: `club-${match.id}`,
    matchId: match.id,
    direction: match.direction,
    driver: match.driver,
    members,
    pickup: match.pickup,
    destination: match.destination,
    days: match.coveredDays ?? match.days,
    pickupTime: match.pickupEta,
    startDate: req.startDate,
    seatsTotal: match.driver.vehicle.seatsTotal,
    seatsTaken: match.driver.vehicle.seatsTotal - match.availableSeats + 1,
    monthlyContribution: match.monthlyContribution.total,
    nextContributionDate: isoDate(21),
    paymentStatus: 'due',
    paused: false,
    schedule: plan ? {
      scheduleMode: plan.scheduleMode === 'dates' ? 'dates' : 'weekly',
      days: [...(match.coveredDays ?? match.days.filter(day => plan.days.includes(day)))],
      dates: [...(match.coveredDates ?? plan.dates.filter(date => match.days.includes(toLifty(date))))],
      startDate: req.startDate,
      endDate: plan.endDate,
      skipHolidays: plan.skipHolidays,
      monthlyContribution: match.monthlyContribution.total,
      perDayContribution: match.perDayContribution,
    } : undefined,
  }
}
