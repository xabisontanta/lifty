import type {
  CommutePlan,
  DriverProfile,
  IncomingRequest,
  LatLng,
  Match,
  PaymentMethod,
  Place,
  Review,
  RouteGeometry,
  Weekday,
} from '@/domain/types'
import { pathLengthM } from '@/lib/geo'

// ---------- Geography (Ballito → Umhlanga Ridge) ----------

export const MAIN_ROUTE: LatLng[] = [
  { lat: -29.534, lng: 31.22 },
  { lat: -29.5362, lng: 31.216 },
  { lat: -29.5385, lng: 31.212 }, // J — junction
  { lat: -29.542, lng: 31.207 }, // K — rejoin
  { lat: -29.552, lng: 31.196 },
  { lat: -29.58, lng: 31.17 },
  { lat: -29.62, lng: 31.14 },
  { lat: -29.67, lng: 31.11 },
  { lat: -29.727, lng: 31.075 },
]

export const HOME: Place = {
  label: '12 Example Street',
  area: 'Ballito, KwaDukuza',
  location: { lat: -29.5365, lng: 31.2045 },
}

export const WORK: Place = {
  label: 'Umhlanga Ridge',
  area: 'Umhlanga Ridge, Durban',
  location: MAIN_ROUTE[MAIN_ROUTE.length - 1],
}

const DRIVER_HOME: Place = {
  label: 'Ballito',
  area: 'Ballito, KwaDukuza',
  location: MAIN_ROUTE[0],
}

export const PICKUP_SHELL: Place = {
  label: 'Shell Garage',
  area: 'Ballito',
  location: { lat: -29.5388, lng: 31.2088 },
}
const PICKUP_ENGEN: Place = {
  label: 'Engen Forecourt',
  area: 'Ballito',
  location: { lat: -29.5412, lng: 31.2098 },
}
const PICKUP_CENTRE: Place = {
  label: 'Lifestyle Centre taxi rank',
  area: 'Ballito',
  location: { lat: -29.5352, lng: 31.2148 },
}

function buildGeometry(pickup: LatLng, walkStart: LatLng, joinIdx: number, rejoinIdx: number): RouteGeometry {
  const mid: LatLng = {
    lat: (walkStart.lat + pickup.lat) / 2 + 0.00035,
    lng: (walkStart.lng + pickup.lng) / 2 - 0.0002,
  }
  return {
    path: MAIN_ROUTE,
    deviation: [MAIN_ROUTE[joinIdx], pickup, MAIN_ROUTE[rejoinIdx]],
    walking: [walkStart, mid, pickup],
  }
}

// ---------- Drivers ----------

const reviews = (names: string[]): Review[] =>
  names.map((n, i) => ({
    id: `rv-${n}-${i}`,
    author: n,
    stars: i === 2 ? 4 : 5,
    tags: [['Punctuality', 'Respectful'], ['Safe Driving', 'Reliable'], ['Communication']][i % 3],
    comment: ['Always on time and friendly.', 'Smooth driving, never late.', 'Great communication when plans change.'][i % 3],
    date: ['2026-09-12', '2026-08-30', '2026-08-02'][i % 3],
  }))

export const DRIVERS: DriverProfile[] = [
  {
    id: 'drv-sipho',
    firstName: 'Sipho',
    lastInitial: 'M',
    avatarHue: 24,
    rating: 4.8,
    ratingCount: 124,
    verification: { identity: 'verified', vehicle: 'verified', licence: 'verified' },
    vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', year: 2019, registrationSummary: 'ND ••• 456', seatsTotal: 3, bodyType: 'sedan' },
    seatsAvailable: 2,
    memberSince: '2024-03-01',
    completedArrangements: 11,
    routeSummary: 'Ballito → Umhlanga Ridge via N2',
    reviews: reviews(['Ayesha K.', 'Lindiwe S.', 'Mpho D.']),
    about: 'Regular commuter on the Ballito – Umhlanga route. Punctual and reliable.',
    reliability: 98,
  },
  {
    id: 'drv-thando',
    firstName: 'Thando',
    lastInitial: 'N',
    avatarHue: 330,
    rating: 4.9,
    ratingCount: 86,
    verification: { identity: 'verified', vehicle: 'verified', licence: 'verified' },
    vehicle: { make: 'Hyundai', model: 'i20', colour: 'White', year: 2021, registrationSummary: 'NU ••• 218', seatsTotal: 3, bodyType: 'hatchback' },
    seatsAvailable: 1,
    memberSince: '2024-07-01',
    completedArrangements: 7,
    routeSummary: 'Ballito → Umhlanga via M4',
    reviews: reviews(['Zanele M.', 'Bheki T.', 'Karen V.']),
    about: 'Nurse at a hospital in Umhlanga. Quiet, early starts.',
    reliability: 100,
  },
  {
    id: 'drv-kevin',
    firstName: 'Kevin',
    lastInitial: 'P',
    avatarHue: 205,
    rating: 4.7,
    ratingCount: 52,
    verification: { identity: 'verified', vehicle: 'verified', licence: 'pending' },
    vehicle: { make: 'VW', model: 'Polo', colour: 'Blue', year: 2018, registrationSummary: 'NG ••• 903', seatsTotal: 3, bodyType: 'hatchback' },
    seatsAvailable: 2,
    memberSince: '2025-01-01',
    completedArrangements: 4,
    routeSummary: 'Ballito → Umhlanga Ridge',
    reviews: reviews(['Nomsa B.', 'Pieter L.', 'Aisha R.']),
    about: 'Engineer at Mount Edgecombe. Happy to share the drive.',
    reliability: 95,
  },
]

// ---------- Matches ----------

function walkMetrics(g: RouteGeometry) {
  const m = Math.round(pathLengthM(g.walking) / 10) * 10
  return { walkingDistanceM: m, walkingMinutes: Math.max(1, Math.round(m / 70)) }
}

function money(driverContribution: number) {
  const platformFee = 100
  const processingFee = 50
  return { driverContribution, platformFee, processingFee, total: driverContribution + platformFee + processingFee }
}

const geoSipho = buildGeometry(PICKUP_SHELL.location, { lat: -29.537, lng: 31.2058 }, 2, 3)
const geoThando = buildGeometry(PICKUP_ENGEN.location, { lat: -29.5389, lng: 31.2042 }, 2, 3)
const geoKevin = buildGeometry(PICKUP_CENTRE.location, { lat: -29.5372, lng: 31.2078 }, 1, 2)

const WEEK: Weekday[] = [0, 1, 2, 3, 4]

export const MATCHES: Match[] = [
  {
    id: 'm-sipho',
    direction: 'to_work',
    driver: DRIVERS[0],
    origin: DRIVER_HOME,
    pickup: PICKUP_SHELL,
    destination: WORK,
    geometry: geoSipho,
    routeOverlap: 94,
    ...walkMetrics(geoSipho),
    driverDeviationMinutes: 3,
    additionalDistanceKm: 1.4,
    departureTime: '06:30',
    pickupEta: '06:35',
    arrivalEta: '07:40',
    days: WEEK,
    availableSeats: 2,
    monthlyContribution: money(1100),
    compatibility: 0,
    currentCommuteMinutes: 65,
    members: [{ firstName: 'Lindiwe', avatarHue: 300 }],
  },
  {
    id: 'm-thando',
    direction: 'to_work',
    driver: DRIVERS[1],
    origin: DRIVER_HOME,
    pickup: PICKUP_ENGEN,
    destination: WORK,
    geometry: geoThando,
    routeOverlap: 89,
    ...walkMetrics(geoThando),
    driverDeviationMinutes: 7,
    additionalDistanceKm: 2.9,
    departureTime: '06:20',
    pickupEta: '06:30',
    arrivalEta: '07:35',
    days: WEEK,
    availableSeats: 1,
    monthlyContribution: money(1050),
    compatibility: 0,
    currentCommuteMinutes: 62,
    members: [{ firstName: 'Bheki', avatarHue: 40 }, { firstName: 'Karen', avatarHue: 200 }],
  },
  {
    id: 'm-kevin',
    direction: 'to_work',
    driver: DRIVERS[2],
    origin: DRIVER_HOME,
    pickup: PICKUP_CENTRE,
    destination: WORK,
    geometry: geoKevin,
    routeOverlap: 86,
    ...walkMetrics(geoKevin),
    driverDeviationMinutes: 8,
    additionalDistanceKm: 3.2,
    departureTime: '06:40',
    pickupEta: '06:44',
    arrivalEta: '07:50',
    days: [0, 1, 2, 3],
    availableSeats: 2,
    monthlyContribution: money(950),
    compatibility: 0,
    currentCommuteMinutes: 68,
    members: [],
  },
]

// ---------- Plan / payments ----------

export const DEFAULT_PLAN: CommutePlan = {
  direction: 'to_work',
  origin: HOME,
  destination: WORK,
  days: WEEK,
  arriveBy: '08:00',
  arriveWindowStart: '07:45',
  returnTime: '17:00',
  maxWalkMeters: 750,
  preferredPickup: PICKUP_SHELL,
  scheduleMode: 'weekly',
  startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  dates: [],
  skipHolidays: true,
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm-card', kind: 'card', label: 'Bank card', detail: 'Visa •••• 4242' },
  { id: 'pm-eft', kind: 'eft', label: 'EFT / Instant Bank Pay', detail: 'Pay from your banking app' },
  { id: 'pm-mobile', kind: 'mobile', label: 'Mobile money', detail: 'e.g. Ozow, SnapScan, Mukuru' },
]

// ---------- Driver-side incoming requests ----------

export const INCOMING_REQUESTS: IncomingRequest[] = [
  {
    id: 'req-ayesha',
    passenger: { id: 'pax-ayesha', firstName: 'Ayesha', lastInitial: 'K', avatarHue: 160, rating: 4.9, ratingCount: 31, verified: true, area: 'Ballito', reliability: 100 },
    pickup: PICKUP_SHELL,
    destination: WORK,
    walkingFlexibilityM: 750,
    days: WEEK,
    arriveBy: '08:00',
    routeOverlap: 92,
    currentCommuteMinutes: 38,
    deviationMinutes: 4,
    additionalDistanceKm: 2.1,
    geometry: geoSipho,
    status: 'pending',
    monthlyContribution: 1100,
  },
  {
    id: 'req-naledi',
    passenger: { id: 'pax-naledi', firstName: 'Naledi', lastInitial: 'D', avatarHue: 280, rating: 4.7, ratingCount: 12, verified: true, area: 'Ballito', reliability: 92 },
    pickup: PICKUP_ENGEN,
    destination: WORK,
    walkingFlexibilityM: 500,
    days: [0, 2, 4],
    arriveBy: '07:45',
    routeOverlap: 88,
    currentCommuteMinutes: 38,
    deviationMinutes: 6,
    additionalDistanceKm: 2.8,
    geometry: geoThando,
    status: 'pending',
    monthlyContribution: 700,
  },
]

export const SERVICE_AREA_FAQ = 'Lifty only matches people whose commute reasonably overlaps yours.'

/** Evening (to_home) matches mirror the morning ones: reversed route, departure after work. */
export const RETURN_MATCHES: Match[] = MATCHES.slice(0, 2).map((m, i) => ({
  ...m,
  id: m.id + '-home',
  direction: 'to_home',
  origin: WORK,
  destination: m.pickup,
  pickup: { ...WORK, label: i === 0 ? 'Ridge Road' : 'Gateway entrance', area: 'Umhlanga Ridge' },
  geometry: { path: [...m.geometry.path].reverse(), deviation: [...m.geometry.deviation].reverse(), walking: [WORK.location, WORK.location] },
  walkingDistanceM: i === 0 ? 120 : 260,
  walkingMinutes: i === 0 ? 2 : 4,
  departureTime: i === 0 ? '17:00' : '17:15',
  pickupEta: i === 0 ? '17:05' : '17:22',
  arrivalEta: i === 0 ? '18:05' : '18:20',
}))
