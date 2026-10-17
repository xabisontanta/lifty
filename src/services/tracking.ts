import type {Match, TrackingSnapshot} from '@/domain/types'
import {distanceM} from '@/lib/geo'
import type {CommuteInstance} from './api'
import {SupabaseTrackingFeed} from './supabaseTracking'
import {currentUserId} from './supabase'

/** UI subscribes to server-authorized commute instances; test trips use the same backend feed. */
export interface TrackingFeed {
  getSnapshot(): TrackingSnapshot
  subscribe(listener: (s: TrackingSnapshot) => void): () => void
  /** Explicit pickup actions — we never rely on GPS inference alone. */
  selectRider?(passengerId: string): void
  setConsent?(consent: boolean): void
  markDriverArrived(passengerId?: string): Promise<void>
  markPassengerAtPickup(): Promise<void>
  markCollected(passengerId?: string): Promise<void>
  /** driver only, after the 3-minute grace period */
  markNoShow(passengerId?: string): Promise<void>
  endSharing(): void | Promise<boolean>
  /** dev: stop emitting updates so stale-location UX can be exercised */
  setLinkDown(down: boolean): void
  restart(): void
  dispose(): void
}

export {distanceM}

// ---- feed registry: passenger and driver screens share one feed per commute ----
const feeds = new Map<string, TrackingFeed>()
export function getTrackingFeed(match: Match & { liveInstance?: CommuteInstance }, opts: { lowData?: boolean; sharingConsent?: boolean } = {}): TrackingFeed {
  if (!match.liveInstance || !currentUserId) throw new Error('A signed-in commute instance is required for live tracking.')
  const key = `live:${currentUserId}:${match.liveInstance.id}`
  let f = feeds.get(key)
  if (!f) {
    f = new SupabaseTrackingFeed(match.liveInstance, currentUserId, opts)
    feeds.set(key, f)
  }
  f.setConsent?.(opts.sharingConsent ?? false)
  return f
}
export function resetTrackingFeed(key: string) {
  for (const k of [...feeds.keys()].filter(k=>k===key||k.endsWith(`:${key}`))) {
    feeds.get(k)?.dispose()
    feeds.delete(k)
  }
}

export function disposeTrackingFeeds() { feeds.forEach(f=>f.dispose()); feeds.clear() }
