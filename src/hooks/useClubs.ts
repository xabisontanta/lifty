import { useEffect } from 'react'
import { api, isLive, type DriverLegSummary } from '@/services/api'
import { useApp } from '@/store/app'
import { useAsync } from './useAsync'
import { MAIN_ROUTE } from '@/data/mock'

/** Passenger lift clubs. Live: fetched from the server and cached in the store. Demo: the store. */
export function usePassengerClubs() {
  const { state, update } = useApp()
  const live = isLive()
  const q = useAsync(() => (live ? api.getMyClubs() : Promise.resolve(null)), [live])
  useEffect(() => {
    if (!q.data) return
    const c = q.data.asPassenger
    update({ club: c.find((x) => x.direction === 'to_work') ?? null, returnClub: c.find((x) => x.direction === 'to_home') ?? null })
  }, [q.data, update])
  return { club: state.club, returnClub: state.returnClub, loading: live && q.loading && !state.club, error: live ? q.error : null, retry: q.retry }
}

/** Driver legs. Live: from the server. Demo: derived from the local driver set-up. */
export function useDriverLegs(): { legs: DriverLegSummary[]; loading: boolean; error: Error | null; retry: () => void } {
  const { state } = useApp()
  const live = isLive()
  const q = useAsync(() => (live ? api.getMyClubs() : Promise.resolve(null)), [live, state.driver.members.length])
  if (live) return { legs: q.data?.asDriver ?? [], loading: q.loading, error: q.error, retry: q.retry }
  const d = state.driver
  const legs: DriverLegSummary[] = [
    {
      legId: 'demo-leg',
      direction: 'to_work',
      originLabel: d.commute.originPlace?.label ?? d.commute.origin,
      destinationLabel: d.commute.destinationPlace?.label ?? d.commute.destination,
      departureTime: d.commute.departure,
      days: d.commute.days,
      seatsOpen: d.seatsOpen,
      maxDeviationMin: d.commute.maxDeviationMin,
      monthlyContribution: d.monthlyContribution,
      routeDistanceM: 35000,
      route: MAIN_ROUTE,
      members: d.members.map((m) => ({ id: m.id, firstName: m.firstName, lastInitial: m.lastInitial, avatarHue: m.avatarHue, pickupLabel: 'Shell Garage', pickupTime: '06:35', paymentStatus: m.paymentStatus ?? 'upcoming' })),
    },
  ]
  return { legs, loading: false, error: null, retry: q.retry }
}
