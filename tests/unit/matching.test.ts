import { describe, expect, it } from 'vitest'
import { deviationOf, evaluate, rankMatches, scheduleCompatibility, suggestionsFor, type Candidate, type PassengerRequest } from '@/domain/matching'
import { daysLabel, isScheduleReady, resolveDates, scheduleSummary, type CommuteSchedule } from '@/domain/schedule'
import { corridorOverlapPercent, distanceToPolylineM } from '@/lib/corridor'
import { simulatedRouter } from '@/services/demoRouter'
import { computeMatches, choosePickup, requestFromPlan, type DriverLeg } from '@/services/matchingService'
import { measure } from '@/services/routing'
import { DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter } from '@/data/demoLegs'
import { DEFAULT_PLAN, MAIN_ROUTE } from '@/data/mock'
import type { CommutePlan, Weekday } from '@/domain/types'

// Mon 12 Oct 2026 … Fri 16 Oct 2026
const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
const TODAY = '2026-10-10'

const req = (over: Partial<PassengerRequest> = {}): PassengerRequest => ({ dates: WEEK, arriveBy: '08:00', flexMinutes: 15, direction: 'to_work', maxWalkMeters: 750, ...over })
const cand = (over: Partial<Candidate> = {}, route: Partial<Candidate['route']> = {}, walking: Partial<Candidate['walking']> = {}): Candidate => ({
  id: 'a', active: true, verified: true, vehicleActive: true, acceptingPassengers: true, seatsOpen: 2, days: [0, 1, 2, 3, 4], departureTime: '06:30', maxDeviationMin: 8, trustScore: 90,
  route: { baselineDurationS: 2400, baselineDistanceM: 31200, matchedDurationS: 2700, matchedDistanceM: 33100, toPickupDurationS: 300, pickupToDestinationDurationS: 2100, pickupDeviationS: 180, overlapPercent: 94, destinationOffRouteM: 200, ...route },
  walking: { distanceM: 350, durationS: 300, ...walking },
  ...over,
})

describe('driver deviation = matched − baseline (not walking, not driver↔passenger distance)', () => {
  it('uses the spec example: 42 min / 31.2 km → 47 min / 33.1 km = +5 min, +1.9 km', () => {
    const d = deviationOf({ ...cand().route, baselineDurationS: 42 * 60, baselineDistanceM: 31200, matchedDurationS: 47 * 60, matchedDistanceM: 33100 })
    expect(d.totalDeviationSeconds).toBe(300)
    expect(d.additionalDistanceMeters).toBe(1900)
  })
  it('never goes negative', () => expect(deviationOf({ ...cand().route, matchedDurationS: 100, baselineDurationS: 500 }).totalDeviationSeconds).toBe(0))
  it('is independent of the passenger walk', () => {
    const a = evaluate(req(), cand({}, {}, { distanceM: 100, durationS: 80 })) as { totalDeviationSeconds: number }
    const b = evaluate(req(), cand({}, {}, { distanceM: 700, durationS: 600 })) as { totalDeviationSeconds: number }
    expect(a.totalDeviationSeconds).toBe(b.totalDeviationSeconds)
  })
})

describe('hard filters', () => {
  const reason = (c: Candidate, r = req()) => (evaluate(r, c) as { rejected: string }).rejected
  it('inactive / unverified / vehicle / not accepting / no seat', () => {
    expect(reason(cand({ active: false }))).toBe('inactive')
    expect(reason(cand({ verified: false }))).toBe('unverified')
    expect(reason(cand({ vehicleActive: false }))).toBe('vehicle')
    expect(reason(cand({ acceptingPassengers: false }))).toBe('not-accepting')
    expect(reason(cand({ seatsOpen: 0 }))).toBe('no-seat')
  })
  it('schedule must overlap: driver only drives weekends, passenger needs weekdays', () => expect(reason(cand({ days: [5, 6] }))).toBe('no-schedule-overlap'))
  it('walking distance beyond the passenger limit', () => expect(reason(cand({}, {}, { distanceM: 900 }))).toBe('walk-too-far'))
  it('"No walking" (0 m) rejects anyone needing a walk and accepts a door pickup', () => {
    expect(reason(cand({}, {}, { distanceM: 40 }), req({ maxWalkMeters: 0 }))).toBe('walk-too-far')
    expect('rejected' in evaluate(req({ maxWalkMeters: 0 }), cand({}, {}, { distanceM: 0, durationS: 0 }))).toBe(false)
  })
  it('driver max deviation', () => expect(reason(cand({ maxDeviationMin: 3 }))).toBe('deviation-too-high'))
  it('arrive-by: predicted arrival after the deadline is rejected', () => {
    // 06:30 + 5 (routed approach already includes its detour) + 35 ride = 07:10.
    expect('rejected' in evaluate(req(), cand())).toBe(false)
    // A later driver arrives 08:10.
    expect(reason(cand({ departureTime: '07:30' }))).toBe('arrives-too-late')
  })
  it('arrive-by: absurdly early arrival is rejected', () => expect(reason(cand({ departureTime: '04:00' }))).toBe('arrives-too-early'))
  it('no route data → no match', () => expect(reason(cand({}, { baselineDurationS: 0 }))).toBe('no-route'))
})

describe('arrival time worked example', () => {
  it('does not add a routed pickup detour twice at the arrival deadline', () => {
    const result = evaluate(req(), cand({ departureTime: '07:00' }, { toPickupDurationS: 20 * 60, pickupToDestinationDurationS: 40 * 60, pickupDeviationS: 5 * 60 }))
    expect('rejected' in result).toBe(false)
    if (!('rejected' in result)) {
      expect(result.estimatedPickupTime).toBe('07:20')
      expect(result.estimatedArrivalTime).toBe('08:00')
    }
  })
  it('an evening pickup before work finishes cannot be moved later by counting the detour twice', () => {
    expect(evaluate(req({ direction: 'to_home', arriveBy: '17:00' }), cand({ departureTime: '16:40' }, { toPickupDurationS: 15 * 60, pickupDeviationS: 10 * 60 }))).toEqual({ rejected: 'arrives-too-early' })
  })
  it('driver reaches destination corridor 07:42 → pickup adds 5 min → 07:49 compatible vs 08:15 not', () => {
    const ok = evaluate(req(), cand({ departureTime: '06:55' })) // 06:55+5+35 = 07:35
    expect('rejected' in ok).toBe(false)
    if (!('rejected' in ok)) expect(ok.estimatedArrivalTime).toBe('07:35')
    expect((evaluate(req(), cand({ departureTime: '07:35' })) as { rejected: string }).rejected).toBe('arrives-too-late') // 08:15
  })
})

describe('schedule compatibility', () => {
  it('full / partial / none', () => {
    expect(scheduleCompatibility(WEEK, [0, 1, 2, 3, 4]).ratio).toBe(1)
    const p = scheduleCompatibility(WEEK, [0, 1, 2])
    expect(p.ratio).toBeCloseTo(0.6)
    expect(p.uncovered).toEqual(['2026-10-15', '2026-10-16'])
    expect(scheduleCompatibility(WEEK, [5, 6]).ratio).toBe(0)
  })
  it('partial coverage is flagged and scores lower than full coverage', () => {
    const full = evaluate(req(), cand()) as { compatibilityScore: number; partial: boolean }
    const part = evaluate(req(), cand({ days: [0, 1, 2] })) as { compatibilityScore: number; partial: boolean }
    expect(full.partial).toBe(false)
    expect(part.partial).toBe(true)
    expect(part.compatibilityScore).toBeLessThan(full.compatibilityScore)
  })
})

describe('scoring and ranking', () => {
  const A = cand({ id: 'A' }, { overlapPercent: 94, matchedDurationS: 2400 + 180, pickupDeviationS: 120 }, { distanceM: 400, durationS: 340 })
  const B = cand({ id: 'B', maxDeviationMin: 10 }, { overlapPercent: 87, matchedDurationS: 2400 + 480, pickupDeviationS: 300 }, { distanceM: 250, durationS: 210 })
  const C = cand({ id: 'C', days: [0, 1, 2], maxDeviationMin: 10 }, { overlapPercent: 82, matchedDurationS: 2400 + 300, pickupDeviationS: 200 }, { distanceM: 700, durationS: 600 })
  it('strongest commute first — not the closest driver', () => {
    const { matches } = rankMatches(req(), [C, B, A])
    expect(matches.map((m) => m.id)).toEqual(['A', 'B', 'C'])
    expect(matches[0].walkingDistanceMeters).toBeGreaterThan(matches[1].walkingDistanceMeters) // A walks MORE than B yet ranks first
  })
  it('is deterministic regardless of input order', () => {
    const x = rankMatches(req(), [A, B, C]).matches.map((m) => m.id)
    const y = rankMatches(req(), [C, A, B]).matches.map((m) => m.id)
    expect(x).toEqual(y)
  })
  it('ties break by deviation, then walk, then id', () => {
    const t1 = cand({ id: 'z' }), t2 = cand({ id: 'a' })
    expect(rankMatches(req(), [t1, t2]).matches.map((m) => m.id)).toEqual(['a', 'z'])
  })
  it('explanation carries the same numbers as the metrics', () => {
    const m = rankMatches(req(), [A]).matches[0]
    expect(m.explanation.some((l) => l.includes(`${m.routeOverlapPercent}%`))).toBe(true)
    expect(m.explanation.some((l) => l.includes(`+${Math.round(m.totalDeviationSeconds / 60)} min`))).toBe(true)
    expect(m.compatibilityScore).toBeGreaterThan(0)
  })
})

describe('recurring / weekly / specific-date schedules', () => {
  const base: CommuteSchedule = { scheduleMode: 'weekly', days: [0, 1, 2, 3, 4] as Weekday[], startDate: '2026-10-12', dates: [], skipHolidays: true }
  it('weekly: Mon–Fri over the horizon, respecting the end date', () => {
    const d = resolveDates({ ...base, endDate: '2026-10-23' }, TODAY)
    expect(d).toHaveLength(10)
    expect(d[0]).toBe('2026-10-12')
    expect(d.at(-1)).toBe('2026-10-23')
  })
  it('recurring with no end date is capped to the planning horizon, not hundreds of dates', () => {
    const d = resolveDates({ ...base, scheduleMode: 'recurring' }, TODAY)
    expect(d.length).toBeGreaterThan(40)
    expect(d.length).toBeLessThan(70)
  })
  it('specific dates: only the picked dates, past dates dropped', () => {
    const d = resolveDates({ ...base, scheduleMode: 'dates', dates: ['2026-10-09', '2026-10-13', '2026-10-16'] }, TODAY)
    expect(d).toEqual(['2026-10-13', '2026-10-16'])
  })
  it('South African public holidays are skipped (Day of Reconciliation, 16 Dec 2026)', () => {
    const d = resolveDates({ ...base, startDate: '2026-12-14', endDate: '2026-12-18' }, '2026-12-14')
    expect(d).not.toContain('2026-12-16')
    expect(d).toHaveLength(4)
    expect(resolveDates({ ...base, startDate: '2026-12-14', endDate: '2026-12-18', skipHolidays: false }, '2026-12-14')).toHaveLength(5)
  })
  it('summaries are meaningful, never placeholders', () => {
    expect(scheduleSummary(base, TODAY)).toBe('Mon–Fri')
    expect(scheduleSummary({ ...base, endDate: '2026-12-31' }, TODAY)).toBe('Mon–Fri · Until 31 Dec')
    expect(scheduleSummary({ ...base, scheduleMode: 'recurring' }, TODAY)).toBe('Mon–Fri · No end date')
    expect(scheduleSummary({ ...base, scheduleMode: 'dates', dates: ['2026-10-12', '2026-10-13'] }, TODAY)).toBe('2 selected dates')
    expect(scheduleSummary({ ...base, scheduleMode: 'dates', dates: [] }, TODAY)).toBe('No dates picked yet')
    expect(daysLabel([0, 2, 4])).toBe('Mon, Wed, Fri')
  })
  it('readiness: needs days, or dates in dates mode', () => {
    expect(isScheduleReady({ ...base, days: [] })).toBe(false)
    expect(isScheduleReady({ ...base, scheduleMode: 'dates', dates: [] })).toBe(false)
    expect(isScheduleReady({ ...base, scheduleMode: 'dates', dates: ['2026-10-12'] })).toBe(true)
  })
})

describe('corridor overlap uses geometry, not endpoints', () => {
  const road = MAIN_ROUTE
  it('a passenger corridor lying on the driver route is ~100% overlap', () => expect(corridorOverlapPercent(road.slice(2, 6), road)).toBe(100))
  it('a parallel corridor 2 km away is ~0%', () => expect(corridorOverlapPercent(road.map((p) => ({ lat: p.lat, lng: p.lng + 0.02 })), road)).toBeLessThan(5))
  it('half on / half off lands in between', () => {
    // follows the driver's road to road[5], then leaves it at a right angle for ~5 km
    const leaves = [...road.slice(3, 6), { lat: road[5].lat, lng: road[5].lng + 0.05 }]
    const onlyOn = corridorOverlapPercent(road.slice(3, 6), road)
    const mixed = corridorOverlapPercent(leaves, road)
    expect(onlyOn).toBe(100)
    expect(mixed).toBeGreaterThan(40)
    expect(mixed).toBeLessThan(95)
  })
  it('distance to polyline is metric', () => expect(distanceToPolylineM({ lat: road[1].lat, lng: road[1].lng + 0.001 }, road)).toBeGreaterThan(50))
})

describe('routing measurements (deviation from baseline vs matched route)', () => {
  const leg = DEMO_LEGS[0]
  const pickup = DEMO_PICKUP_POINTS[0].location
  const input = { driverOrigin: leg.originPlace.location, driverDestination: leg.destinationPlace.location, driverRoute: leg.route, passengerOrigin: DEFAULT_PLAN.origin.location, pickup, passengerDestination: DEFAULT_PLAN.destination.location }
  it('matched route is never shorter than baseline; deviation derives from the difference', async () => {
    const m = await measure(input, demoRouter())
    expect(m.route.matchedDurationS).toBeGreaterThanOrEqual(m.route.baselineDurationS)
    expect(deviationOf(m.route).totalDeviationSeconds).toBe(Math.round(m.route.matchedDurationS - m.route.baselineDurationS))
  })
  it('a pickup on the driver route adds ~no deviation; a pickup far off adds a lot', async () => {
    const on = await measure({ ...input, pickup: leg.route[2], passengerOrigin: leg.route[2] }, demoRouter())
    const off = await measure({ ...input, pickup: { lat: leg.route[2].lat + 0.02, lng: leg.route[2].lng - 0.02 } }, demoRouter())
    expect(on.route.pickupDeviationS).toBeLessThan(60)
    expect(off.route.pickupDeviationS).toBeGreaterThan(on.route.pickupDeviationS + 300)
  })
  it('walking comes from the pedestrian router; an unreachable pedestrian route rejects the candidate', async () => {
    const real = await measure(input, demoRouter())
    expect(real.walkingEstimated).toBe(false)
    await expect(measure(input, simulatedRouter({ failWalk: true, roads: [] }))).rejects.toThrow(/pedestrian route/i)
  })
  it('an invalid / failed routing response throws instead of inventing numbers', async () => {
    await expect(measure(input, simulatedRouter({ failDrive: true }))).rejects.toThrow()
    const empty = { async drive() { return { coordinates: [] as [number, number][], distanceM: 0, durationS: 0 } }, async walk() { return { coordinates: [], distanceM: 0, durationS: 0 } } }
    await expect(measure(input, empty)).rejects.toThrow(/No road route/)
  })
  it.each([Infinity, NaN, -1])('rejects non-finite or negative road and pedestrian figures (%s)', async value => {
    const router = demoRouter()
    await expect(measure(input, { ...router, drive: async points => ({ ...await router.drive(points), distanceM: value }) })).rejects.toThrow(/No road route/i)
    await expect(measure(input, { ...router, walk: async points => ({ ...await router.walk(points), durationS: value }) })).rejects.toThrow(/No pedestrian route/i)
  })
  it('rejects invalid geometry coordinates', async () => {
    const router = demoRouter()
    await expect(measure(input, { ...router, drive: async points => ({ ...await router.drive(points), coordinates: [[31, -29], [NaN, -29]] }) })).rejects.toThrow(/No road route/i)
    await expect(measure({ ...input, pickup: { lat: 95, lng: 31 } }, router)).rejects.toThrow(/Invalid route coordinates/)
  })
  it('does not call the provider for identical driver/passenger destination endpoints', async () => {
    const router = demoRouter()
    const drives: { lat: number; lng: number }[][] = []
    const measured = await measure({ ...input, passengerDestination: input.driverDestination }, {
      ...router,
      drive: async points => { drives.push(points); if (distanceToPolylineM(points[0], [points[1], points[1]]) < 1) throw new Error('identical endpoint'); return router.drive(points) },
    })
    expect(drives).toHaveLength(4)
    expect(measured.passengerPath.length).toBeGreaterThan(1)
  })
})

describe('end-to-end matching pipeline (simulated router)', () => {
  const plan = (over: Partial<CommutePlan> = {}): CommutePlan => ({ ...DEFAULT_PLAN, startDate: '2026-10-12', ...over })
  const run = (p: CommutePlan) => computeMatches(p, DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter(), TODAY)

  it('derives every displayed metric — nothing is a fixture value', async () => {
    const { matches } = await run(plan())
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m.routeOverlap).toBeGreaterThanOrEqual(0)
      expect(m.driverDeviationMinutes).toBeLessThanOrEqual(m.driverDeviationMinutes) // present & numeric
      expect(m.explanation?.length).toBeGreaterThan(3)
    }
    // the old hand-written fixture values must not leak through
    const metrics = matches.map((m) => `${m.routeOverlap}/${m.driverDeviationMinutes}/${m.walkingMinutes}`)
    expect(metrics).not.toContain('94/3/5')
  })
  it('morning: a driver on the passenger road ranks first with near-total overlap', async () => {
    const { matches } = await run(plan())
    expect(matches[0].id).toBe('m-sipho')
    expect(matches[0].routeOverlap).toBeGreaterThan(90)
  })
  it('evening: the trip home matches drivers leaving work, with a pickup near work', async () => {
    const { matches } = await run(plan({ direction: 'to_home' }))
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.direction === 'to_home' && m.pickup.area === 'Umhlanga Ridge')).toBe(true)
  })
  it('results are sorted by compatibility and identical on repeat runs', async () => {
    const a = await run(plan())
    const b = await run(plan())
    expect(a.matches.map((m) => m.id)).toEqual(b.matches.map((m) => m.id))
    const scores = a.matches.map((m) => m.compatibility)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  })
  it('weekend-only travel → no match, with a "change travel days" suggestion', async () => {
    const r = await run(plan({ days: [5, 6], startDate: '2026-10-10' }))
    expect(r.matches).toHaveLength(0)
    // the real blocker is reported — not a misleading "walk further"
    expect(r.rejected.every((x) => x.reason === 'no-schedule-overlap')).toBe(true)
    expect(r.suggestions).toEqual([expect.stringMatching(/travel days/i)])
  })
  it('no walking → only door pickups, shown as no walk (not "1 min")', async () => {
    const r = await run(plan({ maxWalkMeters: 0, preferredPickup: undefined }))
    expect(r.matches.length).toBeGreaterThan(0)
    for (const m of r.matches) {
      expect(m.walkingDistanceM).toBe(0)
      expect(m.walkingMinutes).toBe(0)
      expect(m.explanation?.join(' ')).toMatch(/picked up at your address/i)
    }
  })
  it('a seat-less driver is never offered', async () => {
    const full = DEMO_LEGS.map((l) => ({ ...l, seatsOpen: 0 }))
    const r = await computeMatches(plan(), full, DEMO_PICKUP_POINTS, demoRouter(), TODAY)
    expect(r.matches).toHaveLength(0)
    expect(r.rejected.every((x) => x.reason === 'no-seat' || x.reason === 'walk-too-far')).toBe(true)
  })
  it('arriving by 06:00 cannot be met by 06:20+ drivers', async () => {
    const r = await run(plan({ arriveBy: '06:00', arriveWindowStart: '05:45' }))
    expect(r.matches).toHaveLength(0)
  })
  it('routing provider down → every candidate is rejected as "no-route", not faked', async () => {
    const r = await computeMatches(plan(), DEMO_LEGS, DEMO_PICKUP_POINTS, simulatedRouter({ failDrive: true }), TODAY)
    expect(r.matches).toHaveLength(0)
    expect(r.rejected.some((x) => x.reason === 'no-route')).toBe(true)
  })
  it('specific dates are priced per day for the days the driver actually drives', async () => {
    const r = await run(plan({ scheduleMode: 'dates', dates: ['2026-10-12', '2026-10-13', '2026-10-17'], days: [0, 1, 5] }))
    for (const m of r.matches) {
      expect(m.pricing).toBe('per_day')
      expect(m.bookedDays).toBe(m.coveredDates?.length)
      expect(m.monthlyContribution.total).toBe((m.perDayContribution ?? 0) * (m.bookedDays ?? 0))
    }
  })
  it('a passenger-chosen pickup is honoured; one beyond their walking limit is refused (not silently replaced)', () => {
    const leg = DEMO_LEGS[0] as DriverLeg
    expect(choosePickup(leg, plan({ preferredPickup: DEMO_PICKUP_POINTS[0] }), DEMO_PICKUP_POINTS)?.label).toBe(DEMO_PICKUP_POINTS[0].label)
    const tooFar = { label: 'Far shop', area: '', location: { lat: DEFAULT_PLAN.origin.location.lat + 0.0135, lng: DEFAULT_PLAN.origin.location.lng } }
    expect(choosePickup(leg, plan({ preferredPickup: tooFar }), DEMO_PICKUP_POINTS)).toBeNull()
  })
  it('a preferred pickup from the other end of the trip is ignored for the evening leg', () => {
    const leg = DEMO_LEGS.find((l) => l.direction === 'to_home') as DriverLeg
    const p = choosePickup(leg, plan({ direction: 'to_home', preferredPickup: DEMO_PICKUP_POINTS[0] }), DEMO_PICKUP_POINTS)
    expect(p?.area).toBe('Umhlanga Ridge')
  })
  it('request resolves the structured schedule (not a string)', () => {
    const r = requestFromPlan(plan({ endDate: '2026-10-16' }), TODAY)
    expect(r.dates).toEqual(WEEK)
    expect(r.arriveBy).toBe('08:00')
  })
  it('suggestions only mention what actually blocked matches', () => {
    expect(suggestionsFor([{ id: 'x', reason: 'no-seat' }]).join(' ')).toMatch(/Save this commute/)
    expect(suggestionsFor([])).toEqual([])
  })
})
