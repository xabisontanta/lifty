import { describe, expect, it } from 'vitest'
import type { DriverLegSummary } from '@/services/api'
import { nextDriverCommute, requestStatusLabel } from '@/screens/driver/driverJourney'

const leg = (direction: 'to_work' | 'to_home'): DriverLegSummary => ({
  legId: direction, direction, originLabel: 'Origin', destinationLabel: 'Destination',
  departureTime: direction === 'to_work' ? '06:30' : '16:30', days: [0, 1, 2, 3, 4],
  seatsOpen: 2, maxDeviationMin: 8, monthlyContribution: 500, routeDistanceM: 20_000,
  route: [{ lat: -29.5, lng: 31.1 }, { lat: -29.7, lng: 31.0 }], members: [], requestsPaused: false,
})
const legs = [leg('to_work'), leg('to_home')]

describe('choosing the driver departure in Johannesburg time', () => {
  it('selects morning before departure even when the legs arrive in reverse order', () => {
    expect(nextDriverCommute([...legs].reverse(), [], new Date('2026-10-16T04:00:00Z'))?.leg.direction).toBe('to_work')
  })
  it('switches to the evening after the morning departure has passed', () => {
    const next = nextDriverCommute(legs, [], new Date('2026-10-16T11:00:00Z'))
    expect(next?.leg.direction).toBe('to_home')
    expect(next?.next.label).toBe('Today · 16:30')
  })
  it('moves to Monday morning after the Friday return and weekend', () => {
    const next = nextDriverCommute(legs, [], new Date('2026-10-16T16:00:00Z'))
    expect(next?.leg.direction).toBe('to_work')
    expect(next?.next.date).toBe('2026-10-19')
  })
  it('applies a morning absence only to that leg', () => {
    const next = nextDriverCommute(legs, [{ id: 'absence', kind: 'unavailable', date: '2026-10-16', legId: 'to_work' }], new Date('2026-10-16T04:00:00Z'))
    expect(next?.leg.direction).toBe('to_home')
    expect(next?.next.date).toBe('2026-10-16')
  })
  it('does not turn a pickup change into an absence', () => {
    expect(nextDriverCommute(legs, [{ id: 'pickup', kind: 'pickup-change', date: '2026-10-16', legId: 'to_work' }], new Date('2026-10-16T04:00:00Z'))?.leg.direction).toBe('to_work')
  })
  it('handles all-leg pauses and accounts without a saved route', () => {
    expect(nextDriverCommute(legs, [{ id: 'pause', kind: 'pause', date: 'ongoing' }], new Date('2026-10-16T04:00:00Z'))).toBeNull()
    expect(nextDriverCommute([], [])).toBeNull()
  })
})

describe('request outcomes', () => {
  it('keeps passenger withdrawal and expired offers distinct from a driver decline', () => {
    expect(requestStatusLabel('cancelled')).toBe('Withdrawn')
    expect(requestStatusLabel('declined')).toBe('Declined')
    expect(requestStatusLabel('expired')).toBe('Expired')
    expect(requestStatusLabel('new-server-status')).toBe('Unavailable')
  })
})
