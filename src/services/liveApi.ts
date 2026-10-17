import type {
  CommutePlan,
  DriverProfile,
  IncomingRequest,
  JoinRequest,
  LatLng,
  LiftClub,
  Match,
  PaymentStatus,
  Place,
  RequestStatus,
  Weekday,
} from '@/domain/types'
import { isoDate } from '@/lib/format'
import {
  ApiError,
  setLastMatchSuggestions,
  type AppNotification,
  type ChatMessage,
  type CommuteInstance,
  type DriverLegSummary,
  type LiftyApi,
} from './api'
import { publicFileUrl, sb, currentUserId } from './supabase'
import { pilotMethods, pilotRpc } from './pilotApi'
import { authFail } from './authErrors'
import { markDeliberateSignOut } from '@/lib/notice'
import { reverseGeocode } from './mapbox'
import { env } from '@/lib/env'
import { holidayName } from '@/lib/holidays'

/* eslint-disable @typescript-eslint/no-explicit-any -- RPCs return jsonb shaped in SQL */
type J = any

// ---------- mapping helpers ----------
export function hueFor(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}
const pt = (lng: number, lat: number) => `SRID=4326;POINT(${lng} ${lat})`
const toPlace = (j: J): Place => ({ label: j?.label ?? '', area: j?.area ?? j?.label ?? '', location: { lat: Number(j?.lat), lng: Number(j?.lng) } })
const line = (g: J): LatLng[] => (g?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ lat, lng }))
const days = (d: J): Weekday[] => (Array.isArray(d) ? d.map(Number) : []) as Weekday[]
const vStatus = (s?: string) => (s === 'verified' ? 'verified' : s === 'rejected' ? 'unverified' : 'pending') as 'verified' | 'pending' | 'unverified'

function toDriver(d: J, v: J, seatsAvailable = 0, routeSummary = ''): DriverProfile {
  const status = vStatus(d?.identityStatus)
  return {
    id: d.id,
    isTest: d.isTest === true || d.is_test === true,
    firstName: d.firstName,
    lastInitial: d.lastInitial ?? '',
    avatarHue: hueFor(d.id),
    avatarUrl: publicFileUrl('avatars', d.avatarPath),
    rating: Number(d.rating ?? 0),
    ratingCount: Number(d.ratingCount ?? 0),
    verification: d?.verification ?? { identity: status, vehicle: vStatus(v?.status), licence: 'pending', insurance: 'pending' },
    vehicle: {
      make: v?.make ?? '',
      model: v?.model ?? '',
      colour: v?.colour ?? '',
      year: Number(v?.year ?? 0),
      registrationSummary: v?.registrationSummary ?? '',
      seatsTotal: Number(v?.seatsTotal ?? 0),
      bodyType: v?.bodyType ?? 'sedan',
      photoUrl: publicFileUrl('vehicle-photos', v?.photoPath),
    },
    seatsAvailable,
    memberSince: d.memberSince ?? isoDate(0),
    completedArrangements: Number(d.completedArrangements ?? 0),
    completedTrips: Number(d.completedTrips ?? 0),
    routeSummary,
    reviews: [],
    about: d.about ?? undefined,
    reliability: d.reliability == null ? null : Number(d.reliability),
  }
}

function toMatch(j: J): Match {
  const contribution = Number(j.monthlyContribution)
  return {
    id: j.legId,
    direction: j.direction,
    driver: toDriver(j.driver, j.vehicle, Number(j.availableSeats), `${j.origin?.label ? '' : ''}Regular commute to ${j.destination?.label ?? ''}`),
    origin: toPlace(j.origin),
    pickup: toPlace(j.pickup),
    destination: toPlace(j.destination),
    geometry: { path: line(j.geometry?.path), deviation: line(j.geometry?.deviation), walking: line(j.geometry?.walking) },
    routeOverlap: Number(j.routeOverlap),
    walkingDistanceM: Number(j.walkingDistanceM),
    walkingMinutes: Number(j.walkingMinutes),
    driverDeviationMinutes: Number(j.driverDeviationMinutes),
    additionalDistanceKm: Number(j.additionalDistanceKm),
    departureTime: j.departureTime,
    pickupEta: j.pickupEta,
    arrivalEta: j.arrivalEta,
    days: days(j.days),
    coveredDays:days(j.coveredDays),uncoveredDays:days(j.uncoveredDays),coveredDates:j.coveredDates??[],uncoveredDates:j.uncoveredDates??[],partial:(j.uncoveredDays?.length??0)>0||(j.uncoveredDates?.length??0)>0,
    availableSeats: Number(j.availableSeats),
    // v1: contributions are tracked, not processed — no platform or processing fee is added.
    monthlyContribution: { driverContribution: contribution, platformFee: 0, processingFee: 0, total: contribution },
    compatibility: Number(j.compatibility),
    currentCommuteMinutes: Number(j.currentCommuteMinutes),
    pricing: j.pricing === 'per_day' ? 'per_day' : 'monthly',
    perDayContribution: j.perDayContribution != null ? Number(j.perDayContribution) : undefined,
    bookedDays: j.bookedDays != null ? Number(j.bookedDays) : undefined,
    members: (j.members ?? []).map((m: J, i: number) => ({ firstName: m.firstName, avatarHue: hueFor(m.firstName + i), avatarUrl: publicFileUrl('avatars', m.avatarPath) })),
    // set by the road-routed find-matches Edge Function (absent on the database estimate)
    explanation: Array.isArray(j.explanation) ? j.explanation : undefined,
    pickupDeviationMinutes: j.pickupDeviationMinutes != null ? Number(j.pickupDeviationMinutes) : undefined,
    walkingEstimated: j.walkingEstimated === true || undefined,
    routingEstimated: j.routing !== 'road' || undefined,
    quoteId: typeof j.quoteId==='string'?j.quoteId:undefined,
  }
}

/** Friendlier pickup names: "On Umhlanga Ridge route" → the actual street. */
async function nameOnRoutePickups(ms: Match[]) {
  await Promise.all(
    ms.map(async (m) => {
      if (/ route$|^Your street$/.test(m.pickup.label)) {
        const street = await reverseGeocode(m.pickup.location).catch(() => null)
        if (street) m.pickup = { ...m.pickup, label: street }
      }
    }),
  )
}

function fail(e: { message?: string; code?: string } | null, fallback = 'Something went wrong. Please try again.'): never {
  const msg = e?.message ?? fallback
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError("You're offline. Check your connection and try again.", 'offline')
  if (/JWT|not authenticated|Auth session missing/i.test(msg)) throw new ApiError('Your session has expired. Please sign in again.', 'auth')
  if (/phone.*provider|Unsupported phone provider|sms.*disabled|phone_provider_disabled|phone signups are disabled|signups not allowed/i.test(msg))
    throw new ApiError('Phone sign-in is unavailable right now. Please try again later.', 'not-configured')
  throw new ApiError(msg.replace(/^.*?ERROR:\s*/, ''), 'server')
}

async function uid(): Promise<string> {
  const { data } = await sb().auth.getUser()
  if (!data.user) throw new ApiError('Please sign in to continue.', 'auth')
  return data.user.id
}

export const toE164 = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('27')) return `+${d}`
  return `+27${d.replace(/^0/, '')}`
}

// ---------- module state ----------
const PENDING_KEY = 'lifty.pendingProfile'
const COMMUTE_KEY = 'lifty.commuteIds'
const matchCache = new Map<string, Match & { commuteId: string }>()
const commuteIds = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(`${COMMUTE_KEY}:${currentUserId}`) || '{}')
  } catch {
    return {}
  }
}
const setCommuteId = (direction: string, id: string) => {
  try {
    localStorage.setItem(`${COMMUTE_KEY}:${currentUserId}`, JSON.stringify({ ...commuteIds(), [direction]: id }))
  } catch {
    /* ignore */
  }
}

function mapRequestStatus(s: string, createdAt: string): RequestStatus {
  if (s === 'pending') return Date.now() - new Date(createdAt).getTime() > 60_000 ? 'reviewing' : 'pending'
  return s as RequestStatus
}

function toInstance(j: J): CommuteInstance {
  return {
    id: j.id,
    legId: j.legId,
    direction:j.direction,
    status: j.status,
    isDriver: !!j.isDriver,
    verificationHold: !!j.verificationHold,
    verificationHoldReason: j.verificationHoldReason,
    departsAt: new Date(j.departsAt).getTime(),
    sharingStartsAt: new Date(j.sharingStartsAt).getTime(),
    sharingEndsAt: new Date(j.sharingEndsAt).getTime(),
    driverArrivedAt: j.driverArrivedAt ? new Date(j.driverArrivedAt).getTime() : null,
    route: line(j.route),
    routeDurationS: Number(j.routeDurationS),
    destination: toPlace(j.destination),
    riders: (j.riders ?? []).map((r: J) => ({
      passengerId: r.passengerId,
      status: r.status,
      firstName: r.firstName,
      lastInitial: r.lastInitial ?? '',
      avatarHue: hueFor(r.passengerId),
      pickup: toPlace(r.pickup),
      pickupTime: r.pickupTime,
      driverArrivedAt:r.driverArrivedAt?new Date(r.driverArrivedAt).getTime():null,passengerAtPickup:!!r.passengerAtPickup,collectedAt:r.collectedAt?new Date(r.collectedAt).getTime():null,noShowAt:r.noShowAt?new Date(r.noShowAt).getTime():null,
    })),
    driver: { isTest: j.driver.isTest === true || j.driver.is_test === true, id: j.driver.id, firstName: j.driver.firstName, lastInitial: j.driver.lastInitial, rating: Number(j.driver.rating), ratingCount: Number(j.driver.ratingCount), avatarHue: hueFor(j.driver.id),verification:j.driver.verification, completedTrips: Number(j.driver.completedTrips ?? 0), reliability: j.driver.reliability == null ? null : Number(j.driver.reliability) },
    vehicle: { make: j.vehicle?.make ?? '', model: j.vehicle?.model ?? '', colour: j.vehicle?.colour ?? '', bodyType: j.vehicle?.bodyType ?? 'sedan', registrationSummary: j.vehicle?.registrationSummary ?? '', photoUrl: publicFileUrl('vehicle-photos', j.vehicle?.photoPath) },
  }
}

const nextMonthFirst = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10)
}

export function clearLiveCaches() { matchCache.clear(); try { for(const k of Object.keys(localStorage)) if(k.startsWith(COMMUTE_KEY)||k==='lifty.state.v1') localStorage.removeItem(k) } catch {} }
// ---------- implementation ----------
export const liveApi: LiftyApi = {
  ...pilotMethods,
  async signUp({fullName,phone,role}) {
    const e164=toE164(phone)
    const {error}=await sb().auth.signInWithOtp({phone:e164,options:{channel:'sms',data:{full_name:fullName,role,terms_accepted:true}}})
    if(error) authFail(error,'sign-up')
    sessionStorage.setItem(PENDING_KEY,JSON.stringify({fullName,role,phone:e164}))
    return {resendInSeconds:30}
  },
  async sendOtp(phone) {
    const {error}=await sb().auth.signInWithOtp({phone:toE164(phone),options:{channel:'sms',shouldCreateUser:false}})
    if(error)authFail(error,'sign-in')
    return {resendInSeconds:30}
  },
  async verifyOtp(phone,code) {
    const e164=toE164(phone)
    const {data,error}=await sb().auth.verifyOtp({phone:e164,token:code,type:'sms'})
    if(error)authFail(error,'verify')
    if(!data.user)throw new ApiError('Could not sign in','auth')
    const {data:existing,error:profileError}=await sb().from('profiles').select('id').eq('id',data.user.id).maybeSingle()
    if(profileError)fail(profileError)
    if(!existing){
      let pending={fullName:'',role:'passenger',phone:''}
      try {pending=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'{}')} catch {}
      const meta=data.user.user_metadata
      await pilotRpc('bootstrap_account',{p_full_name:pending.phone===e164?pending.fullName:meta.full_name,p_role:pending.phone===e164?pending.role:meta.role})
    }
    sessionStorage.removeItem(PENDING_KEY)
    return await liveApi.getAccountSnapshot()
  },
  async signOut() {
    // Remove this device's destination while the current session can authorize it.
    let token:string|null=null
    try{token=localStorage.getItem('lifty.push.device')}catch{}
    markDeliberateSignOut()
    // best effort: if the session is already dead (or we are offline) this must not block signing out
    try{if(token&&currentUserId)await sb().from('push_tokens').delete().eq('user_id',currentUserId).eq('token',token)}catch{/* ignore */}
    clearLiveCaches();sessionStorage.removeItem(PENDING_KEY)
    // scope 'local' = THIS device only: it works offline and never ends the user's sessions on their other devices/tabs
    // (the default, 'global', would). Local sign-out cannot fail on a network or expired-token error.
    await sb().auth.signOut({scope:'local'}).catch(()=>undefined)
    try {
      localStorage.removeItem(COMMUTE_KEY)
      localStorage.removeItem(PENDING_KEY)
    } catch {
      /* ignore */
    }
  },

  async savePassengerCommute(plan: CommutePlan) {
    const me = await uid()
    const origin=plan.direction==='to_home'?plan.destination:plan.origin
    const destination=plan.direction==='to_home'?plan.origin:plan.destination
    const [h, m] = plan.arriveBy.split(':').map(Number)
    const [hs, ms] = plan.arriveWindowStart.split(':').map(Number)
    const windowMin = Math.max(0, h * 60 + m - (hs * 60 + ms))
    const today = isoDate(0)
    const dates = plan.scheduleMode === 'dates'
      ? plan.dates.filter((d) => d >= today && !(plan.skipHolidays && holidayName(d))).sort()
      : []
    const { data, error } = await sb()
      .from('passenger_commutes')
      .upsert(
        {
          passenger_id: me,
          direction: plan.direction,
          origin_label: origin.label,
          origin: pt(origin.location.lng, origin.location.lat),
          destination_label: destination.label,
          destination: pt(destination.location.lng, destination.location.lat),
          days: plan.scheduleMode === 'dates' ? [...new Set(dates.map((d) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7))].sort() : plan.days,
          arrive_by: plan.direction === 'to_home' ? plan.returnTime : plan.arriveBy,
          window_min: windowMin || 15,
          max_walk_m: plan.maxWalkMeters,
          skip_holidays:plan.skipHolidays,
          start_date: plan.scheduleMode === 'dates' ? (dates[0] ?? plan.startDate) : plan.startDate,
          end_date: plan.scheduleMode === 'dates' ? null : plan.endDate ?? null,
          // holidays are removed client-side so the server only sees real commuting days
          specific_dates: plan.scheduleMode === 'dates' ? dates : null,
        },
        { onConflict: 'passenger_id,direction' },
      )
      .select('id')
      .single()
    if (error) fail(error)
    setCommuteId(plan.direction, data.id)
    return data.id as string
  },
  async saveDriverSetup(setup) {
    const me = await uid()
    const reg = setup.vehicle.registration.trim().toUpperCase()
    const summary = reg.includes('•') ? reg : reg.length > 4 ? `${reg.slice(0, 2)} ••• ${reg.replace(/\s/g, '').slice(-3)}` : reg
    const v = await sb().from('vehicles').upsert(
      {
        driver_id: me,
        make: setup.vehicle.make,
        model: setup.vehicle.model,
        colour: setup.vehicle.colour,
        year: Number(setup.vehicle.year) || null,
        body_type: setup.vehicle.bodyType,
        registration_summary: summary,
        seats_total: setup.vehicle.seats,
        photo_path: setup.vehicle.photoUrl ?? null,
      },
      { onConflict: 'driver_id' },
    )
    if (v.error) fail(v.error)
    for (const leg of setup.legs) {
      const { error } = await sb().rpc('upsert_driver_leg', {
        p_direction: leg.direction,
        p_origin_label: leg.origin.label,
        p_origin_lng: leg.origin.location.lng,
        p_origin_lat: leg.origin.location.lat,
        p_destination_label: leg.destination.label,
        p_destination_lng: leg.destination.location.lng,
        p_destination_lat: leg.destination.location.lat,
        p_route: { type: 'LineString', coordinates: leg.route.coordinates },
        p_distance_m: leg.route.distanceM,
        p_duration_s: leg.route.durationS,
        p_departure: leg.departure,
        p_days: leg.days,
        p_seats: setup.seats,
        p_max_deviation: setup.maxDeviationMin,
        p_contribution: setup.monthlyContribution,
      })
      if (error) fail(error)
    }
  },
  async uploadPhoto(kind, file) {
    const me = await uid()
    const bucket = kind === 'avatar' ? 'avatars' : 'vehicle-photos'
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${me}/${kind}-${Date.now()}.${ext}`
    const { error } = await sb().storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type })
    if (error) fail(error)
    if (kind === 'avatar') await sb().from('profiles').update({ avatar_path: path }).eq('id', me)
    else await sb().from('vehicles').update({ photo_path: path }).eq('driver_id', me)
    return publicFileUrl(bucket, path)!
  },
  async uploadDocument(kind, file, detail, expiresOn) {
    const me = await uid()
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${me}/${kind}-${Date.now()}.${ext}`
    const up = await sb().storage.from('kyc').upload(path, file, { contentType: file.type })
    if (up.error) fail(up.error)
    const { error } = await sb().from('verification_documents').insert({ user_id: me, kind, storage_path: path, detail: detail ?? null, expires_on: expiresOn ?? null })
    if (error) fail(error)
  },
  async setConsent({ location, terms, emergencyContact, lowData }) {
    const me = await uid()
    const row: Record<string, unknown> = { id: me }
    if (location !== undefined) row.location_consent_at = location ? new Date().toISOString() : null
    if (terms) row.terms_accepted_at = new Date().toISOString()
    if (emergencyContact !== undefined) row.emergency_contact = emergencyContact
    if (lowData !== undefined) row.low_data_mode = lowData
    const { error } = await sb().from('profile_private').upsert(row)
    if (error) fail(error)
  },
  async listPickupPoints(near) {
    const { data, error } = await sb().rpc('list_pickup_points', near ? { p_lng: near.lng, p_lat: near.lat, p_radius_m: 4000 } : {})
    if (error) fail(error)
    return (data as J[]).map(toPlace)
  },

  async findMatches(plan) {
    const commuteId = await liveApi.savePassengerCommute(plan)
    let matches: Match[]
    try {
      // road-routed matching on the server: drivers' full routes never reach the phone
      const { data, error } = await sb().functions.invoke('find-matches', { body: { commuteId } })
      if (error || !Array.isArray(data?.matches)) throw error ?? new Error('find-matches returned no result')
      matches = (data.matches as J[]).map(toMatch)
      setLastMatchSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
    } catch (e) {
      const status=(e as {context?:Response}).context?.status
      if(status&&![503,502,504].includes(status))throw new ApiError(status===429?'Please wait before searching again.':'Could not load matches. Sign in again or retry.','server')
      // routing unavailable → the database's straight-line estimate, labelled as such on every match
      console.warn('Road-routed matching unavailable, using estimates', e)
      const { data, error } = await sb().rpc('get_estimated_match_quotes', { p_commute: commuteId })
      if (error) fail(error)
      matches = (data as J[]).map(toMatch)
      setLastMatchSuggestions([])
    }
    await nameOnRoutePickups(matches)
    matches.forEach((m) => matchCache.set(m.id, { ...m, commuteId }))
    return matches
  },
  async getMatch(id) {
    const {data:snapshots,error:snapshotError}=await sb().from('join_requests').select('match_snapshot').eq('leg_id',id).in('status',['pending','accepted']).order('created_at',{ascending:false}).limit(1)
    if(snapshotError)fail(snapshotError)
    if(snapshots?.[0]?.match_snapshot){const m=toMatch(snapshots[0].match_snapshot);m.driver.verification=await pilotRpc('driver_verification',{p_user:m.driver.id});return m}
    const hit = matchCache.get(id)
    if (hit) return hit
    const {data:stored,error:commuteError}=await sb().from('passenger_commutes').select('id,direction').eq('passenger_id',await uid())
    if(commuteError)fail(commuteError)
    for(const c of stored??[])setCommuteId(c.direction,c.id)
    for (const commuteId of Object.values(commuteIds())) {
      const { data, error } = await sb().rpc('get_match', { p_commute: commuteId, p_leg: id })
      if (error) fail(error)
      if (data) {
        const m = toMatch(data)
        await nameOnRoutePickups([m])
        matchCache.set(id, { ...m, commuteId })
        return m
      }
    }
    throw new ApiError('This lift club is no longer a match for your commute.', 'not-found')
  },
  async getDriver(id) {
    const { data, error } = await sb().from('profiles').select('id,role,first_name,last_initial,avatar_path,rating,rating_count,identity_status,completed_arrangements,created_at,about,reliability,is_test,vehicles(*)').eq('id', id).maybeSingle()
    if (error) fail(error)
    if (!data) throw new ApiError('We couldn’t find that driver.', 'not-found')
    const stats = await pilotRpc('get_driver_trip_stats', { p_driver: id })
    if (!stats) throw new ApiError('We couldn’t find that driver.', 'not-found')
    const v = Array.isArray(data.vehicles) ? data.vehicles[0] : data.vehicles
    const driver = toDriver(
      { id: data.id, isTest: data.is_test, firstName: data.first_name, lastInitial: data.last_initial, avatarPath: data.avatar_path, rating: data.rating, ratingCount: data.rating_count, identityStatus: data.identity_status, completedArrangements: data.completed_arrangements, completedTrips: stats.completedTrips, memberSince: data.created_at?.slice(0, 10), about: data.about, reliability: stats.reliability },
      v && { make: v.make, model: v.model, colour: v.colour, year: v.year, bodyType: v.body_type, registrationSummary: v.registration_summary, seatsTotal: v.seats_total, photoPath: v.photo_path, status: v.status },
    )
    driver.verification=await pilotRpc('driver_verification',{p_user:id})
    const r = await sb()
      .from('ratings')
      .select('id, stars, tags, comment, created_at, rater:profiles!ratings_rater_id_fkey(first_name, last_initial)')
      .eq('ratee_id', id)
      .order('created_at', { ascending: false })
      .limit(10)
    if (r.error) fail(r.error)
    driver.reviews = (r.data ?? []).map((x: J) => ({ id: x.id, author: `${x.rater?.first_name ?? 'Member'} ${x.rater?.last_initial ?? ''}.`, stars: x.stars, tags: x.tags ?? [], comment: x.comment ?? undefined, date: x.created_at.slice(0, 10) }))
    return driver
  },
  async requestToJoin(matchId) {
    const m = matchCache.get(matchId)
    const commuteId = m?.commuteId ?? Object.values(commuteIds())[0]
    if (!commuteId) throw new ApiError('Plan your commute first.', 'invalid')
    if(!m?.quoteId)throw new ApiError('Refresh your matches before requesting this offer.','invalid')
    const { data, error } = await sb().rpc('request_to_join_quote', { p_commute: commuteId, p_leg: matchId,p_quote:m.quoteId })
    if (error) fail(error)
    return liveApi.getJoinRequest(data as string)
  },
  async getJoinRequest(id): Promise<JoinRequest> {
    const { data, error } = await sb().from('join_requests').select('id, leg_id, status, created_at, start_date').eq('id', id).maybeSingle()
    if (error) fail(error)
    if (!data) throw new ApiError('We couldn’t find that request.', 'not-found')
    return { id: data.id, matchId: data.leg_id, status: mapRequestStatus(data.status, data.created_at), createdAt: data.created_at, startDate: data.start_date }
  },
  async cancelJoinRequest(id) {
    const { error } = await sb().rpc('cancel_join_request', { p_request: id })
    if (error) fail(error)
  },

  async getMyClubs() {
    const { data, error } = await sb().rpc('get_my_clubs')
    if (error) fail(error)
    const asPassenger: LiftClub[] = (data.asPassenger as J[]).map((c) => {
      const driver = toDriver(c.driver, c.vehicle, 0, `Regular commute to ${c.destination?.label ?? ''}`)
      return {
        id: c.legId,
        matchId: c.legId,
        direction: c.direction,
        driver,
        members: [
          { id: driver.id, firstName: driver.firstName, lastInitial: driver.lastInitial, avatarHue: driver.avatarHue, avatarUrl: driver.avatarUrl, role: 'driver' as const },
          ...((c.members ?? []) as J[]).map((m) => ({ id: m.id, firstName: m.firstName, lastInitial: m.lastInitial ?? '', avatarHue: hueFor(m.id), avatarUrl: publicFileUrl('avatars', m.avatarPath), role: 'passenger' as const })),
        ],
        pickup: toPlace(c.pickup),
        destination: toPlace(c.destination),
        days: days(c.days),
        pickupTime: c.pickupTime,
        arrivalTime: c.arrivalTime ?? undefined,
        startDate: c.startDate,
        seatsTotal: Number(c.vehicle?.seatsTotal ?? 0),
        seatsTaken: Number(c.seatsTaken ?? 0),
        monthlyContribution: Number(c.monthlyContribution),
        nextContributionDate: nextMonthFirst(),
        paymentStatus: (c.paymentStatus ?? 'upcoming') as PaymentStatus,
        paused: !!c.paused,
        schedule:c.schedule,
      }
    })
    const asDriver: DriverLegSummary[] = (data.asDriver as J[]).map((l) => ({
      legId: l.legId,
      requestsPaused: !!l.requestsPaused,
      direction: l.direction,
      originLabel: l.originLabel,
      destinationLabel: l.destinationLabel,
      departureTime: l.departureTime,
      days: days(l.days),
      seatsOpen: Number(l.seatsOpen),
      maxDeviationMin: Number(l.maxDeviationMin),
      monthlyContribution: Number(l.monthlyContribution),
      routeDistanceM: Number(l.routeDistanceM),
      route: line(l.route),
      members: ((l.members ?? []) as J[]).map((m) => ({ id: m.id, firstName: m.firstName, lastInitial: m.lastInitial ?? '', avatarHue: hueFor(m.id), avatarUrl: publicFileUrl('avatars', m.avatarPath), pickupLabel: m.pickupLabel, pickupTime: m.pickupTime, monthlyContribution:m.monthlyContribution==null?undefined:Number(m.monthlyContribution), paymentStatus: (m.paymentStatus ?? 'upcoming') as PaymentStatus })),
    }))
    asDriver.sort((a,b)=>a.direction===b.direction?a.legId.localeCompare(b.legId):a.direction==='to_work'?-1:1)
    return { asPassenger, asDriver }
  },
  async listIncomingRequests(): Promise<IncomingRequest[]> {
    const { data, error } = await sb().rpc('list_incoming_requests')
    if (error) fail(error)
    return (data as J[]).map((r) => ({
      id: r.id,
      legId: r.legId,
      direction: r.direction,
      passenger: { id: r.passenger.id, firstName: r.passenger.firstName, lastInitial: r.passenger.lastInitial ?? '', avatarHue: hueFor(r.passenger.id), rating: Number(r.passenger.rating), ratingCount: Number(r.passenger.ratingCount), verified: !!r.passenger.verified, area: r.pickup?.label ?? '', reliability: Number(r.passenger.reliability ?? 100) },
      pickup: toPlace(r.pickup),
      destination: toPlace(r.destination),
      walkingFlexibilityM: Number(r.walkingFlexibilityM),
      days: days(r.days),
      arriveBy: r.arriveBy,
      routeOverlap: Number(r.routeOverlap),
      currentCommuteMinutes: Number(r.currentCommuteMinutes),
      deviationMinutes: Number(r.deviationMinutes),
      additionalDistanceKm: Number(r.additionalDistanceKm),
      geometry: { path: line(r.geometry?.path), deviation: line(r.geometry?.deviation), walking: [] },
      specificDates: Array.isArray(r.specificDates) && r.specificDates.length ? (r.specificDates as string[]) : undefined,
      startDate: r.startDate ?? undefined,
      status: r.status,
      monthlyContribution: Number(r.monthlyContribution),
    }))
  },
  async respondToRequest(id, decision) {
    const { error } = await sb().rpc('respond_to_request', { p_request: id, p_accept: decision === 'accept' })
    if (error) fail(error)
    const all = await liveApi.listIncomingRequests()
    const r = all.find((x) => x.id === id)
    if (!r) throw new ApiError('We couldn’t find that request.', 'not-found')
    return r
  },
  async removeMember(legId, passengerId) {
    const { error } = await sb().rpc('remove_member', { p_leg: legId, p_passenger: passengerId })
    if (error) fail(error)
  },
  async markContributionPaid(legId, passengerId) {
    const { error } = await sb().rpc('mark_contribution_paid', { p_leg: legId, p_passenger: passengerId, p_period: isoDate(0) })
    if (error) fail(error)
  },
  async addException(e) {
    const me=await uid()
    const {data,error}=await sb().from('schedule_exceptions').insert({user_id:me,leg_id:e.legId??null,kind:e.kind,date:e.date==='ongoing'?null:e.date,note:e.note??null}).select('id').single()
    if(error)fail(error)
    return {...e,id:data.id}
  },

  async getCurrentInstance() {
    const { data, error } = await sb().rpc('get_current_instance')
    if (error) fail(error)
    return data ? toInstance(data) : null
  },

  async listMessages(clubId,before,beforeSequence) {
    const me = await uid()
    let query=sb().from('messages').select('id, message_seq, sender_id, body, created_at, sender:profiles(first_name)').eq('leg_id',clubId).order('message_seq',{ascending:false}).limit(100)
    if(beforeSequence!=null)query=query.lt('message_seq',beforeSequence)
    else if(before)query=query.lt('created_at',new Date(before).toISOString())
    const {data,error}=await query
    if (error) fail(error)
    return (data as J[]).reverse().map((m) => ({ id: m.id, sequence:m.message_seq==null?undefined:Number(m.message_seq), senderId: m.sender_id, senderName: m.sender?.first_name ?? '', body: m.body, createdAt: new Date(m.created_at).getTime(), mine: m.sender_id === me }))
  },
  async sendMessage(clubId, body, messageId = crypto.randomUUID()) {
    const { error } = await sb().rpc('send_club_message', { p_leg: clubId, p_message: messageId, p_body: body })
    if (error) fail(error)
  },
  async markClubRead(clubId, messageId) {
    await pilotRpc('mark_club_read', { p_leg: clubId, p_message: messageId ?? null })
  },
  async listChatSummaries() { return await pilotRpc('list_chat_summaries') },
  subscribeMessages(clubId, onMessage) {
    let me = currentUserId??''
    let active=true
    void uid().then((id) => (me = id)).catch(() => {})
    const ch = sb()
      .channel(`messages:${clubId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `leg_id=eq.${clubId}` }, (p) => {
        const m = p.new as J
        if(!active)return
        onMessage({ id: m.id, sequence:Number(m.message_seq), senderId: m.sender_id, senderName: '', body: m.body, createdAt: new Date(m.created_at).getTime(), mine: m.sender_id === me })
        void sb().from('profiles').select('first_name').eq('id',m.sender_id).maybeSingle().then(({data})=>{if(active&&data)onMessage({id:m.id,sequence:Number(m.message_seq),senderId:m.sender_id,senderName:data.first_name,body:m.body,createdAt:new Date(m.created_at).getTime(),mine:m.sender_id===me})})
      })
      .subscribe(status=>{if(status==='SUBSCRIBED')void liveApi.listMessages(clubId).then(ms=>{if(active)ms.forEach(onMessage)}).catch(()=>{})})
    return () => {active=false;void sb().removeChannel(ch)}
  },
  async listNotifications(): Promise<AppNotification[]> {
    const { data, error } = await sb().from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
    if (error) fail(error)
    return (data as J[]).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link ?? undefined, read: !!n.read_at, createdAt: new Date(n.created_at).getTime() }))
  },
  async markNotificationsRead() {
    const me = await uid()
    const {error}=await sb().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null)
    if(error)fail(error)
  },
  subscribeNotifications(onNew) {
    let active=true
    let ch: ReturnType<ReturnType<typeof sb>['channel']> | null = null
    void uid()
      .then((me) => {
        if(!active)return
        ch = sb()
          .channel(`notifications:${me}:${crypto.randomUUID()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, (p) => {
            if(!active)return
            const n = p.new as J
            onNew({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link ?? undefined, read: false, createdAt: Date.now() })
          })
          .subscribe()
      })
      .catch(() => {})
    return () => {
      active=false
      if (ch) void sb().removeChannel(ch)
    }
  },
  async savePushToken(token,platform){await pilotRpc('register_push_destination',{p_token:token,p_platform:platform})},

  async submitRating({ driverId, stars, tags, comment, legId, instanceId }) {
    const me = await uid()
    if (!legId||!instanceId) throw new ApiError('Choose a completed commute to rate.', 'invalid')
    const { error } = await sb().from('ratings').insert({ rater_id: me, ratee_id: driverId, leg_id: legId, instance_id:instanceId, stars, tags, comment: comment || null })
    if (error) fail(error)
  },
  async submitReport({ kind, body, subjectId }) {
    const me = await uid()
    const { error } = await sb().from('reports').insert({ reporter_id: me, kind, body, subject_id: subjectId ?? null })
    if (error) fail(error)
  },

  async exportMyData() {
    const { data, error } = await sb().rpc('export_my_data')
    if (error) fail(error)
    return data
  },
  async deleteMyAccount() {
    const { error } = await sb().rpc('delete_my_account')
    if (error) {
      if (/function .*delete_my_account|Could not find the function/i.test(error.message))
        throw new ApiError('Account deletion isn’t enabled on the server yet. Email privacy@lifty.co.za and we’ll delete your data within 30 days.', 'not-configured')
      fail(error)
    }
    markDeliberateSignOut()
    await sb().auth.signOut({scope:'local'}).catch(()=>undefined) // the account is gone; just clear this device
  },

  async isAdmin() {
    const { data, error } = await sb().rpc('is_admin')
    if (error) return false
    return !!data
  },
  async listPendingDocuments(){return (await pilotRpc('list_pending_documents')).map((d:J)=>({...d,expiresOn:d.expiresOn??d.expires_on??undefined}))},
  async documentUrl(path) {
    if (!path) return null
    const { data } = await sb().storage.from('kyc').createSignedUrl(path, 300)
    return data?.signedUrl ?? null
  },
  async reviewDocument(id, approve, note) {
    const { error } = await sb().rpc('review_document', { p_doc: id, p_approve: approve, p_note: note ?? null })
    if (error) fail(error)
  },
  async listReports(){return await pilotRpc('list_safety_reports')},
  async updateReport(id, status) {
    const { error } = await sb().rpc('admin_update_report', { p_report: id, p_status: status })
    if (error) fail(error)
  },
}

/** Build a Match-shaped object from today's commute instance so tracking screens can render it. */
export function instanceToMatch(inst: CommuteInstance, myId?: string): Match & { liveInstance: CommuteInstance } {
  const rider = inst.riders.find((r) => r.passengerId === myId) ?? inst.riders.find((r) => r.status !== 'absent') ?? inst.riders[0]
  const pickup = rider?.pickup ?? inst.destination
  return {
    id: inst.legId,
    direction: inst.direction,
    liveInstance: inst,
    driver: {
      id: inst.driver.id,
      isTest: inst.driver.isTest,
      firstName: inst.driver.firstName,
      lastInitial: inst.driver.lastInitial,
      avatarHue: inst.driver.avatarHue,
      rating: inst.driver.rating,
      ratingCount: inst.driver.ratingCount,
      verification: inst.driver.verification,
      vehicle: { ...inst.vehicle, year: 0, seatsTotal: 0 },
      seatsAvailable: 0,
      memberSince: '',
      completedArrangements: 0,
      completedTrips: inst.driver.completedTrips ?? 0,
      routeSummary: '',
      reviews: [],
      reliability: inst.driver.reliability ?? null,
    },
    origin: pickup,
    pickup,
    destination: inst.destination,
    geometry: { path: inst.route, deviation: [], walking: [] },
    routeOverlap: 0,
    walkingDistanceM: 0,
    walkingMinutes: 0,
    driverDeviationMinutes: 0,
    additionalDistanceKm: 0,
    departureTime: new Date(inst.departsAt).toTimeString().slice(0, 5),
    pickupEta: rider?.pickupTime ?? '',
    arrivalEta: new Date(inst.departsAt + inst.routeDurationS * 1000).toTimeString().slice(0, 5),
    days: [],
    availableSeats: 0,
    monthlyContribution: { driverContribution: 0, platformFee: 0, processingFee: 0, total: 0 },
    compatibility: 0,
    currentCommuteMinutes: Math.round(inst.routeDurationS / 60),
    members: [],
  }
}
