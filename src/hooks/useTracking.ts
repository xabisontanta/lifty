import { useEffect, useMemo, useState } from 'react'
import type { Match, TrackingConnection, TrackingSnapshot } from '@/domain/types'
import { getTrackingFeed, type TrackingFeed } from '@/services/tracking'
import { useOnline } from './useAsync'
import { useApp } from '@/store/app'

const STALE_AFTER_MS = 15000

export interface TrackingState {
  snapshot: TrackingSnapshot
  connection: TrackingConnection
  stale: boolean
  feed: TrackingFeed
}

/** Subscribes to the live feed for a match. Contains no movement logic. */
export function useTracking(match: Match, opts: { lowData?: boolean } = {}): TrackingState {
  const {state}=useApp()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(() => getTrackingFeed(match, {...opts,sharingConsent:state.sharingConsent}), [match.id, (match as Match & {liveInstance?:{id:string}}).liveInstance?.id])
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>(feed.getSnapshot())
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const online = useOnline()

  useEffect(() => {
    const unsub = feed.subscribe((s) => {
      setSnapshot(s)
      const driver=(match as Match & {liveInstance?:{isDriver:boolean}}).liveInstance?.isDriver
      setLastUpdate((driver?s.passengerLocation?.updatedAt:s.driverLocation?.updatedAt)??null)
    })
    return unsub
  }, [feed])

  useEffect(()=>{feed.setConsent?.(state.sharingConsent)},[feed,state.sharingConsent])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const stale = lastUpdate != null && now - lastUpdate > STALE_AFTER_MS
  const connection: TrackingConnection = {
    online,
    lastUpdate,
    error: !online ? 'Connection lost' : stale ? 'Driver location temporarily unavailable' : undefined,
  }
  return { snapshot, connection, stale: stale || !online, feed }
}
