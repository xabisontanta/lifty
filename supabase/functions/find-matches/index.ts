// find-matches — road-routed lift-club matching for signed-in passengers.
//
// 1. match_candidates (service role only) applies the hard filters in PostGIS and returns each candidate's
//    best pickup plus the driver's PRIVATE route, origin and destination.
// 2. core.ts measures every candidate on the road network with Mapbox Directions:
//    deviation = (driver → pickup → drop-off → driver destination) − driver's normal route,
//    then filters, scores and ranks with the shared engine (the same code the app uses).
// 3. What the passenger sees is stored in match_quotes so request_to_join records exactly those figures.
// Private route data never leaves this function: only a short detour segment near the pickup is returned.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { scoreCandidates, type CandidatesPayload } from './core.ts'
import type { RouteResult, Router } from './engine/measure.ts'
import type { LatLng } from './engine/types.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

function mapboxRouter(token: string, referer: string | null): Router {
  const cache = new Map<string, Promise<RouteResult>>()
  const call = (profile: 'driving' | 'walking', points: LatLng[]) => {
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const key = `${profile}:${coords}`
    let hit = cache.get(key) // the driver's baseline is shared by every pickup on the same leg
    if (!hit) {
      hit = (async () => {
        const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`, {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const user = jwt ? (await db.auth.getUser(jwt)).data.user : null
  if (!user) return json({ error: 'Sign in to find lift clubs', code: 'auth' }, 401)

  let body: { commuteId?: unknown; mapboxToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const commuteId = typeof body.commuteId === 'string' && /^[0-9a-f-]{36}$/i.test(body.commuteId) ? body.commuteId : null
  if (!commuteId) return json({ error: 'Invalid request' }, 400)
  const authorization=await db.rpc('authorize_match_search',{p_commute:commuteId,p_passenger:user.id})
  if(authorization.error)return json({error:'Commute not found or account not active',code:'candidates'},404)
  if(!authorization.data)return json({error:'Please wait before searching again',code:'rate-limit'},429)
  // A server secret (MAPBOX_TOKEN) wins. Without it, the app's public pk. maps token — already shipped in
  // the app bundle — is used. Coordinates always come from the database, so a client-supplied token can
  // only affect that client's own search (and searches are rate-limited above).
  const clientToken = typeof body.mapboxToken === 'string' && /^pk\.[\w.-]+$/.test(body.mapboxToken) ? body.mapboxToken : null
  const token = Deno.env.get('MAPBOX_TOKEN') || clientToken
  if (!token) return json({ error: 'Road routing is not configured', code: 'routing-unavailable' }, 503)

  const { data, error } = await db.rpc('match_candidates', { p_commute: commuteId, p_passenger: user.id })
  if (error) {
    const known = /not found|not active/i.test(error.message)
    if (!known) console.error('match_candidates failed', error.message)
    return json({ error: known ? error.message : 'Could not load lift clubs', code: 'candidates' }, known ? 404 : 500)
  }
  const payload = data as CandidatesPayload

  const run = await scoreCandidates(payload, mapboxRouter(token, req.headers.get('Origin')), (m) => console.error(m))
  // every candidate failed → the provider is down: say so rather than report "no match"
  if (run.candidateCount > 0 && run.measuredCount === 0) return json({ error: 'Road routing is unavailable right now. Please try again.', code: 'routing-unavailable' }, 503)

  const {data:matches,error:saveError}=await db.rpc('persist_match_quotes',{p_commute:commuteId,p_passenger:user.id,p_signature:payload.commute.signature,p_matches:run.matches,p_leg_signatures:run.signatures})
  if (saveError) {
    console.error('quote save failed', saveError.message)
    return json({ error: 'Your search or an offer changed. Refresh your matches.', code: 'quotes' }, 409)
  }

  return json({ matches, suggestions: run.suggestions, routing: 'road' })
})
