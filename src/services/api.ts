import type {
  CommutePlan,
  DriverProfile,
  IncomingRequest,
  JoinRequest,
  LatLng,
  LegDirection,
  LiftClub,
  Match,
  PaymentStatus,
  Place,
  RequestStatus,
  Role,
  ScheduleException,
  Weekday,
  UserProfile,
  PublicVerification,
} from '@/domain/types'
import { hasSupabase } from '@/lib/env'

/** Screens use this backend interface in every environment, including the isolated local test stack. */

export type DocKind = 'id' | 'licence' | 'vehicle_registration' | 'insurance'
export type DriverPickupPolicy = 'flexible' | 'door_to_door' | 'meeting_point'

export interface DriverSetupInput {
  vehicle: { registration: string; make: string; model: string; year: string; colour: string; seats: number; bodyType: 'sedan' | 'hatchback' | 'suv' | 'other'; photoUrl?: string }
  legs: {
    direction: LegDirection
    /** Snapshot-only state: pausing requests preserves already accepted trips. */
    requestsPaused?: boolean
    origin: Place
    destination: Place
    departure: string
    days: Weekday[]
    route: { coordinates: [number, number][]; distanceM: number; durationS: number }
  }[]
  seats: number
  maxDeviationMin: number
  pickupPolicy?: DriverPickupPolicy
  monthlyContribution: number
}

export interface DriverLegSummary {
  legId: string
  requestsPaused: boolean
  direction: LegDirection
  originLabel: string
  destinationLabel: string
  departureTime: string
  days: Weekday[]
  seatsOpen: number
  maxDeviationMin: number
  pickupPolicy?: DriverPickupPolicy
  monthlyContribution: number
  routeDistanceM: number
  route: LatLng[]
  members: { id: string; firstName: string; lastInitial: string; avatarHue: number; avatarUrl?: string; pickupLabel: string; pickupTime: string; monthlyContribution?: number; paymentStatus: PaymentStatus }[]
}

export interface CommuteInstance {
  id: string
  legId: string
  direction: LegDirection
  status: 'scheduled' | 'sharing' | 'underway' | 'completed' | 'cancelled'
  isDriver: boolean
  verificationHold?: boolean
  verificationHoldReason?: 'expired' | 'suspended' | 'unapproved'
  departsAt: number
  sharingStartsAt: number
  sharingEndsAt: number
  driverArrivedAt: number | null
  route: LatLng[]
  routeDurationS: number
  destination: Place
  riders: { passengerId: string; status: string; firstName: string; lastInitial: string; avatarHue: number; pickup: Place; pickupTime: string; driverArrivedAt?: number | null; passengerAtPickup?: boolean; collectedAt?: number | null; noShowAt?: number | null }[]
  driver: { isTest?: boolean; id: string; firstName: string; lastInitial: string; rating: number; ratingCount: number; avatarHue: number; verification: PublicVerification; completedTrips?: number; reliability?: number | null }
  vehicle: { make: string; model: string; colour: string; bodyType: 'sedan' | 'hatchback' | 'suv' | 'other'; registrationSummary: string; photoUrl?: string }
}

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string
  link?: string
  read: boolean
  createdAt: number
}

export interface ChatMessage {
  id: string
  sequence?: number
  senderId: string
  senderName: string
  body: string
  createdAt: number
  mine: boolean
}

export interface ChatSummary {
  legId: string
  title: string
  memberCount: number
  unreadCount: number
  lastMessage?: ChatMessage
}

/** Private setup progress; never an approval or a published driver offer. */
export interface DriverOnboardingDraft {
  step: 1 | 2 | 3 | 4
  vehicle: DriverSetupInput['vehicle']
  commute: {
    origin: string; destination: string
    originPlace?: Place; destinationPlace?: Place
    offerReturn: boolean; departure: string; returnTime: string
    days: Weekday[]; maxDeviationMin: number; pickupPolicy?: DriverPickupPolicy
  }
  seatsOpen: number
  monthlyContribution: number
}

export interface DriverDocument {
  id?: string
  kind: DocKind
  status: 'pending' | 'verified' | 'rejected'
  expiresOn?: string
  reviewNote?: string
}

export interface PendingDocument {
  id: string
  userId: string
  userName: string
  kind: string
  storagePath: string
  detail?: string
  createdAt: number
  expiresOn?: string
}

export interface SafetyReport {
  id: string
  kind: string
  body: string
  status: 'open' | 'reviewing' | 'closed'
  createdAt: number
  reporterId?: string
  subjectId?: string
  reporterName?: string
  subjectName?: string
}

export interface AccountSnapshot {
  user: UserProfile
  onboarded: boolean
  avatarUrl?: string
  preferences: { locationConsent: boolean; lowData: boolean; emergencyContact: string }
  commutes: CommutePlan[]
  driverSetup?: DriverSetupInput
  documents: DriverDocument[]
  driverDraft?: DriverOnboardingDraft
  verification: PublicVerification
  exceptions: ScheduleException[]
  pendingRequests: JoinRequest[]
  savedAlert: boolean
}

export interface PickupChange {
  id: string
  legId: string
  passengerId: string
  passengerName: string
  date: string
  pickup: Place
  status: 'pending' | 'approved' | 'declined'
  createdAt: number
}

export interface Contribution {
  id: string
  legId: string
  passengerId: string
  passengerName: string
  period: string
  amount: number
  status: 'due' | 'reported' | 'confirmed'
  reportedAt?: number
  confirmedAt?: number
  note?: string
}

export interface CommuteHistoryEntry {
  id: string
  legId: string
  direction: LegDirection
  date: string
  departsAt: number
  status: 'scheduled' | 'sharing' | 'underway' | 'completed' | 'cancelled' | 'missed'
  driverId: string
  driverName: string
  pickupLabel: string
  destinationLabel: string
  canRate: boolean
  rated: boolean
}

export interface AdminHealth {
  pendingDocuments: number
  openReports: number
  suspendedUsers: number
  notifications: { pending: number; failed: number; delivered: number; providerConfigured: boolean }
  jobs: { name: string; lastRun?: string; status: string; detail?: string }[]
}

export interface LiftyApi {
  // auth
  signUp(input: { fullName: string; phone: string; role: Role }): Promise<{ resendInSeconds: number }>
  sendOtp(phone: string): Promise<{ resendInSeconds: number }>
  /** Returns the authenticated server profile. */
  verifyOtp(phone: string, code: string): Promise<AccountSnapshot | null>
  getAccountSnapshot(): Promise<AccountSnapshot | null>
  completeOnboarding(): Promise<void>
  updateProfileName(fullName: string): Promise<PublicVerification>
  signOut(): Promise<void>
  // onboarding
  savePassengerCommute(plan: CommutePlan): Promise<string>
  saveDriverSetup(setup: DriverSetupInput): Promise<void>
  saveDriverSettings(legId: string, input: { seats: number; maxDeviationMin: number; monthlyContribution: number; pickupPolicy?: DriverPickupPolicy; departureTime?: string; days?: Weekday[] }): Promise<void>
  setDriverRequestsPaused(legId: string, paused: boolean): Promise<void>
  saveDriverOnboardingDraft(draft: DriverOnboardingDraft): Promise<void>
  getDriverOnboardingDraft(): Promise<DriverOnboardingDraft | null>
  clearDriverOnboardingDraft(): Promise<void>
  uploadPhoto(kind: 'avatar' | 'vehicle', file: File): Promise<string>
  uploadDocument(kind: DocKind, file: File, detail?: string, expiresOn?: string): Promise<void>
  setConsent(input: { location?: boolean; terms?: boolean; emergencyContact?: string; lowData?: boolean }): Promise<void>
  listPickupPoints(near?: LatLng): Promise<Place[]>
  // matching
  findMatches(plan: CommutePlan): Promise<Match[]>
  getMatch(id: string): Promise<Match>
  getDriver(id: string): Promise<DriverProfile>
  requestToJoin(matchId: string): Promise<JoinRequest>
  getJoinRequest(id: string): Promise<JoinRequest>
  cancelJoinRequest(id: string): Promise<void>
  // clubs
  getMyClubs(): Promise<{ asPassenger: LiftClub[]; asDriver: DriverLegSummary[] } | null>
  listIncomingRequests(): Promise<IncomingRequest[]>
  respondToRequest(id: string, decision: 'accept' | 'decline'): Promise<IncomingRequest>
  removeMember(legId: string, passengerId: string): Promise<void>
  markContributionPaid(legId: string, passengerId: string): Promise<void>
  addException(e: Omit<ScheduleException, 'id'>): Promise<ScheduleException>
  listExceptions(): Promise<ScheduleException[]>
  deleteException(id: string): Promise<void>
  setPause(legId: string, paused: boolean): Promise<void>
  requestPickupChange(input: { legId: string; date: string; pickup: Place }): Promise<void>
  listPickupChanges(): Promise<PickupChange[]>
  reviewPickupChange(id: string, approve: boolean): Promise<void>
  listContributions(legId?: string): Promise<Contribution[]>
  reportContribution(id: string, note?: string): Promise<void>
  confirmContribution(id: string): Promise<void>
  listHistory(): Promise<CommuteHistoryEntry[]>
  setMatchAlert(enabled: boolean): Promise<void>
  // tracking
  getCurrentInstance(): Promise<CommuteInstance | null>
  // messaging + notifications
  listMessages(clubId: string, before?: number, beforeSequence?: number): Promise<ChatMessage[]>
  sendMessage(clubId: string, body: string, messageId?: string): Promise<void>
  markClubRead(clubId: string, messageId?: string): Promise<void>
  listChatSummaries(): Promise<ChatSummary[]>
  subscribeMessages(clubId: string, onMessage: (m: ChatMessage) => void): () => void
  listNotifications(): Promise<AppNotification[]>
  markNotificationsRead(): Promise<void>
  subscribeNotifications(onNew: (n: AppNotification) => void): () => void
  savePushToken(token: string, platform: 'android' | 'ios'): Promise<void>
  // trust & safety
  submitRating(input: { driverId: string; stars: number; tags: string[]; comment?: string; legId?: string; instanceId?: string }): Promise<void>
  submitReport(input: { kind: 'driver' | 'passenger' | 'incident' | 'safety'; body: string; subjectId?: string }): Promise<void>
  // privacy (POPIA)
  exportMyData(): Promise<unknown>
  deleteMyAccount(): Promise<void>
  // admin
  isAdmin(): Promise<boolean>
  listPendingDocuments(): Promise<PendingDocument[]>
  documentUrl(path: string): Promise<string | null>
  reviewDocument(id: string, approve: boolean, note?: string): Promise<void>
  listReports(): Promise<SafetyReport[]>
  updateReport(id: string, status: SafetyReport['status']): Promise<void>
  getAdminHealth(): Promise<AdminHealth>
  suspendUser(userId: string, suspended: boolean, reason: string): Promise<void>
}

export type ApiErrorCode = 'offline' | 'server' | 'not-found' | 'invalid' | 'auth' | 'not-configured'
  /** sign-in for a number with no account */ | 'no-account'
  /** wrong / expired one-time code */ | 'otp'
  /** too many code requests */ | 'rate-limit'
  /** the SMS provider refused or failed to send */ | 'sms-failed'

export class ApiError extends Error {
  constructor(message: string, readonly code: ApiErrorCode) {
    super(message)
  }
}

/**
 * Compatibility is the product's core ranking signal. It deliberately weights
 * route overlap, pickup convenience, deviation and schedule fit — never
 * "distance to nearest car". The live backend uses the same weights (find_matches).
 */
export function scoreMatch(m: Match, plan: CommutePlan): number {
  const overlap = m.routeOverlap
  const walk = Math.max(0, 100 - (m.walkingDistanceM / Math.max(plan.maxWalkMeters, 250)) * 60)
  const deviation = Math.max(0, 100 - m.driverDeviationMinutes * 9)
  const shared = m.days.filter((d) => plan.days.includes(d)).length
  const schedule = (shared / Math.max(plan.days.length, 1)) * 100
  return Math.round(overlap * 0.45 + walk * 0.2 + deviation * 0.2 + schedule * 0.15)
}

/** Cost-sharing guide (mirrors public.suggested_contribution / contribution_cap in SQL). */
export function suggestedContribution(distanceM: number, days: number, seats: number): number {
  return Math.round(((distanceM / 1000) * 2.5 * Math.max(days, 1) * 4.33) / Math.max(seats + 1, 2) / 10) * 10
}
export function contributionCap(distanceM: number, days: number, seats: number): number {
  return Math.ceil((suggestedContribution(distanceM, days, seats) * 1.5) / 10) * 10
}

let lastSuggestions: string[] = []
/** What would widen the search, supplied by the matching service. */
export const getLastMatchSuggestions = () => lastSuggestions
export const setLastMatchSuggestions = (suggestions: string[]) => { lastSuggestions = suggestions }

let liveImpl: LiftyApi | null = null
export function registerLiveApi(impl: LiftyApi) { liveImpl = impl }
export const isLive = () => hasSupabase && !!liveImpl

// Old builds stored a demo choice. It must never prevent genuine backend sign-in.
for (const storage of ['localStorage', 'sessionStorage'] as const) {
  try { globalThis[storage]?.removeItem('lifty.source'); globalThis[storage]?.removeItem('lifty.simulate') } catch { /* Storage may be unavailable. */ }
}

export const api: LiftyApi = new Proxy({} as LiftyApi, {
  get(_target, key: string) {
    if (!liveImpl || !hasSupabase) throw new ApiError('Lifty could not connect to its backend. Please try again later.', 'not-configured')
    const value = liveImpl[key as keyof LiftyApi]
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(liveImpl) : value
  },
})
