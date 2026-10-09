import { describe, expect, it, vi } from 'vitest'
import type { CandidatesPayload } from '../../supabase/functions/find-matches/core.ts'
import { handle, type Db, type Deps } from '../../supabase/functions/find-matches/handler.ts'
import { DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter } from '@/data/demoLegs'
import { DEFAULT_PLAN } from '@/data/mock'
import { simulatedRouter } from '@/services/demoRouter'
import { choosePickup, requestFromPlan } from '@/services/matchingService'
import type { CommutePlan } from '@/domain/types'

const COMMUTE = 'c0000000-0000-4000-8000-000000000001'
const plan: CommutePlan = { ...DEFAULT_PLAN, startDate: '2026-10-12' }

/** What match_candidates returns for the demo drivers. */
function payload(): CandidatesPayload {
  const req = requestFromPlan(plan, '2026-10-10')
  return {
    commute: { direction: plan.direction, arriveBy: req.arriveBy, flexMinutes: req.flexMinutes, maxWalkMeters: plan.maxWalkMeters, dates: req.dates, origin: plan.origin.location, destination: plan.destination.location, signature: 'commute-sig' },
    candidates: DEMO_LEGS.filter((l) => l.direction === plan.direction).flatMap((l) => {
      const pickup = choosePickup(l, plan, DEMO_PICKUP_POINTS)
      if (!pickup) return []
      return [{
        public: { id: l.id, legId: l.id, driver: { firstName: l.driver.firstName }, pickup: { label: pickup.label, ...pickup.location }, geometry: { path: { type: 'LineString' as const, coordinates: [] } } },
        private: {
          route: { type: 'LineString' as const, coordinates: l.route.map((q) => [q.lng, q.lat] as [number, number]) },
          legOrigin: l.originPlace.location, legDestination: l.destinationPlace.location, departureTime: l.departureTime,
          maxDeviationMin: l.maxDeviationMin, legDays: l.days, seatsOpen: l.seatsOpen, identityVerified: true, vehicleVerified: true,
          rating: l.driver.rating, reliability: l.driver.reliability, legSignature: `sig-${l.id}`,
        },
      }]
    }),
  }
}

interface FakeOpts { allowed?: boolean; authorizeError?: boolean; persistError?: boolean }
function fakeDb(opts: FakeOpts = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const db: Db = {
    auth: { getUser: async (jwt) => ({ data: { user: jwt === 'good-jwt' ? { id: 'user-1' } : null } }) },
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'authorize_match_search') return { data: opts.allowed ?? true, error: opts.authorizeError ? { message: 'Commute not found or account not active' } : null }
      if (name === 'match_candidates') return { data: payload(), error: null }
      if (name === 'persist_match_quotes') return { data: opts.persistError ? null : (args.p_matches as object[]).map((m, i) => ({ ...m, quoteId: `quote-${i}`, commuteId: COMMUTE })), error: opts.persistError ? { message: 'An offer changed; refresh your matches' } : null }
      throw new Error(`unexpected rpc ${name}`)
    },
  }
  return { db, calls, names: () => calls.map((c) => c.name) }
}

const post = (body: unknown, jwt: string | null = 'good-jwt') =>
  new Request('https://x.test/functions/v1/find-matches', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) })

const deps = (f: ReturnType<typeof fakeDb>, over: Partial<Deps> = {}): Deps => ({ db: f.db, mapboxSecret: null, router: demoRouter(), ...over })

describe('find-matches handler — access and abuse protection', () => {
  it('rejects a request with no sign-in before touching the database', async () => {
    const f = fakeDb()
    const res = await handle(post({ commuteId: COMMUTE }, null), deps(f))
    expect(res.status).toBe(401)
    expect(f.calls).toHaveLength(0)
  })

  it('rejects a token that does not belong to a user (e.g. the public anon key)', async () => {
    const f = fakeDb()
    expect((await handle(post({ commuteId: COMMUTE }, 'sb_publishable_xyz'), deps(f))).status).toBe(401)
    expect(f.calls).toHaveLength(0)
  })

  it('rejects malformed input', async () => {
    const f = fakeDb()
    expect((await handle(post({ commuteId: 'not-a-uuid' }), deps(f))).status).toBe(400)
    expect((await handle(post({}), deps(f))).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })

  it('answers CORS preflight and refuses other methods', async () => {
    const f = fakeDb()
    const pre = await handle(new Request('https://x.test', { method: 'OPTIONS' }), deps(f))
    expect(pre.status).toBe(200)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await handle(new Request('https://x.test', { method: 'GET' }), deps(f))).status).toBe(405)
  })

  it('stops a rate-limited searcher before any candidate data or routing is touched', async () => {
    const f = fakeDb({ allowed: false })
    const res = await handle(post({ commuteId: COMMUTE }), deps(f))
    expect(res.status).toBe(429)
    expect(f.names()).toEqual(['authorize_match_search'])
  })

  it('reports an unknown commute or suspended account as 404', async () => {
    const f = fakeDb({ authorizeError: true })
    expect((await handle(post({ commuteId: COMMUTE }), deps(f))).status).toBe(404)
    expect(f.names()).toEqual(['authorize_match_search'])
  })
})

describe('find-matches handler — results', () => {
  it('returns ranked, explainable, road-routed matches carrying a quote id, and stores exactly what it returned', async () => {
    const f = fakeDb()
    const res = await handle(post({ commuteId: COMMUTE }), deps(f))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routing).toBe('road')
    expect(body.matches.length).toBeGreaterThan(0)
    for (const m of body.matches) {
      expect(m.quoteId).toMatch(/^quote-/)
      expect(m.routing).toBe('road')
      expect(m.explanation.length).toBeGreaterThan(3)
    }
    expect(f.names()).toEqual(['authorize_match_search', 'match_candidates', 'persist_match_quotes'])
    const persist = f.calls[2].args
    expect(persist.p_signature).toBe('commute-sig')
    expect((persist.p_matches as { legId: string }[]).map((m) => m.legId)).toEqual(body.matches.map((m: { legId: string }) => m.legId))
    expect(Object.keys(persist.p_leg_signatures as object).sort()).toEqual(body.matches.map((m: { legId: string }) => m.legId).sort())
  })

  it('never sends a driver’s private route, home/work points or signature to the phone', async () => {
    const f = fakeDb()
    const wire = await (await handle(post({ commuteId: COMMUTE }), deps(f))).text()
    expect(wire).not.toMatch(/"private"|legOrigin|legDestination|legSignature|sig-/)
    for (const leg of DEMO_LEGS) expect(wire).not.toContain(leg.originPlace.location.lat.toFixed(6))
  })

  it('says routing is unavailable (503) — rather than "no match" — when every route lookup fails, and stores nothing', async () => {
    const f = fakeDb()
    const res = await handle(post({ commuteId: COMMUTE }), deps(f, { router: simulatedRouter({ failDrive: true }) }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('routing-unavailable')
    expect(f.names()).not.toContain('persist_match_quotes')
  })

  it('asks the passenger to refresh (409) when an offer changed while it was being scored', async () => {
    const f = fakeDb({ persistError: true })
    const res = await handle(post({ commuteId: COMMUTE }), deps(f))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('quotes')
  })
})

describe('find-matches handler — Mapbox token handling', () => {
  const okRoute = { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[31.2, -29.5], [31.1, -29.7]] }, distance: 30000, duration: 1800 }] }) }
  const urls = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => String(c[0]))

  it('prefers the server secret over a token sent by the app', async () => {
    const spy = vi.fn(async () => okRoute as unknown as Response)
    await handle(post({ commuteId: COMMUTE, mapboxToken: 'pk.fromapp' }), { db: fakeDb().db, mapboxSecret: 'sk.server', fetch: spy as unknown as typeof fetch })
    expect(spy).toHaveBeenCalled()
    expect(urls(spy).every((u) => u.includes('access_token=sk.server'))).toBe(true)
  })

  it('falls back to the app’s public pk. token when no secret is configured', async () => {
    const spy = vi.fn(async () => okRoute as unknown as Response)
    await handle(post({ commuteId: COMMUTE, mapboxToken: 'pk.fromapp' }), { db: fakeDb().db, mapboxSecret: null, fetch: spy as unknown as typeof fetch })
    expect(urls(spy).every((u) => u.includes('access_token=pk.fromapp'))).toBe(true)
  })

  it('refuses a client-supplied token that is not a public pk. token', async () => {
    const spy = vi.fn()
    const f = fakeDb()
    const res = await handle(post({ commuteId: COMMUTE, mapboxToken: 'sk.stolen' }), { db: f.db, mapboxSecret: null, fetch: spy as unknown as typeof fetch })
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('routing-unavailable')
    expect(spy).not.toHaveBeenCalled()
    expect(f.names()).toEqual(['authorize_match_search']) // nothing loaded, nothing routed
  })
})
