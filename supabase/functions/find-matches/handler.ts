// find-matches — request handler. Pure: no Deno or npm: imports, so the unit tests and the local sandbox run
// exactly this code. index.ts supplies the Deno runtime wiring.
//
// 1. match_candidates (service role only) applies the hard filters in PostGIS and returns each candidate's
//    best pickup plus the driver's PRIVATE route, origin and destination.
// 2. core.ts measures every candidate on the road network with Mapbox Directions:
//    deviation = (driver → pickup → drop-off → driver destination) − driver's normal route,
//    then filters, scores and ranks with the shared engine (the same code the app uses).
// 3. What the passenger sees is stored in match_quotes so request_to_join records exactly those figures.
// Private route data never leaves this function: the detour/approach geometry is not returned.
import { scoreCandidates, type CandidatesPayload } from './core.ts'
import type { RouteResult, Router } from './engine/measure.ts'
import type { LatLng } from './engine/types.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** The slice of a service-role supabase-js client that the handler uses. */
export interface Db {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string } | null } }> }
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface Deps {
  db: Db
  /** Server-held Mapbox token (the MAPBOX_TOKEN secret). Client input never chooses routing credentials. */
  mapboxSecret: string | null
  /** Test seam: replaces the Mapbox router entirely. */
  router?: Router
  fetch?: typeof fetch
  log?: (msg: string) => void
}

export function mapboxRouter(token: string, referer: string | null, fetchImpl: typeof fetch = fetch): Router {
  const cache = new Map<string, Promise<RouteResult>>()
  const call = (profile: 'driving' | 'walking', points: LatLng[]) => {
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const key = `${profile}:${coords}`
    let hit = cache.get(key) // the driver's baseline is shared by every pickup on the same leg
    if (!hit) {
      hit = (async () => {
        const res = await fetchImpl(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`, {
          headers: referer ? { Referer: referer } : {}, // keeps URL-restricted public tokens working
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) throw new Error(`Routing provider returned ${res.status}`)
        const r = (await res.json()).routes?.[0]
        if (!r) throw new Error('No route found between those places')
        return { coordinates: r.geometry.coordinates, distanceM: Math.round(r.distance), durationS: Math.round(r.duration) }
      })()
      cache.set(key, hit)
    }
    return hit
  }
  return { drive: (p) => call('driving', p), walk: (p) => call('walking', p) }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const { db } = deps
  const log = deps.log ?? (() => {})
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const user = jwt ? (await db.auth.getUser(jwt)).data.user : null
  if (!user) return json({ error: 'Sign in to find lift clubs', code: 'auth' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400)
  const value = (body as { commuteId?: unknown }).commuteId
  const commuteId = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null
  if (!commuteId) return json({ error: 'Invalid request' }, 400)

  const authorization = await db.rpc('authorize_match_search', { p_commute: commuteId, p_passenger: user.id })
  if (authorization.error) return json({ error: 'Commute not found or account not active', code: 'candidates' }, 404)
  if (!authorization.data) return json({ error: 'Please wait before searching again', code: 'rate-limit' }, 429)

  const token = deps.mapboxSecret
  const router = deps.router ?? (token ? mapboxRouter(token, req.headers.get('Origin'), deps.fetch) : null)
  if (!router) return json({ error: 'Road routing is not configured', code: 'routing-unavailable' }, 503)

  const { data, error } = await db.rpc('match_candidates', { p_commute: commuteId, p_passenger: user.id })
  if (error) {
    const known = /not found|not active/i.test(error.message)
    if (!known) log(`match_candidates failed: ${error.message}`)
    return json({ error: known ? error.message : 'Could not load lift clubs', code: 'candidates' }, known ? 404 : 500)
  }
  const payload = data as CandidatesPayload

  const run = await scoreCandidates(payload, router, log)
  // every candidate failed → the provider is down: say so rather than report "no match"
  if (run.candidateCount > 0 && run.measuredCount === 0) return json({ error: 'Road routing is unavailable right now. Please try again.', code: 'routing-unavailable' }, 503)

  const saved = await db.rpc('persist_match_quotes', { p_commute: commuteId, p_passenger: user.id, p_signature: payload.commute.signature, p_matches: run.matches, p_leg_signatures: run.signatures })
  if (saved.error) {
    log(`quote save failed: ${saved.error.message}`)
    return json({ error: 'Your search or an offer changed. Refresh your matches.', code: 'quotes' }, 409)
  }

  return json({ matches: saved.data, suggestions: run.suggestions, routing: 'road' })
}
