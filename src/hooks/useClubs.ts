import { useEffect } from 'react'
import { api, isLive, type DriverLegSummary } from '@/services/api'
import { useApp } from '@/store/app'
import { useAsync } from './useAsync'

/** Restore lift clubs from the backend for the current account. */
export function usePassengerClubs() {
  const { state, update } = useApp()
  const live = isLive()
  const accountId = state.user?.id
  const q = useAsync(async () => ({ accountId, clubs: live && accountId ? await api.getMyClubs() : null }), [live, accountId])
  useEffect(() => {
    if (!q.data?.clubs || q.data.accountId !== accountId) return
    const c = q.data.clubs.asPassenger
    update({ club: c.find((x) => x.direction === 'to_work') ?? null, returnClub: c.find((x) => x.direction === 'to_home') ?? null })
  }, [q.data, accountId, update])
  return { club: state.club, returnClub: state.returnClub, loading: live && q.loading && !state.club, error: live ? q.error : null, retry: q.retry }
}

/** Restore driver legs from the backend for the current account. */
export function useDriverLegs(): { legs: DriverLegSummary[]; loading: boolean; error: Error | null; retry: () => void } {
  const { state } = useApp()
  const live = isLive()
  const accountId = state.user?.id
  const q = useAsync(async () => ({ accountId, clubs: live && accountId ? await api.getMyClubs() : null }), [live, accountId, state.driver.members.length])
  return { legs: q.data && q.data.accountId === accountId ? q.data.clubs?.asDriver ?? [] : [], loading: q.loading, error: q.error, retry: q.retry }
}
