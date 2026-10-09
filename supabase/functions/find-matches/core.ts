// Pure core of find-matches: candidates in, public matches out. No Deno, network or database APIs,
// so the unit tests run it with the simulated router (tests/unit/findMatchesFunction.test.ts).
import { rankMatches, suggestionsFor, type Candidate, type PassengerRequest, type RejectReason } from './engine/matching.ts'
import { measure, type Measured, type Router } from './engine/measure.ts'
import type { LatLng, Weekday } from './engine/types.ts'

/** Candidates measured per request — bounds Mapbox usage (≤ 6 Directions calls each). */
export const MAX_CANDIDATES = 12
const CONCURRENCY = 4
/** Retained for caller compatibility. Private driver approach geometry is never returned. */
export const DETOUR_RADIUS_M = 800

interface GeoLine { type: 'LineString'; coordinates: [number, number][] }
interface Point { lat: number; lng: number }

/** Shape returned by the match_candidates SQL function. */
export interface CandidateRow {
  /** safe to show the passenger */
  public: Record<string, unknown> & { legId: string; pickup: Point & { label: string }; geometry: { path: GeoLine } }
  /** never leaves the function */
  private: {
    route: GeoLine
    legOrigin: Point
    legDestination: Point
    departureTime: string
    maxDeviationMin: number
    legDays: number[]
    seatsOpen: number
    identityVerified: boolean
    vehicleVerified: boolean
    rating: number | null
    reliability: number | null
    legSignature: string
  }
}
export interface CandidatesPayload {
  commute: {
    direction: 'to_work' | 'to_home'
    arriveBy: string
    flexMinutes: number
    maxWalkMeters: number
    dates: string[]
    origin: Point
    destination: Point
    signature: string
  }
  candidates: CandidateRow[]
}

export interface PublicMatch extends Record<string, unknown> {
  legId: string
}
export interface ScoredRun {
  matches: PublicMatch[]
  /** leg signature for each returned match (stored with the quote, not sent to the phone) */
  signatures: Record<string, string>
  suggestions: string[]
  /** why each candidate that did not make the list was dropped (hard filter or score) — for logs and debugging */
  rejected: { id: string; reason: RejectReason }[]
  measuredCount: number
  candidateCount: number
}

const pt = (p: Point): LatLng => ({ lat: Number(p.lat), lng: Number(p.lng) })
const fromGeoJson = (g: GeoLine | null | undefined): LatLng[] => (g?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }))
const toGeoJson = (path: LatLng[]): GeoLine => ({ type: 'LineString', coordinates: path.map((p) => [+p.lng.toFixed(6), +p.lat.toFixed(6)]) })

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

export async function scoreCandidates(data: CandidatesPayload, router: Router, log: (msg: string) => void = () => {}): Promise<ScoredRun> {
  const { commute } = data
  const pool = data.candidates.slice(0, MAX_CANDIDATES)
  const request: PassengerRequest = {
    dates: commute.dates,
    arriveBy: commute.arriveBy,
    flexMinutes: Number(commute.flexMinutes) || 15,
    direction: commute.direction,
    maxWalkMeters: Number(commute.maxWalkMeters),
  }
  const passengerOrigin = pt(commute.origin)
  const passengerDestination = pt(commute.destination)

  const measured = new Map<string, { c: CandidateRow; m: Measured }>()
  const rejected: { id: string; reason: RejectReason }[] = []
  await inBatches(pool, CONCURRENCY, async (c) => {
    try {
      const m = await measure(
        {
          driverOrigin: pt(c.private.legOrigin),
          driverDestination: pt(c.private.legDestination),
          driverRoute: fromGeoJson(c.private.route),
          passengerOrigin,
          pickup: pt(c.public.pickup),
          passengerDestination,
        },
        router,
      )
      measured.set(c.public.legId, { c, m })
    } catch (e) {
      log(`measure failed for ${c.public.legId}: ${e instanceof Error ? e.message : String(e)}`)
      rejected.push({ id: c.public.legId, reason: 'no-route' })
    }
  })

  const candidates: Candidate[] = [...measured.values()].map(({ c, m }) => ({
    id: c.public.legId,
    active: true, // match_candidates only returns active legs of approved drivers
    verified: c.private.identityVerified === true,
    vehicleActive: c.private.vehicleVerified === true,
    acceptingPassengers: true,
    seatsOpen: Number(c.private.seatsOpen),
    days: c.private.legDays.map((d) => d as Weekday),
    departureTime: c.private.departureTime,
    maxDeviationMin: Number(c.private.maxDeviationMin),
    trustScore: Math.round((Number(c.private.rating ?? 5) / 5) * 60 + (Number(c.private.reliability ?? 100) / 100) * 40),
    route: m.route,
    walking: m.walking,
  }))
  const run = rankMatches(request, candidates)

  const signatures: Record<string, string> = {}
  const matches = run.matches.map((r): PublicMatch => {
    const { c, m } = measured.get(r.id)!
    signatures[r.id] = c.private.legSignature
    return {
      ...c.public,
      geometry: {
        path: toGeoJson(m.passengerPath),
        // Even a short approach can disclose a home inside the pickup radius.
        // Keep the complete approach and post-drop-off continuation server-only.
        deviation: toGeoJson([]),
        walking: toGeoJson(m.walkPath),
      },
      routeOverlap: r.routeOverlapPercent,
      walkingDistanceM: r.walkingDistanceMeters,
      walkingMinutes: r.walkingDistanceMeters === 0 ? 0 : Math.max(1, Math.round(r.walkingDurationSeconds / 60)),
      driverDeviationMinutes: Math.round(r.totalDeviationSeconds / 60),
      pickupDeviationMinutes: Math.round(r.pickupDeviationSeconds / 60),
      additionalDistanceKm: Math.round(r.additionalDistanceMeters / 100) / 10,
      pickupEta: r.estimatedPickupTime,
      arrivalEta: r.estimatedArrivalTime,
      currentCommuteMinutes: Math.round(m.route.baselineDurationS / 60),
      compatibility: r.compatibilityScore,
      explanation: r.explanation,
      coveredDates: r.coveredDates,
      uncoveredDates: r.uncoveredDates,
      coveredDays: [...new Set(r.coveredDates.map(date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7))].sort(),
      uncoveredDays: [...new Set(r.uncoveredDates.map(date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7))].sort(),
      partial: r.partial,
      walkingEstimated: m.walkingEstimated,
      routing: 'road',
    }
  })

  return {
    matches,
    signatures,
    suggestions: suggestionsFor([...rejected, ...run.rejected]),
    rejected: [...rejected, ...run.rejected],
    measuredCount: measured.size,
    candidateCount: pool.length,
  }
}
