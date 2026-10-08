import type { Weekday } from './types'

/**
 * Lifty matching engine — pure, deterministic, no UI and no network.
 *
 * Pipeline: hard filters → measurements → weighted score → deterministic ranking → explanation.
 * Measurements (walking, deviation, overlap) are supplied by the routing layer
 * (src/services/routing.ts) — this module never estimates them from straight lines.
 */

export const MATCH_WEIGHTS = {
  routeOverlap: 0.32,
  schedule: 0.22,
  pickup: 0.14,
  destination: 0.12,
  deviation: 0.1,
  walking: 0.07,
  trust: 0.03,
} as const

/** Below this a candidate is "not a strong match" and is dropped from results. */
export const MIN_SCORE = 45
/** Passenger arriving early is fine up to this long before the deadline's flexibility window. */
export const MAX_EARLY_ARRIVAL_MIN = 90

export interface PassengerRequest {
  /** Commute dates (ISO) resolved from the schedule over the planning horizon. */
  dates: string[]
  arriveBy: string // HH:mm  (to_work) — earliest departure for to_home
  flexMinutes: number // how early the passenger can arrive
  direction: 'to_work' | 'to_home'
  maxWalkMeters: number
}

export interface Candidate {
  id: string
  active: boolean
  verified: boolean
  vehicleActive: boolean
  acceptingPassengers: boolean
  seatsOpen: number
  days: Weekday[]
  departureTime: string // HH:mm, driver leaves origin
  maxDeviationMin: number
  trustScore: number // 0..100 (rating + reliability)
  route: {
    /** driver's baseline origin → destination */
    baselineDurationS: number
    baselineDistanceM: number
    /** driver origin → pickup → destination */
    matchedDurationS: number
    matchedDistanceM: number
    /** routed driving time from the driver's origin to pickup, including its detour */
    toPickupDurationS: number
    /** driving time from pickup to the passenger's destination along the matched route */
    pickupToDestinationDurationS: number
    /** extra driving needed just to reach the pickup and rejoin the route */
    pickupDeviationS: number
    /** % of the passenger's required corridor that lies on the driver's normal route (0–100) */
    overlapPercent: number
    /** distance (m) from the passenger's destination to the driver's route */
    destinationOffRouteM: number
  }
  walking: { distanceM: number; durationS: number }
}

export type RejectReason =
  | 'inactive' | 'unverified' | 'vehicle' | 'not-accepting' | 'no-seat' | 'no-schedule-overlap'
  | 'walk-too-far' | 'deviation-too-high' | 'arrives-too-late' | 'arrives-too-early' | 'no-route' | 'score-too-low'

export interface MatchResult {
  id: string
  compatibilityScore: number
  routeOverlapPercent: number
  scheduleCompatibility: number // 0..1 of the passenger's dates the driver covers
  coveredDates: string[]
  uncoveredDates: string[]
  partial: boolean
  walkingDistanceMeters: number
  walkingDurationSeconds: number
  pickupDeviationSeconds: number
  totalDeviationSeconds: number
  additionalDistanceMeters: number
  estimatedPickupTime: string // HH:mm
  estimatedArrivalTime: string // HH:mm
  availableSeats: number
  breakdown: Record<keyof typeof MATCH_WEIGHTS, number> // each 0..1 before weighting
  explanation: string[]
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export const fromMinutes = (mins: number) => {
  const t = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const weekdayOf = (iso: string): Weekday => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) as Weekday
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Schedule compatibility: which of the passenger's dates fall on days the driver drives. */
export function scheduleCompatibility(dates: string[], driverDays: Weekday[]) {
  if (dates.length === 0) return { ratio: 0, covered: [] as string[], uncovered: [] as string[] }
  const covered = dates.filter((d) => driverDays.includes(weekdayOf(d)))
  const uncovered = dates.filter((d) => !driverDays.includes(weekdayOf(d)))
  return { ratio: covered.length / dates.length, covered, uncovered }
}

/**
 * Driver deviation: how much ADDITIONAL time/distance the passenger adds versus the driver's
 * normal commute. Not the passenger's walk, not driver↔passenger distance.
 */
export function deviationOf(c: Candidate['route']) {
  return {
    totalDeviationSeconds: Math.max(0, Math.round(c.matchedDurationS - c.baselineDurationS)),
    additionalDistanceMeters: Math.max(0, Math.round(c.matchedDistanceM - c.baselineDistanceM)),
    pickupDeviationSeconds: Math.max(0, Math.round(c.pickupDeviationS)),
  }
}

export function evaluate(req: PassengerRequest, c: Candidate): MatchResult | { rejected: RejectReason } {
  // ---- hard filters (a nearby but unusable driver must never score well) ----
  if (!c.active) return { rejected: 'inactive' }
  if (!c.verified) return { rejected: 'unverified' }
  if (!c.vehicleActive) return { rejected: 'vehicle' }
  if (!c.acceptingPassengers) return { rejected: 'not-accepting' }
  if (c.seatsOpen <= 0) return { rejected: 'no-seat' }
  const metrics = [...Object.values(c.route), c.walking.distanceM, c.walking.durationS, c.maxDeviationMin, req.maxWalkMeters, req.flexMinutes]
  if (metrics.some(n => !Number.isFinite(n) || n < 0) || !Number.isFinite(c.seatsOpen) || !Number.isFinite(c.trustScore)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.departureTime.slice(0, 5)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(req.arriveBy.slice(0, 5)))
    return { rejected: 'no-route' }
  if (!(c.route.baselineDurationS > 0) || !(c.route.matchedDurationS > 0)) return { rejected: 'no-route' }
  const sched = scheduleCompatibility(req.dates, c.days)
  if (sched.covered.length === 0) return { rejected: 'no-schedule-overlap' }
  if (c.walking.distanceM > req.maxWalkMeters) return { rejected: 'walk-too-far' }

  const dev = deviationOf(c.route)
  if (dev.totalDeviationSeconds / 60 > c.maxDeviationMin) return { rejected: 'deviation-too-high' }

  // ---- arrival-time feasibility ----
  const departure = toMinutes(c.departureTime)
  // The origin→pickup road route already includes the pickup detour. Adding
  // pickupDeviation again would delay both pickup and arrival a second time.
  const pickupAt = departure + c.route.toPickupDurationS / 60
  const arriveAt = pickupAt + c.route.pickupToDestinationDurationS / 60
  if (req.direction === 'to_work') {
    const deadline = toMinutes(req.arriveBy)
    if (arriveAt > deadline) return { rejected: 'arrives-too-late' }
    if (arriveAt < deadline - req.flexMinutes - MAX_EARLY_ARRIVAL_MIN) return { rejected: 'arrives-too-early' }
  } else {
    // to_home: passenger can't leave before arriveBy; pickup must be soon after
    const earliest = toMinutes(req.arriveBy)
    if (pickupAt < earliest) return { rejected: 'arrives-too-early' }
    if (pickupAt > earliest + req.flexMinutes + MAX_EARLY_ARRIVAL_MIN) return { rejected: 'arrives-too-late' }
  }

  // ---- scoring: every factor normalised to 0..1 ----
  const deadlineSlack = req.direction === 'to_work' ? toMinutes(req.arriveBy) - arriveAt : 0
  // arriving much earlier than needed is allowed but less attractive (timing fit 1 → 0 over 90 min)
  const earlyBy = req.direction === 'to_work' ? Math.max(0, deadlineSlack - req.flexMinutes) : Math.max(0, pickupAt - toMinutes(req.arriveBy) - req.flexMinutes)
  const timingFit = clamp01(1 - earlyBy / MAX_EARLY_ARRIVAL_MIN)
  const breakdown = {
    routeOverlap: clamp01(c.route.overlapPercent / 100),
    schedule: sched.ratio * timingFit,
    pickup: clamp01(1 - dev.pickupDeviationSeconds / 60 / Math.max(c.maxDeviationMin, 1)),
    destination: clamp01(1 - c.route.destinationOffRouteM / 1500),
    deviation: clamp01(1 - dev.totalDeviationSeconds / 60 / Math.max(c.maxDeviationMin, 1)),
    walking: req.maxWalkMeters > 0 ? clamp01(1 - c.walking.distanceM / req.maxWalkMeters) : 1,
    trust: clamp01(c.trustScore / 100),
  }
  let score = 0
  for (const k of Object.keys(MATCH_WEIGHTS) as (keyof typeof MATCH_WEIGHTS)[]) score += breakdown[k] * MATCH_WEIGHTS[k]
  score = Math.round(score * 100)
  if (score < MIN_SCORE) return { rejected: 'score-too-low' }

  const explanation = [
    `${Math.round(c.route.overlapPercent)}% of your route is on their normal route`,
    c.walking.distanceM === 0 ? 'Picked up at your address — no walking' : `${Math.max(1, Math.round(c.walking.durationS / 60))} min (${Math.round(c.walking.distanceM)} m) walk to pickup`,
    `+${Math.round(dev.totalDeviationSeconds / 60)} min for the driver (${dev.pickupDeviationSeconds ? `+${Math.round(dev.pickupDeviationSeconds / 60)} min to reach you` : 'no detour to reach you'})`,
    `Arrives ${fromMinutes(arriveAt)}${req.direction === 'to_work' ? ` — ${Math.round(deadlineSlack)} min before your deadline` : ''}`,
    sched.uncovered.length === 0 ? 'Drives every day you need' : `Drives ${sched.covered.length} of your ${req.dates.length} days`,
  ]

  return {
    id: c.id,
    compatibilityScore: score,
    routeOverlapPercent: Math.round(c.route.overlapPercent),
    scheduleCompatibility: sched.ratio,
    coveredDates: sched.covered,
    uncoveredDates: sched.uncovered,
    partial: sched.uncovered.length > 0,
    walkingDistanceMeters: Math.round(c.walking.distanceM),
    walkingDurationSeconds: Math.round(c.walking.durationS),
    pickupDeviationSeconds: dev.pickupDeviationSeconds,
    totalDeviationSeconds: dev.totalDeviationSeconds,
    additionalDistanceMeters: dev.additionalDistanceMeters,
    estimatedPickupTime: fromMinutes(pickupAt),
    estimatedArrivalTime: fromMinutes(arriveAt),
    availableSeats: c.seatsOpen,
    breakdown,
    explanation,
  }
}

export interface MatchRun {
  matches: MatchResult[]
  rejected: { id: string; reason: RejectReason }[]
}

/** Evaluate every candidate and rank deterministically: score ↓, deviation ↑, walk ↑, id. */
export function rankMatches(req: PassengerRequest, candidates: Candidate[]): MatchRun {
  const matches: MatchResult[] = []
  const rejected: MatchRun['rejected'] = []
  for (const c of candidates) {
    const r = evaluate(req, c)
    if ('rejected' in r) rejected.push({ id: c.id, reason: r.rejected })
    else matches.push(r)
  }
  matches.sort(
    (a, b) =>
      b.compatibilityScore - a.compatibilityScore ||
      a.totalDeviationSeconds - b.totalDeviationSeconds ||
      a.walkingDistanceMeters - b.walkingDistanceMeters ||
      a.id.localeCompare(b.id),
  )
  return { matches, rejected }
}

/** Plain-language reasons for the empty state ("what would help"). */
export function suggestionsFor(rejected: MatchRun['rejected']): string[] {
  const n = (r: RejectReason) => rejected.filter((x) => x.reason === r).length
  const out: string[] = []
  if (n('no-schedule-overlap')) out.push('Change travel days — some drivers don’t drive on the days you picked')
  if (n('walk-too-far')) out.push('Increase walking distance — nearby drivers need a longer walk')
  if (n('arrives-too-late')) out.push('Adjust arrival time — drivers would get you there after your deadline')
  if (n('deviation-too-high')) out.push('Pick a pickup or drop-off closer to a main road — the detour is more than nearby drivers allow')
  if (n('no-seat')) out.push('Save this commute — matching drivers are full right now')
  return out
}
