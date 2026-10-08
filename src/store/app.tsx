import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ClubMember,
  CommutePlan,
  JoinRequest,
  Place,
  LiftClub,
  Role,
  ScheduleException,
  UserProfile,
  Weekday,
} from '@/domain/types'
import { DEFAULT_PLAN, HOME, WORK } from '@/data/mock'
import { api, getDataSource, isLive, type AccountSnapshot } from '@/services/api'
import { supabase } from '@/services/supabase'
import { clearLiveCaches } from '@/services/liveApi'
import { disposeTrackingFeeds } from '@/services/tracking'
import { useRef } from 'react'

export interface DriverSetup {
  vehicle: { registration: string; make: string; model: string; year: string; colour: string; seats: number; bodyType: 'sedan' | 'hatchback' | 'suv' | 'other'; photoUrl?: string }
  docs: { id: boolean; licence: boolean; registration: boolean; insurance: boolean }
  commute: {
    origin: string
    destination: string
    originPlace?: Place
    destinationPlace?: Place
    /** also offer the evening trip home (a separate lift-club leg) */
    offerReturn: boolean
    departure: string
    returnTime: string
    days: Weekday[]
    maxDeviationMin: number
  }
  seatsOpen: number
  /** passengers the driver has accepted */
  members: ClubMember[]
  monthlyContribution: number
}

export interface PassengerPrefs {
  homeAddress: string
  workAddress: string
  preferredPickup: string
}

export interface AppState {
  authReady: boolean
  authError: string | null
  verification: import('@/domain/types').PublicVerification
  role: Role | null
  user: UserProfile | null
  phone: string
  verified: boolean
  onboarded: boolean
  plan: CommutePlan
  prefs: PassengerPrefs
  request: JoinRequest | null
  club: LiftClub | null
  /** evening leg (work → home) — may be a different driver, or none */
  returnClub: LiftClub | null
  lowData: boolean
  avatarUrl?: string
  exceptions: ScheduleException[]
  paymentMethodId: string
  savedAlert: boolean
  driver: DriverSetup
  sharingConsent: boolean
  emergencyContact: string
  ratedMatchIds: string[]
}

export const initialState: AppState = {
  authReady: true, authError: null, verification: { identity: 'pending', licence: 'pending', vehicle: 'pending', insurance: 'pending' },
  role: null,
  user: null,
  phone: '',
  verified: false,
  onboarded: false,
  plan: DEFAULT_PLAN,
  prefs: { homeAddress: HOME.label + ', Ballito', workAddress: WORK.area, preferredPickup: 'Shell Garage, Ballito' },
  request: null,
  club: null,
  returnClub: null,
  lowData: false,
  exceptions: [],
  paymentMethodId: 'pm-card',
  savedAlert: false,
  sharingConsent: true,
  emergencyContact: '',
  ratedMatchIds: [],
  driver: {
    vehicle: { registration: 'ND 123 456', make: 'Toyota', model: 'Corolla', year: '2019', colour: 'Silver', seats: 3, bodyType: 'sedan' },
    docs: { id: false, licence: false, registration: false, insurance: false },
    commute: {
      origin: 'Ballito, KwaDukuza',
      destination: 'Umhlanga Ridge, Durban',
      offerReturn: true,
      departure: '06:30',
      returnTime: '17:00',
      days: [0, 1, 2, 3, 4],
      maxDeviationMin: 8,
    },
    seatsOpen: 2,
    members: [{ id: 'pax-lindiwe', firstName: 'Lindiwe', lastInitial: 'S', avatarHue: 300, role: 'passenger', paymentStatus: 'paid' }],
    monthlyContribution: 1100,
  },
}

const KEY = 'lifty.state.v1'

export function freshLiveState(): AppState {
 return { ...initialState, authReady: false, sharingConsent: false, paymentMethodId: '',
 plan: { ...initialState.plan, origin: {label:'',area:'',location:{lat:0,lng:0}}, destination:{label:'',area:'',location:{lat:0,lng:0}}, preferredPickup:undefined, startDate:new Date().toISOString().slice(0,10),dates:[] },
 prefs:{homeAddress:'',workAddress:'',preferredPickup:''},
 driver:{ ...initialState.driver, vehicle:{registration:'',make:'',model:'',year:'',colour:'',seats:3,bodyType:'sedan'}, members:[], monthlyContribution:0,
 commute:{...initialState.driver.commute,origin:'',destination:'',originPlace:undefined,destinationPlace:undefined} } }
}
function load(): AppState {
  if (getDataSource()==='live') return freshLiveState()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      return { ...initialState, ...saved, plan: { ...initialState.plan, ...saved.plan }, driver: { ...initialState.driver, ...saved.driver, vehicle: { ...initialState.driver.vehicle, ...saved.driver?.vehicle }, commute: { ...initialState.driver.commute, ...saved.driver?.commute } } }
    }
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return initialState
}

interface Ctx {
  state: AppState
  update: (patch: Partial<AppState>) => void
  updateDriver: (patch: Partial<DriverSetup>) => void
  updatePlan: (patch: Partial<CommutePlan>) => void
  refreshAccount: () => Promise<AccountSnapshot | null>
  addException: (e: Omit<ScheduleException, 'id'>) => Promise<void>
  removeException: (id: string) => Promise<void>
  reset: () => void
}

const AppContext = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    if (isLive()) return
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }, [state])

  const generation = useRef(0)
  const applySnapshot = useCallback((snapshot: AccountSnapshot | null) => {
    if (!snapshot) { setState({...freshLiveState(),authReady:true}); return }
    const input=snapshot.driverSetup
    const first=input?.legs.find(l=>l.direction==='to_work') ?? input?.legs[0]
    const evening=input?.legs.find(l=>l.direction==='to_home')
    const base=freshLiveState()
    setState(previous=>({ ...base,club:previous.user?.id===snapshot.user.id?previous.club:null,returnClub:previous.user?.id===snapshot.user.id?previous.returnClub:null,authReady:true,user:snapshot.user,phone:snapshot.user.phone,role:snapshot.user.role,verified:true,onboarded:snapshot.onboarded,
      plan:snapshot.commutes.find(c=>c.direction==='to_work') ?? snapshot.commutes[0] ?? base.plan,
      sharingConsent:snapshot.preferences.locationConsent,lowData:snapshot.preferences.lowData,emergencyContact:snapshot.preferences.emergencyContact,
      avatarUrl:snapshot.avatarUrl,exceptions:snapshot.exceptions,request:snapshot.pendingRequests.find(r=>r.status==='pending'||r.status==='reviewing') ?? snapshot.pendingRequests[0] ?? null,
      savedAlert:snapshot.savedAlert,verification:snapshot.verification,
      driver:input ? {...base.driver,vehicle:input.vehicle,seatsOpen:input.seats,monthlyContribution:input.monthlyContribution,
      docs:{id:snapshot.documents.some(d=>d.kind==='id'),licence:snapshot.documents.some(d=>d.kind==='licence'),registration:snapshot.documents.some(d=>d.kind==='vehicle_registration'),insurance:snapshot.documents.some(d=>d.kind==='insurance')},
      commute:{...base.driver.commute,origin:first?.origin.label ?? '',destination:first?.destination.label ?? '',originPlace:first?.origin,destinationPlace:first?.destination,
       departure:first?.departure ?? '06:30',returnTime:evening?.departure ?? '17:00',offerReturn:!!evening,days:first?.days ?? [],maxDeviationMin:input.maxDeviationMin}} : base.driver }))
  },[])
  const refreshAccount=useCallback(async()=>{
    if (!isLive()) return null
    const n=++generation.current
    try { const snapshot=await api.getAccountSnapshot(); if(n===generation.current) applySnapshot(snapshot); return snapshot }
    catch(e){ if(n===generation.current) { disposeTrackingFeeds(); setState({...freshLiveState(),authReady:true,authError:e instanceof Error?e.message:'Could not restore your account'}) }; throw e }
  },[applySnapshot])
  useEffect(()=>{
   if(!isLive() || !supabase) return
   let previousId: string | null= null
   const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
    if(!isLive())return
    const id=session?.user.id ?? null
    if(id!==previousId){ ++generation.current; disposeTrackingFeeds(); clearLiveCaches(); setState({...freshLiveState(),authReady:!id}); previousId=id }
    if(id&&_event!=='TOKEN_REFRESHED') setTimeout(()=>{void refreshAccount().catch(()=>{})},0)
   })
   void supabase.auth.getSession().then(({data})=>{if(data.session) void refreshAccount().catch(()=>{}); else setState({...freshLiveState(),authReady:true})})
   return()=>{++generation.current;data.subscription.unsubscribe();disposeTrackingFeeds()}
  },[refreshAccount])
  const update = useCallback((patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch })), [])
  const updateDriver = useCallback(
    (patch: Partial<DriverSetup>) => setState((s) => ({ ...s, driver: { ...s.driver, ...patch } })),
    [],
  )
  const updatePlan = useCallback(
    (patch: Partial<CommutePlan>) => setState((s) => ({ ...s, plan: { ...s.plan, ...patch } })),
    [],
  )
  const addException = useCallback(
    async (e: Omit<ScheduleException, 'id'>) => {
      const saved=await api.addException(e)
      setState(s=>({...s,exceptions:[...s.exceptions,saved]}))
    },
    [],
  )
  const removeException = useCallback(
    async (id: string) => { await api.deleteException(id); setState(s=>({...s,exceptions:s.exceptions.filter(x=>x.id!==id)})) },
    [],
  )
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
      localStorage.removeItem('lifty.requests')
      localStorage.removeItem('lifty.incoming')
      localStorage.removeItem('lifty.commuteIds')
    } catch {
      /* ignore */
    }
    disposeTrackingFeeds(); clearLiveCaches(); ++generation.current
    setState(isLive()?{...freshLiveState(),authReady:true}:initialState)
  }, [])

  const value = useMemo(
    () => ({ state, update, updateDriver, updatePlan, addException, removeException, reset, refreshAccount }),
    [state, update, updateDriver, updatePlan, addException, removeException, reset, refreshAccount],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const c = useContext(AppContext)
  if (!c) throw new Error('useApp must be used inside AppProvider')
  return c
}
