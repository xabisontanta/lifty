// Domain model. These interfaces mirror what the backend is expected to return,
// so screens only ever consume these shapes (never ad-hoc literals).

export type Role = 'passenger' | 'driver' // there is deliberately no "both"

export interface LatLng {
  lat: number
  lng: number
}

export type VerificationStatus = 'verified' | 'pending' | 'unverified'

export interface PublicVerification {
  identity: VerificationStatus
  vehicle: VerificationStatus
  licence: VerificationStatus
  insurance?: VerificationStatus
}

export interface Vehicle {
  make: string
  model: string
  colour: string
  year: number
  /** Safe summary only, e.g. "ND ••• 456" — never the full registration. */
  registrationSummary: string
  seatsTotal: number
  bodyType: 'sedan' | 'hatchback' | 'suv' | 'other'
  /** The driver's real car photo (uploaded at onboarding) — passengers use it to recognise the car. */
  photoUrl?: string
}

export interface UserProfile {
  isTest?: boolean
  id: string
  firstName: string
  lastInitial: string
  fullName: string
  phone: string
  role: Role
  avatarHue: number
  memberSince: string
}

export interface DriverProfile {
  /** Server marks isolated test fixtures; never a person’s verification status. */
  isTest?: boolean
  id: string
  firstName: string
  lastInitial: string
  avatarHue: number
  rating: number
  ratingCount: number
  verification: PublicVerification
  vehicle: Vehicle
  seatsAvailable: number
  memberSince: string
  completedArrangements: number
  /** Actual completed commute instances, independent of lift club arrangements. */
  completedTrips?: number
  routeSummary: string
  reviews: Review[]
  about?: string
  avatarUrl?: string
  /** Completed / (completed + cancelled) past trips; unknown without history. */
  reliability: number | null
}

export interface Review {
  id: string
  author: string
  stars: number
  tags: string[]
  comment?: string
  date: string
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Mon..Sun
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type LocationSource = 'manual' | 'autocomplete' | 'current_location' | 'map_pin' | 'saved_location'

/** Structured location — never just a display string. */
export interface Place {
  label: string // formattedAddress
  area: string
  location: LatLng
  placeId?: string
  /** how this location was chosen */
  source?: LocationSource
}

export type LegDirection = 'to_work' | 'to_home'

export interface CommutePlan {
  /** to_work: arriveBy is the arrival deadline. to_home: arriveBy is the earliest departure. */
  direction: LegDirection
  origin: Place
  destination: Place
  days: Weekday[]
  arriveBy: string // HH:mm
  arriveWindowStart: string
  returnTime: string
  maxWalkMeters: number // 0 = no walking
  preferredPickup?: Place
  /** weekly: `days` recur from startDate (until endDate). dates: only the picked `dates`, priced per day. */
  scheduleMode: 'weekly' | 'dates' | 'recurring'
  startDate: string // ISO yyyy-mm-dd
  endDate?: string
  dates: string[] // ISO dates (dates mode)
  skipHolidays: boolean
}

export interface RouteGeometry {
  /** Driver's normal route, origin → destination */
  path: LatLng[]
  /** Detour the driver takes to reach the pickup point (junction → pickup → rejoin) */
  deviation: LatLng[]
  /** Passenger's walking route to the pickup */
  walking: LatLng[]
}

export interface Match {
  /** For live data this is the driver's leg id. */
  id: string
  direction: LegDirection
  driver: DriverProfile
  pickup: Place
  destination: Place
  origin: Place
  geometry: RouteGeometry
  routeOverlap: number // 0..100
  walkingDistanceM: number
  walkingMinutes: number
  driverDeviationMinutes: number
  additionalDistanceKm: number
  departureTime: string
  pickupEta: string
  arrivalEta: string
  days: Weekday[]
  availableSeats: number
  monthlyContribution: ContributionBreakdown
  /** Composite 0..100 used for sorting — never "nearest driver". */
  compatibility: number
  currentCommuteMinutes: number
  /** Existing lift-club members (first names only) for the avatar stack. */
  members: { firstName: string; avatarHue: number; avatarUrl?: string }[]
  /** per_day when the passenger booked specific dates: monthlyContribution = perDay × bookedDays */
  pricing?: 'monthly' | 'per_day'
  perDayContribution?: number
  bookedDays?: number
  /** derived by the matching engine — see src/domain/matching.ts */
  explanation?: string[]
  pickupDeviationMinutes?: number
  walkingEstimated?: boolean
  /** true when road routing was unavailable and detour/walk/overlap are the database's straight-line estimates */
  routingEstimated?: boolean
  /** Server-issued identifier for the exact offer reviewed before requesting. */
  quoteId?: string
  coveredDays?: Weekday[]
  uncoveredDays?: Weekday[]
  coveredDates?: string[]
  uncoveredDates?: string[]
  partial?: boolean
}

export interface ContributionBreakdown {
  driverContribution: number
  platformFee: number
  processingFee: number
  total: number
}

export type RequestStatus = 'pending' | 'reviewing' | 'accepted' | 'declined' | 'cancelled'

export interface JoinRequest {
  id: string
  matchId: string
  status: RequestStatus
  createdAt: string
  startDate: string
}

export interface PassengerSummary {
  id: string
  firstName: string
  lastInitial: string
  avatarHue: number
  rating: number
  ratingCount: number
  verified: boolean
  area: string
  reliability: number
}

export interface IncomingRequest {
  id: string
  passenger: PassengerSummary
  pickup: Place
  destination: Place
  walkingFlexibilityM: number
  days: Weekday[]
  arriveBy: string
  routeOverlap: number
  currentCommuteMinutes: number
  deviationMinutes: number
  additionalDistanceKm: number
  geometry: RouteGeometry
  /** set when the passenger booked specific dates instead of every week */
  specificDates?: string[]
  startDate?: string
  status: 'pending' | 'accepted' | 'declined'
  monthlyContribution: number
}

export interface ClubMember {
  id: string
  firstName: string
  lastInitial: string
  avatarHue: number
  role: 'driver' | 'passenger'
  paymentStatus?: PaymentStatus
  avatarUrl?: string
}

export type PaymentStatus = 'paid' | 'due' | 'overdue' | 'upcoming'

export interface LiftClub {
  id: string
  matchId: string
  direction: LegDirection
  driver: DriverProfile
  members: ClubMember[]
  pickup: Place
  destination: Place
  days: Weekday[]
  pickupTime: string
  /** Arrival quoted when this agreement was accepted, when available. */
  arrivalTime?: string
  startDate: string
  seatsTotal: number
  seatsTaken: number
  monthlyContribution: number
  nextContributionDate: string
  paymentStatus: PaymentStatus
  paused: boolean
  /** Immutable schedule agreed when membership was accepted. */
  schedule?: AgreedSchedule
}

export interface AgreedSchedule {
  scheduleMode: 'weekly' | 'dates'
  days: Weekday[]
  dates: string[]
  startDate: string
  endDate?: string
  skipHolidays: boolean
  monthlyContribution: number
  perDayContribution?: number
}

export type ExceptionKind =
  | 'wfh'
  | 'leave'
  | 'holiday'
  | 'absent'
  | 'unavailable'
  | 'pause'
  | 'pickup-change'

export interface ScheduleException {
  id: string
  kind: ExceptionKind
  date: string // ISO date or 'ongoing'
  note?: string
  legId?: string
}

export interface PaymentMethod {
  id: string
  kind: 'card' | 'eft' | 'mobile'
  label: string
  detail: string
}

// ---------- Live tracking ----------

export type TrackingStatus =
  | 'sharing-soon'
  | 'driver-approaching'
  | 'passenger-approaching'
  | 'both-at-pickup'
  | 'underway'
  | 'destination-reached'
  | 'ended'

export interface DriverLocation extends LatLng {
  heading: number
  speed: number // km/h
  updatedAt: number // epoch ms
}

export interface PassengerLocation extends LatLng {
  updatedAt: number
}

export interface TrackingSnapshot {
  riders?: { passengerId: string; firstName: string; status: string; pickupLabel: string; driverArrivedAt: number | null; location: PassengerLocation | null }[]
  status: TrackingStatus
  driverLocation: DriverLocation | null
  passengerLocation: PassengerLocation | null
  /** minutes until driver reaches pickup */
  pickupEta: number
  /** minutes until passenger reaches pickup */
  walkingEta: number
  walkingDistanceM: number
  /** minutes until destination */
  destinationEta: number
  routeGeometry: LatLng[]
  deviationGeometry: LatLng[]
  walkingGeometry: LatLng[]
  pickup: LatLng
  destination: LatLng
  /** explicit pickup state, independent of GPS inference */
  collected: boolean
  driverArrived: boolean
  passengerAtPickup: boolean
  /** when the driver arrived — starts the 3-minute grace period */
  driverArrivedAt: number | null
  noShow: boolean
}

export interface TrackingConnection {
  online: boolean
  lastUpdate: number | null
  error?: string
}
