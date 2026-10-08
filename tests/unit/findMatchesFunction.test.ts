import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DETOUR_RADIUS_M, scoreCandidates, type CandidatesPayload } from '../../supabase/functions/find-matches/core.ts'
import { ENGINE_DIR, ENGINE_FILES, engineCopy } from '../../scripts/sync-edge-engine.mjs'
import { DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter } from '@/data/demoLegs'
import { DEFAULT_PLAN } from '@/data/mock'
import { distanceM } from '@/lib/geo'
import { simulatedRouter } from '@/services/demoRouter'
import { choosePickup, computeMatches, requestFromPlan } from '@/services/matchingService'
import type { CommutePlan } from '@/domain/types'

const TODAY = '2026-10-10'
const plan = (over: Partial<CommutePlan> = {}): CommutePlan => ({ ...DEFAULT_PLAN, startDate: '2026-10-12', ...over })

/** What match_candidates returns for the demo drivers (pickup chosen the same way as in the app). */
function payloadFor(p: CommutePlan): CandidatesPayload {
  const req = requestFromPlan(p, TODAY)
  const start = p.direction === 'to_home' ? p.destination : p.origin
  const end = p.direction === 'to_home' ? p.origin : p.destination
  return {
    commute: { direction: p.direction, arriveBy: req.arriveBy, flexMinutes: req.flexMinutes, maxWalkMeters: p.maxWalkMeters, dates: req.dates, origin: start.location, destination: end.location, signature: 'commute-sig' },
    candidates: DEMO_LEGS.filter((l) => l.direction === p.direction).flatMap((l) => {
      const pickup = choosePickup(l, p, DEMO_PICKUP_POINTS)
      if (!pickup) return []
      return [{
        public: { id: l.id, legId: l.id, driver: { firstName: l.driver.firstName }, pickup: { label: pickup.label, ...pickup.location }, geometry: { path: { type: 'LineString' as const, coordinates: [] } } },
        private: {
          route: { type: 'LineString' as const, coordinates: l.route.map((q) => [q.lng, q.lat] as [number, number]) },
          legOrigin: l.originPlace.location,
          legDestination: l.destinationPlace.location,
          departureTime: l.departureTime,
          maxDeviationMin: l.maxDeviationMin,
          legDays: l.days,
          seatsOpen: l.seatsOpen,
          identityVerified: true,
          vehicleVerified: true,
          rating: l.driver.rating,
          reliability: l.driver.reliability,
          legSignature: `sig-${l.id}`,
        },
      }]
    }),
  }
}

describe('find-matches Edge Function core', () => {
  it('ranks and scores exactly like the in-app engine (same code on both sides)', async () => {
    const server = await scoreCandidates(payloadFor(plan()), demoRouter())
    const app = await computeMatches(plan(), DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter(), TODAY)
    expect(server.matches.length).toBeGreaterThan(0)
    expect(server.matches.map((m) => [m.legId, m.compatibility, m.driverDeviationMinutes, m.routeOverlap])).toEqual(
      app.matches.map((m) => [m.id, m.compatibility, m.driverDeviationMinutes, m.routeOverlap]),
    )
  })

  it('never returns the driver’s private route, home or work', async () => {
    const run = await scoreCandidates(payloadFor(plan()), demoRouter())
    const wire = JSON.stringify(run.matches)
    expect(wire).not.toMatch(/"private"|legOrigin|legDestination|legSignature/)
    for (const leg of DEMO_LEGS) {
      expect(wire).not.toContain(leg.originPlace.location.lat.toFixed(6))
    }
    for (const m of run.matches) {
      const pickup = m.pickup as { lat: number; lng: number }
      const detour = (m.geometry as { deviation: { coordinates: [number, number][] } }).deviation.coordinates
      for (const [lng, lat] of detour) expect(distanceM({ lat, lng }, pickup)).toBeLessThanOrEqual(DETOUR_RADIUS_M + 1)
    }
  })

  it('returns explainable, road-measured figures and a quote signature per match', async () => {
    const run = await scoreCandidates(payloadFor(plan()), demoRouter())
    for (const m of run.matches) {
      expect(m.routing).toBe('road')
      expect((m.explanation as string[]).length).toBeGreaterThan(3)
      expect(m.pickupEta).toMatch(/^\d\d:\d\d$/)
      expect(run.signatures[m.legId]).toBe(`sig-${m.legId}`)
    }
  })

  it('routing provider down → nothing measured, so the function can report it instead of "no match"', async () => {
    const run = await scoreCandidates(payloadFor(plan()), simulatedRouter({ failDrive: true }))
    expect(run.candidateCount).toBeGreaterThan(0)
    expect(run.measuredCount).toBe(0)
    expect(run.matches).toHaveLength(0)
  })

  it('evening leg matches drivers leaving work', async () => {
    const run = await scoreCandidates(payloadFor(plan({ direction: 'to_home' })), demoRouter())
    expect(run.matches.length).toBeGreaterThan(0)
    const evening = new Set(DEMO_LEGS.filter((l) => l.direction === 'to_home').map((l) => l.id))
    expect(run.matches.every((m) => evening.has(m.legId))).toBe(true)
  })
})

describe('shared engine copies', () => {
  it('the Edge Function runs the same engine source as the app (run scripts/sync-edge-engine.mjs)', () => {
    for (const [src, dest] of Object.entries(ENGINE_FILES)) {
      expect(readFileSync(`${ENGINE_DIR}/${dest}`, 'utf8'), `${dest} is out of date`).toBe(engineCopy(readFileSync(src, 'utf8')))
    }
  })
})
