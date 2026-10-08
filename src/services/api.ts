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
import { DRIVERS, INCOMING_REQUESTS, MATCHES, PICKUP_SHELL, RETURN_MATCHES } from '@/data/mock'
import { isoDate } from '@/lib/format'
import { computeMatches } from './matchingService'
import { DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter } from '@/data/demoLegs'
import { hasSupabase } from '@/lib/env'

/**
 * LiftyApi is the only surface screens talk to. Two implementations:
 *  - `mockApi` (demo mode): local data, simulated latency, used for demos and tests
 *  - `liveApi` (src/services/liveApi.ts): Supabase + PostGIS matching + Realtime
 * `api` delegates to whichever data source is active.
 */

export type DocKind = 'id' | 'licence' | 'vehicle_registration' | 'insurance'

export interface DriverSetupInput {
  vehicle: { registration: string; make: string; model: string; year: string; colour: string; seats: number; bodyType: 'sedan' | 'hatchback' | 'suv' | 'other'; photoUrl?: string }
  legs: {
    direction: LegDirection
    origin: Place
    destination: Place
    departure: string
    days: Weekday[]
    route: { coordinates: [number, number][]; distanceM: number; durationS: number }
  }[]
  seats: number
  maxDeviationMin: number
  monthlyContribution: number
}

export interface DriverLegSummary {
  legId: string
  direction: LegDirection
  originLabel: string
  destinationLabel: string
  departureTime: string
  days: Weekday[]
  seatsOpen: number
  maxDeviationMin: number
  monthlyContribution: number
  routeDistanceM: number
  route: LatLng[]
  members: { id: string; firstName: string; lastInitial: string; avatarHue: number; avatarUrl?: string; pickupLabel: string; pickupTime: string; paymentStatus: PaymentStatus }[]
}

export interface CommuteInstance {
  id: string
  legId: string
  direction: LegDirection
  status: 'scheduled' | 'sharing' | 'underway' | 'completed' | 'cancelled'
  isDriver: boolean
  departsAt: number
  sharingStartsAt: number
  sharingEndsAt: number
  driverArrivedAt: number | null
  route: LatLng[]
  routeDurationS: number
  destination: Place
  riders: { passengerId: string; status: string; firstName: string; lastInitial: string; avatarHue: number; pickup: Place; pickupTime: string; driverArrivedAt?: number | null; passengerAtPickup?: boolean; collectedAt?: number | null; noShowAt?: number | null }[]
  driver: { id: string; firstName: string; lastInitial: string; rating: number; ratingCount: number; avatarHue: number; verification: PublicVerification }
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
  senderId: string
  senderName: string
  body: string
  createdAt: number
  mine: boolean
}

export interface PendingDocument {
  id: string
  userId: string
  userName: string
  kind: string
  storagePath: string
  detail?: string
  createdAt: number
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
  documents: { kind: DocKind; status: 'pending' | 'verified' | 'rejected' }[]
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
  /** returns the server profile for returning users (null in demo mode) */
  verifyOtp(phone: string, code: string): Promise<AccountSnapshot | null>
  getAccountSnapshot(): Promise<AccountSnapshot | null>
  completeOnboarding(): Promise<void>
  signOut(): Promise<void>
  // onboarding
  savePassengerCommute(plan: CommutePlan): Promise<string>
  saveDriverSetup(setup: DriverSetupInput): Promise<void>
  saveDriverSettings(legId: string, input: { seats: number; maxDeviationMin: number; monthlyContribution: number; departureTime?: string; days?: Weekday[] }): Promise<void>
  uploadPhoto(kind: 'avatar' | 'vehicle', file: File): Promise<string>
  uploadDocument(kind: DocKind, file: File, detail?: string): Promise<void>
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
  listMessages(clubId: string, before?: number): Promise<ChatMessage[]>
  sendMessage(clubId: string, body: string): Promise<void>
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

export class ApiError extends Error {
  constructor(message: string, readonly code: 'offline' | 'server' | 'not-found' | 'invalid' | 'auth' | 'not-configured') {
    super(message)
  }
}

// ---- dev switch so error / offline UX can be exercised without a backend ----
export type Simulation = 'none' | 'fail' | 'offline'
const SIM_KEY = 'lifty.simulate'
export const getSimulation = (): Simulation => {
  try {
    return (localStorage.getItem(SIM_KEY) as Simulation) || 'none'
  } catch {
    return 'none'
  }
}
export const setSimulation = (s: Simulation) => {
  try {
    localStorage.setItem(SIM_KEY, s)
  } catch {
    /* storage unavailable */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function gate(latency = 450) {
  await sleep(latency)
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new ApiError("You're offline. Check your connection and try again.", 'offline')
  const sim = getSimulation()
  if (sim === 'offline') throw new ApiError("You're offline. Check your connection and try again.", 'offline')
  if (sim === 'fail') throw new ApiError('Something went wrong on our side. Please try again.', 'server')
}

// ---- compatibility ----
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

// ---- mock join-request persistence (survives reload) ----
const REQ_KEY = 'lifty.requests'
type StoredReq = JoinRequest & { acceptAfter: number }
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const writeJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}
const INCOMING_KEY = 'lifty.incoming'
const readIncoming = () => readJson<IncomingRequest[]>(INCOMING_KEY, INCOMING_REQUESTS.map((r) => ({ ...r })))
const demoMatchCache = new Map<string, Match>()
let lastSuggestions: string[] = []
/** What would widen the search — shown on the no-match screen. */
export const getLastMatchSuggestions = () => lastSuggestions
export const setLastMatchSuggestions = (s: string[]) => {
  lastSuggestions = s
}
const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new ApiError('Could not read that file', 'invalid'))
    r.readAsDataURL(file)
  })

const mockChats = new Map<string, ChatMessage[]>()
const mockChatListeners = new Map<string, Set<(m: ChatMessage) => void>>()
const MOCK_NOTIFS_KEY = 'lifty.notifications'

export const mockApi: LiftyApi = {
  async signUp() {
    await gate(350)
    return { resendInSeconds: 28 }
  },
  async sendOtp() {
    await gate(350)
    return { resendInSeconds: 28 }
  },
  async verifyOtp(_phone, code) {
    await gate(500)
    if (!/^\d{6}$/.test(code)) throw new ApiError('Enter the 6-digit code we sent you.', 'invalid')
    if (code === '000000') throw new ApiError("That code isn't right. Check the number and try again.", 'invalid')
    return null
  },
  async getAccountSnapshot() { return null },
  async completeOnboarding() {},
  async saveDriverSettings() {},
  async listExceptions() { return [] },
  async deleteException() {},
  async setPause() {},
  async requestPickupChange() {},
  async listPickupChanges() { return [] },
  async reviewPickupChange() {},
  async listContributions() { return [] },
  async reportContribution() {},
  async confirmContribution() {},
  async listHistory() { return [] },
  async setMatchAlert() {},
  async getAdminHealth() { return { pendingDocuments: 0, openReports: 0, suspendedUsers: 0, notifications: { pending: 0, failed: 0, delivered: 0, providerConfigured: false }, jobs: [] } },
  async suspendUser() {},
  async signOut() {},
  async savePassengerCommute() {
    await gate(200)
    return 'mock-commute'
  },
  async saveDriverSetup() {
    await gate(500)
  },
  async uploadPhoto(_kind, file) {
    await gate(300)
    return fileToDataUrl(file)
  },
  async uploadDocument() {
    await gate(400)
  },
  async setConsent() {},
  async listPickupPoints() {
    await gate(200)
    return [PICKUP_SHELL, ...MATCHES.map((m) => m.pickup).filter((p) => p.label !== PICKUP_SHELL.label)]
  },
  async findMatches(plan) {
    await gate(1100)
    const run = await computeMatches(plan, DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter())
    lastSuggestions = run.suggestions
    demoMatchCache.clear()
    run.matches.forEach((m) => demoMatchCache.set(m.id, m))
    return run.matches
  },
  async getMatch(id) {
    await gate(250)
    // the same derived result the list showed; recomputed from the saved plan after a reload
    let m = demoMatchCache.get(id)
    if (!m) {
      const saved = readJson<{ plan?: CommutePlan } | null>('lifty.state.v1', null)?.plan
      if (saved) (await computeMatches(saved, DEMO_LEGS, DEMO_PICKUP_POINTS, demoRouter())).matches.forEach((x) => demoMatchCache.set(x.id, x))
      m = demoMatchCache.get(id)
    }
    if (!m) throw new ApiError('This lift club is no longer a match for your commute.', 'not-found')
    return m
  },
  async getDriver(id) {
    await gate(250)
    const d = DRIVERS.find((x) => x.id === id)
    if (!d) throw new ApiError('We couldn’t find that driver.', 'not-found')
    return d
  },
  async requestToJoin(matchId) {
    await gate(700)
    const req: StoredReq = {
      id: `jr-${Date.now()}`,
      matchId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      startDate: isoDate(7),
      acceptAfter: Date.now() + 9000, // mock driver responds after ~9s
    }
    writeJson(REQ_KEY, [...readJson<StoredReq[]>(REQ_KEY, []).filter((r) => r.matchId !== matchId), req])
    return req
  },
  async getJoinRequest(id) {
    await gate(150)
    const r = readJson<StoredReq[]>(REQ_KEY, []).find((x) => x.id === id)
    if (!r) throw new ApiError('We couldn’t find that request.', 'not-found')
    const age = Date.now() - new Date(r.createdAt).getTime()
    const status: RequestStatus = Date.now() >= r.acceptAfter ? 'accepted' : age > 3000 ? 'reviewing' : 'pending'
    return { id: r.id, matchId: r.matchId, status, createdAt: r.createdAt, startDate: r.startDate }
  },
  async cancelJoinRequest(id) {
    await gate(300)
    writeJson(REQ_KEY, readJson<StoredReq[]>(REQ_KEY, []).filter((r) => r.id !== id))
  },
  async getMyClubs() {
    return null // demo mode keeps clubs in the local store
  },
  async listIncomingRequests() {
    await gate(500)
    return readIncoming()
  },
  async respondToRequest(id, decision) {
    await gate(600)
    const all = readIncoming()
    const idx = all.findIndex((r) => r.id === id)
    if (idx < 0) throw new ApiError('We couldn’t find that request.', 'not-found')
    all[idx] = { ...all[idx], status: decision === 'accept' ? 'accepted' : 'declined' }
    writeJson(INCOMING_KEY, all)
    return all[idx]
  },
  async removeMember() {
    await gate(300)
  },
  async markContributionPaid() {
    await gate(300)
  },
  async addException(e) { return { ...e, id: crypto.randomUUID() } },
  async getCurrentInstance() {
    return null
  },
  async listMessages(clubId) {
    return mockChats.get(clubId) ?? [{ id: 'm0', senderId: 'other', senderName: 'Lift club', body: 'Hi! Happy to answer any questions about the commute.', createdAt: Date.now() - 60000, mine: false }]
  },
  async sendMessage(clubId, body) {
    const list = mockChats.get(clubId) ?? (await mockApi.listMessages(clubId))
    const mine: ChatMessage = { id: `m${Date.now()}`, senderId: 'me', senderName: 'You', body, createdAt: Date.now(), mine: true }
    mockChats.set(clubId, [...list, mine])
    mockChatListeners.get(clubId)?.forEach((l) => l(mine))
    setTimeout(() => {
      const reply: ChatMessage = { id: `m${Date.now()}r`, senderId: 'other', senderName: 'Lift club', body: 'Thanks — see you at the pickup point!', createdAt: Date.now(), mine: false }
      mockChats.set(clubId, [...(mockChats.get(clubId) ?? []), reply])
      mockChatListeners.get(clubId)?.forEach((l) => l(reply))
    }, 1200)
  },
  subscribeMessages(clubId, onMessage) {
    const set = mockChatListeners.get(clubId) ?? new Set()
    set.add(onMessage)
    mockChatListeners.set(clubId, set)
    return () => set.delete(onMessage)
  },
  async listNotifications() {
    return readJson<AppNotification[]>(MOCK_NOTIFS_KEY, [
      { id: 'n-welcome', kind: 'welcome', title: 'Welcome to Lifty', body: 'Plan your commute to find drivers already going your way.', read: false, createdAt: Date.now() },
    ])
  },
  async markNotificationsRead() {
    writeJson(MOCK_NOTIFS_KEY, (await mockApi.listNotifications()).map((n) => ({ ...n, read: true })))
  },
  subscribeNotifications() {
    return () => {}
  },
  async savePushToken() {},
  async submitRating() {
    await gate(500)
  },
  async submitReport() {
    await gate(400)
  },
  async exportMyData() {
    await gate(300)
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), note: 'Demo mode — data is stored only on this device.' }
    try {
      out.state = JSON.parse(localStorage.getItem('lifty.state.v1') || '{}')
    } catch {
      /* ignore */
    }
    return out
  },
  async deleteMyAccount() {
    await gate(300)
  },
  async isAdmin() {
    return true // demo: admin console is open so it can be explored
  },
  async listPendingDocuments() {
    await gate(300)
    return [
      { id: 'doc-1', userId: 'drv-x', userName: 'Mandla Z.', kind: 'licence', storagePath: '', detail: 'Code B', createdAt: Date.now() - 3600000 },
      { id: 'doc-2', userId: 'drv-x', userName: 'Mandla Z.', kind: 'vehicle_registration', storagePath: '', detail: 'NP 552-391', createdAt: Date.now() - 3500000 },
    ]
  },
  async documentUrl() {
    return '/images/car-sedan.webp'
  },
  async reviewDocument() {
    await gate(300)
  },
  async listReports() {
    await gate(300)
    return [{ id: 'rep-1', kind: 'incident', body: 'Driver arrived 15 minutes late twice this week.', status: 'open', createdAt: Date.now() - 7200000 }]
  },
  async updateReport() {
    await gate(200)
  },
}

// ---- data source switch ----
export type DataSource = 'live' | 'demo'
const SOURCE_KEY = 'lifty.source'
let liveImpl: LiftyApi | null = null
export function registerLiveApi(impl: LiftyApi) {
  liveImpl = impl
}
export function getDataSource(): DataSource {
  const stored = readJson<DataSource | null>(SOURCE_KEY, null)
  if (stored === 'demo' || !hasSupabase) return 'demo'
  return 'live'
}
export function setDataSource(s: DataSource) {
  writeJson(SOURCE_KEY, s)
}
export const isLive = () => getDataSource() === 'live' && !!liveImpl

export const api: LiftyApi = new Proxy({} as LiftyApi, {
  get(_t, key: string) {
    const impl = isLive() ? liveImpl! : mockApi
    const v = impl[key as keyof LiftyApi]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(impl) : v
  },
})
