import { rankMatches, scheduleCompatibility, suggestionsFor, toMinutes, type Candidate, type MatchResult, type PassengerRequest, type RejectReason } from '@/domain/matching'
import { resolveDates, type CommuteSchedule } from '@/domain/schedule'
import type { CommutePlan, DriverProfile, LatLng, Match, Place, Weekday } from '@/domain/types'
import { distanceM } from '@/lib/geo'
import { measure, type Measured, type Router } from './routing'

/** A driver's published commute as the matching service sees it (server-side data in production). */
export interface DriverLeg {
  id: string
  driver: DriverProfile
  direction: 'to_work' | 'to_home'
  originPlace: Place
  destinationPlace: Place
  route: LatLng[] // stored normal route geometry
  days: Weekday[]
  departureTime: string
  seatsOpen: number
  maxDeviationMin: number
  monthlyContribution: number
  active: boolean
  acceptingPassengers: boolean
  members: Match['members']
}

export interface MatchingRun {
  matches: Match[]
  rejected: { id: string; reason: RejectReason }[]
  suggestions: string[]
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export function requestFromPlan(plan: CommutePlan, today = todayIso()): PassengerRequest {
  const schedule: CommuteSchedule = { scheduleMode: plan.scheduleMode, days: plan.days, startDate: plan.startDate, endDate: plan.endDate, dates: plan.dates, skipHolidays: plan.skipHolidays }
  const flex = Math.max(0, toMinutes(plan.arriveBy) - toMinutes(plan.arriveWindowStart))
  return {
    dates: resolveDates(schedule, today),
    arriveBy: plan.direction === 'to_home' ? plan.returnTime : plan.arriveBy,
    flexMinutes: flex || 15,
    direction: plan.direction,
    maxWalkMeters: plan.maxWalkMeters,
  }
}

function nearestDistanceToRoute(p: LatLng, route: LatLng[]): number {
  let best = Infinity
  for (const r of route) best = Math.min(best, distanceM(p, r))
  return best
}

/**
 * Best pickup for a leg: lowest (walk + 3 × distance-to-route) among candidates the passenger can
 * actually reach. A passenger-chosen pickup is honoured; if it is out of reach no pickup is returned.
 */
export function choosePickup(leg: DriverLeg, plan: CommutePlan, options: Place[]): Place | null {
  const origin = plan.direction === 'to_home' ? plan.destination : plan.origin
  // a preferred pickup belongs to one end of the trip: honour it only if it is at THIS start point
  const preferred = plan.preferredPickup && distanceM(plan.preferredPickup.location, origin.location) <= 3000 ? plan.preferredPickup : undefined
  const pool: Place[] = preferred ? [preferred] : options
  if (plan.maxWalkMeters === 0) return { ...origin, source: origin.source ?? 'saved_location' }
  let best: { p: Place; cost: number } | null = null
  for (const p of pool) {
    const walk = distanceM(origin.location, p.location) * 1.3
    if (walk > plan.maxWalkMeters) continue
    const cost = walk + 3 * nearestDistanceToRoute(p.location, leg.route)
    if (!best || cost < best.cost) best = { p, cost }
  }
  return best?.p ?? null
}

/**
 * choose pickups → measure with the routing provider → engine (hard filters, score, rank) → Match view-models.
 * The UI renders what comes back; it calculates nothing itself.
 */
export async function computeMatches(plan: CommutePlan, legs: DriverLeg[], pickups: Place[], router: Router, today = todayIso()): Promise<MatchingRun> {
  const request = requestFromPlan(plan, today)
  const passengerOrigin = plan.direction === 'to_home' ? plan.destination : plan.origin
  const passengerDestination = plan.direction === 'to_home' ? plan.origin : plan.destination

  const prepared: { leg: DriverLeg; pickup: Place; measured: Measured }[] = []
  const rejectedEarly: MatchingRun['rejected'] = []
  const eligible = legs.filter((l) => l.direction === plan.direction)

  await Promise.all(
    eligible.map(async (leg) => {
      // cheapest hard filter first: no shared day means no match, whatever the geometry (and no routing calls)
      if (scheduleCompatibility(request.dates, leg.days).covered.length === 0) return void rejectedEarly.push({ id: leg.id, reason: 'no-schedule-overlap' })
      const pickup = choosePickup(leg, plan, pickups)
      if (!pickup) return void rejectedEarly.push({ id: leg.id, reason: 'walk-too-far' })
      try {
        const measured = await measure(
          { driverOrigin: leg.originPlace.location, driverDestination: leg.destinationPlace.location, driverRoute: leg.route, passengerOrigin: passengerOrigin.location, pickup: pickup.location, passengerDestination: passengerDestination.location },
          router,
        )
        prepared.push({ leg, pickup, measured })
      } catch {
        rejectedEarly.push({ id: leg.id, reason: 'no-route' })
      }
    }),
  )

  const candidates: Candidate[] = prepared.map(({ leg, measured }) => ({
    id: leg.id,
    active: leg.active,
    verified: leg.driver.verification.identity === 'verified',
    vehicleActive: leg.driver.verification.vehicle !== 'unverified',
    acceptingPassengers: leg.acceptingPassengers,
    seatsOpen: leg.seatsOpen,
    days: leg.days,
    departureTime: leg.departureTime,
    maxDeviationMin: leg.maxDeviationMin,
    trustScore: Math.round((leg.driver.rating / 5) * 60 + ((leg.driver.reliability ?? 100) / 100) * 40),
    route: measured.route,
    walking: measured.walking,
  }))

  const run = rankMatches(request, candidates)
  const byId = new Map(prepared.map((p) => [p.leg.id, p]))
  const matches = run.matches.map((r) => toMatch(r, byId.get(r.id)!, plan))
  const rejected = [...rejectedEarly, ...run.rejected]
  return { matches, rejected, suggestions: suggestionsFor(rejected) }
}

/** join point → pickup → rejoin point, taken from the driver's stored route (for the map). */
function detourSegment(route: LatLng[], pickup: LatLng): LatLng[] {
  let idx = 1
  let best = Infinity
  for (let i = 1; i < route.length - 2; i++) {
    const d = distanceM(pickup, route[i])
    if (d < best) {
      best = d
      idx = i
    }
  }
  return [route[idx], pickup, route[Math.min(idx + 1, route.length - 1)]]
}

function toMatch(r: MatchResult, p: { leg: DriverLeg; pickup: Place; measured: Measured }, plan: CommutePlan): Match {
  const { leg, measured } = p
  const destination = plan.direction === 'to_home' ? plan.origin : plan.destination
  const perDay = Math.ceil(leg.monthlyContribution / (Math.max(leg.days.length, 1) * 4.33))
  const dated = plan.scheduleMode === 'dates'
  const amount = dated ? perDay * r.coveredDates.length : leg.monthlyContribution
  return {
    id: leg.id,
    direction: plan.direction,
    driver: leg.driver,
    origin: leg.originPlace,
    pickup: p.pickup,
    destination,
    geometry: { path: leg.route, deviation: detourSegment(leg.route, p.pickup.location), walking: measured.walkPath },
    routeOverlap: r.routeOverlapPercent,
    walkingDistanceM: r.walkingDistanceMeters,
    walkingMinutes: r.walkingDistanceMeters === 0 ? 0 : Math.max(1, Math.round(r.walkingDurationSeconds / 60)),
    driverDeviationMinutes: Math.round(r.totalDeviationSeconds / 60),
    pickupDeviationMinutes: Math.round(r.pickupDeviationSeconds / 60),
    additionalDistanceKm: Math.round(r.additionalDistanceMeters / 100) / 10,
    departureTime: leg.departureTime,
    pickupEta: r.estimatedPickupTime,
    arrivalEta: r.estimatedArrivalTime,
    days: leg.days,
    availableSeats: r.availableSeats,
    monthlyContribution: { driverContribution: amount, platformFee: 0, processingFee: 0, total: amount },
    compatibility: r.compatibilityScore,
    currentCommuteMinutes: Math.round(measured.route.baselineDurationS / 60),
    members: leg.members,
    pricing: dated ? 'per_day' : 'monthly',
    perDayContribution: dated ? perDay : undefined,
    bookedDays: dated ? r.coveredDates.length : undefined,
    explanation: r.explanation,
    walkingEstimated: measured.walkingEstimated,
    partial: r.partial,
    coveredDates: r.coveredDates,
    uncoveredDates: r.uncoveredDates,
  }
}
