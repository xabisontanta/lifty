import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IncomingRequest } from '@/domain/types'
import { api } from '@/services/api'
import { sb } from '@/services/supabase'
import { useApp } from '@/store/app'

const REQUESTS_CHANGED = 'lifty:driver-requests-changed'
const POLL_MS = 15_000

interface RequestInbox {
  data: IncomingRequest[] | null
  loading: boolean
  refreshing: boolean
  error: Error | null
  retry: () => void
}

const DriverRequestsContext = createContext<RequestInbox | null>(null)

/** Keep badge, dashboard and inbox on the same account-scoped server snapshot. */
export function DriverRequestsProvider({ children }: { children: ReactNode }) {
  const inbox = useRequestSource(true)
  return <DriverRequestsContext.Provider value={inbox}>{children}</DriverRequestsContext.Provider>
}

export function useDriverRequests(): RequestInbox {
  const provided = useContext(DriverRequestsContext)
  // Request details are outside the tab layout, so they own a source when needed.
  const own = useRequestSource(!provided)
  return provided ?? own
}

export function refreshDriverRequests() {
  window.dispatchEvent(new Event(REQUESTS_CHANGED))
}

function useRequestSource(enabled: boolean): RequestInbox {
  const { state } = useApp()
  const accountId = state.user?.id
  const [snapshot, setSnapshot] = useState<{ accountId: string; data: IncomingRequest[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)
  const retry = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    if (!enabled || !accountId) return
    let active = true
    let running = false
    let queued = false
    setLoading(true)
    setError(null)

    const refresh = async () => {
      if (!active) return
      if (running) { queued = true; return }
      running = true
      setRefreshing(true)
      try {
        const data = await api.listIncomingRequests()
        if (active) { setSnapshot({ accountId, data }); setError(null) }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause : new Error('Requests could not be refreshed.'))
      } finally {
        running = false
        if (active) {
          setLoading(false)
          setRefreshing(false)
          if (queued) { queued = false; void refresh() }
        }
      }
    }
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh() }
    refreshRef.current = () => void refresh()
    void refresh()

    // Postgres Changes applies table RLS. Never trust event contents as a request;
    // re-read the authorised RPC, including after a subscription reconnects.
    const channel = sb().channel(`driver-requests:${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests' }, visibleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${accountId}` }, visibleRefresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') visibleRefresh() })
    // Polling also covers a missed event, unavailable Realtime or a cold resume.
    const timer = window.setInterval(visibleRefresh, POLL_MS)
    window.addEventListener('focus', visibleRefresh)
    window.addEventListener('online', visibleRefresh)
    window.addEventListener(REQUESTS_CHANGED, visibleRefresh)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => {
      active = false
      refreshRef.current = () => undefined
      clearInterval(timer)
      void sb().removeChannel(channel)
      window.removeEventListener('focus', visibleRefresh)
      window.removeEventListener('online', visibleRefresh)
      window.removeEventListener(REQUESTS_CHANGED, visibleRefresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
    }
  }, [enabled, accountId])

  return { data: snapshot && snapshot.accountId === accountId ? snapshot.data : null, loading, refreshing, error, retry }
}
