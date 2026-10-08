import { useEffect, useMemo, useState } from 'react'
import type { Match, TrackingConnection, TrackingSnapshot } from '@/domain/types'
import { getTrackingFeed, type TrackingFeed } from '@/services/tracking'
import { useOnline } from './useAsync'

const STALE_AFTER_MS = 15000

export interface TrackingState {
  snapshot: TrackingSnapshot
  connection: TrackingConnection
  stale: boolean
  feed: TrackingFeed
}

/** Subscribes to the live feed for a match. Contains no movement logic. */
export function useTracking(match: Match, opts: { lowData?: boolean } = {}): TrackingState {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(() => getTrackingFeed(match, opts), [match])
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>(feed.getSnapshot())
  const [lastUpdate, setLastUpdate] = useState<number | null>(Date.now())
  const [now, setNow] = useState(Date.now())
  const online = useOnline()

  useEffect(() => {
    const unsub = feed.subscribe((s) => {
      setSnapshot(s)
      setLastUpdate(s.driverLocation?.updatedAt ?? Date.now())
    })
    return unsub
  }, [feed])

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
