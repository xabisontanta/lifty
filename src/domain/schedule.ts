import type { Weekday } from './types'
import { holidayName } from '@/lib/holidays'

/**
 * Structured commute schedule (never a display string).
 *  - weekly:         chosen weekdays, from startDate (optionally to endDate)
 *  - specific_dates: only the picked dates (priced per day)
 *  - recurring:      chosen weekdays over a longer window, optionally open-ended
 */
export type ScheduleMode = 'weekly' | 'dates' | 'recurring'

export interface CommuteSchedule {
  scheduleMode: ScheduleMode
  days: Weekday[]
  startDate: string
  endDate?: string
  dates: string[]
  skipHolidays: boolean
}

export const HORIZON_DAYS = 84 // 12 weeks is enough to judge compatibility; open-ended schedules are capped here

export const weekdayOf = (iso: string): Weekday => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) as Weekday
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10)

export function isCommuteDay(s: CommuteSchedule, iso: string): boolean {
  if (s.skipHolidays && holidayName(iso)) return false
  if (s.scheduleMode === 'dates') return s.dates.includes(iso)
  return s.days.includes(weekdayOf(iso)) && iso >= s.startDate && (!s.endDate || iso <= s.endDate)
}

/** All commuting dates from `from` (default today) across the planning horizon. */
export function resolveDates(s: CommuteSchedule, from: string, horizonDays = HORIZON_DAYS): string[] {
  if (s.scheduleMode === 'dates') return s.dates.filter((d) => d >= from && isCommuteDay(s, d)).sort()
  const out: string[] = []
  const startAt = s.startDate > from ? s.startDate : from
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(startAt, i)
    if (s.endDate && d > s.endDate) break
    if (isCommuteDay(s, d)) out.push(d)
  }
  return out
}

export function weekdaysOfDates(dates: string[]): Weekday[] {
  return [...new Set(dates.map(weekdayOf))].sort() as Weekday[]
}

const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pretty = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function daysLabel(days: Weekday[]): string {
  const d = [...days].sort((a, b) => a - b)
  if (d.length === 0) return 'No days'
  if (d.length === 7) return 'Every day'
  if (d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return `${DN[d[0]]}–${DN[d[d.length - 1]]}`
  return d.map((x) => DN[x]).join(', ')
}

export function scheduleSummary(s: CommuteSchedule, today: string): string {
  if (s.scheduleMode === 'dates') {
    const n = s.dates.filter((d) => d >= today).length
    return n === 0 ? 'No dates picked yet' : `${n} selected date${n === 1 ? '' : 's'}`
  }
  const until = s.endDate ? ` · Until ${pretty(s.endDate)}` : s.scheduleMode === 'recurring' ? ' · No end date' : ''
  return `${daysLabel(s.days)}${until}`
}

export function isScheduleReady(s: CommuteSchedule): boolean {
  return s.scheduleMode === 'dates' ? s.dates.length > 0 : s.days.length > 0
}

/** Persistence mapping: the server stores weekly (days + start/end) or specific dates. */
export const persistedMode = (m: ScheduleMode): 'weekly' | 'dates' => (m === 'dates' ? 'dates' : 'weekly')
