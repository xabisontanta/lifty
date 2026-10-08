import { describe, expect, it } from 'vitest'
import { buildClub, nextClubCommute, nextCommute } from '@/lib/club'
import type { AgreedSchedule, LiftClub, ScheduleException } from '@/domain/types'
import { MATCHES } from '@/data/mock'

const now = new Date('2026-10-08T04:00:00Z') // Thu 06:00 in Johannesburg
const schedule = (patch: Partial<AgreedSchedule> = {}): AgreedSchedule => ({
  scheduleMode: 'weekly', days: [0, 1, 2, 3, 4], dates: [], startDate: '2026-10-01',
  skipHolidays: false, monthlyContribution: 1000, ...patch,
})
const club = (agreed: AgreedSchedule): LiftClub => ({
  ...buildClub(MATCHES[0], { id: 'request', matchId: MATCHES[0].id, status: 'accepted', createdAt: now.toISOString(), startDate: '2026-10-01' },
    { id: 'real-passenger', firstName: 'Test', lastInitial: 'Q', avatarHue: 90 }),
  matchId: 'morning-leg', pickupTime: '06:30', schedule: agreed,
})

describe('agreed club schedules', () => {
  it('uses Johannesburg dates at the UTC midnight boundary', () => {
    expect(nextClubCommute(club(schedule()), [], new Date('2026-10-07T22:30:00Z'))?.date).toBe('2026-10-08')
  })
  it('honours future start dates rather than displaying an immediate trip', () => {
    expect(nextClubCommute(club(schedule({ startDate: '2026-11-02' })), [], now)?.date).toBe('2026-11-02')
  })
  it('finds selected dates beyond the old three-week horizon and ignores driver weekdays', () => {
    expect(nextClubCommute(club(schedule({ scheduleMode: 'dates', days: [], dates: ['2026-11-07'] })), [], now)?.date).toBe('2026-11-07')
  })
  it('does not produce trips after an agreed end date', () => {
    expect(nextClubCommute(club(schedule({ endDate: '2026-10-07' })), [], now)).toBeNull()
  })
  it('removes selected dates outside the agreed start/end range', () => {
    expect(nextClubCommute(club(schedule({ scheduleMode: 'dates', dates: ['2026-10-08', '2026-10-12', '2026-10-20'], startDate: '2026-10-10', endDate: '2026-10-15' })), [], now)?.date).toBe('2026-10-12')
  })
  it('skips holidays only when included in the agreement', () => {
    const christmas = new Date('2026-12-25T04:00:00Z')
    expect(nextClubCommute(club(schedule({ skipHolidays: true })), [], christmas)?.date).toBe('2026-12-28')
    expect(nextClubCommute(club(schedule({ skipHolidays: false })), [], christmas)?.date).toBe('2026-12-25')
  })
  it('applies global and own-leg absences while leaving other legs alone', () => {
    const exception = { id: 'one', kind: 'absent', date: '2026-10-08', legId: 'evening-leg' } as ScheduleException
    expect(nextClubCommute(club(schedule()), [exception], now)?.date).toBe('2026-10-08')
    expect(nextClubCommute(club(schedule()), [{ ...exception, legId: 'morning-leg' }], now)?.date).toBe('2026-10-09')
    expect(nextClubCommute(club(schedule()), [{ ...exception, legId: undefined }], now)?.date).toBe('2026-10-09')
  })
  it('keeps a trip scheduled while a temporary pickup awaits approval', () => {
    expect(nextClubCommute(club(schedule()), [{ id: 'change', kind: 'pickup-change', date: '2026-10-08', legId: 'morning-leg' }], now)?.date).toBe('2026-10-08')
  })
  it('shows no active upcoming trip for an ongoing pause exception', () => {
    expect(nextClubCommute(club(schedule()), [{ id: 'pause', kind: 'pause', date: 'ongoing' }], now)).toBeNull()
  })
  it('expires the current pickup only after its 30-minute grace window', () => {
    expect(nextClubCommute(club(schedule()), [], new Date('2026-10-08T05:00:01Z'))?.date).toBe('2026-10-09')
    expect(nextClubCommute(club(schedule()), [], new Date('2026-10-08T04:59:59Z'))?.date).toBe('2026-10-08')
  })
  it('keeps driver weekday-only callers compatible', () => {
    expect(nextCommute([3], '06:30', [], false, { now })?.date).toBe('2026-10-08')
  })
  it('builds only real accepted members without adding a sample passenger', () => {
    expect(club(schedule()).members.map(member => member.id)).toEqual([MATCHES[0].driver.id, 'real-passenger'])
  })
})
