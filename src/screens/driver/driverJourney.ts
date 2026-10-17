import type { ScheduleException } from '@/domain/types'
import type { DriverLegSummary } from '@/services/api'
import { nextCommute, type NextCommute } from '@/lib/club'

/** Select the next actual leg, including evening after the morning has passed. */
export function nextDriverCommute(legs: DriverLegSummary[], exceptions: ScheduleException[], now = new Date()): { leg: DriverLegSummary; next: NextCommute } | null {
  return legs.flatMap(leg => {
    const next = nextCommute(leg.days, leg.departureTime, exceptions, false, { legId: leg.legId, now })
    return next ? [{ leg, next }] : []
  }).sort((a, b) => `${a.next.date}T${a.leg.departureTime}`.localeCompare(`${b.next.date}T${b.leg.departureTime}`))[0] ?? null
}

/** Unknown/new server states must never be displayed as a decline. */
export function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending', reviewing: 'Under review', accepted: 'Accepted', declined: 'Declined',
    cancelled: 'Withdrawn', withdrawn: 'Withdrawn', expired: 'Expired', invalidated: 'Offer changed',
  }
  return labels[status] ?? 'Unavailable'
}

export function riderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    expected: 'Expected', at_pickup: 'Ready at pickup', collected: 'Collected', dropped_off: 'Completed',
    no_show: 'No-show', absent: 'Absent', cancelled: 'Cancelled',
  }
  return labels[status] ?? 'Unavailable'
}
