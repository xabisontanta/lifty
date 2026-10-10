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
import { api, isLive, type AccountSnapshot } from '@/services/api'
import { supabase } from '@/services/supabase'
import { clearLiveCaches } from '@/services/liveApi'
import { setNotice, wasDeliberateSignOut } from '@/lib/notice'
import { hasStoredLogin, isSessionProblem, isTransientProblem, restoreFailureMessage } from '@/services/sessionErrors'
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
  plan: { direction:'to_work', origin:{label:'',area:'',location:{lat:0,lng:0}}, destination:{label:'',area:'',location:{lat:0,lng:0}}, days:[0,1,2,3,4], arriveBy:'08:00', arriveWindowStart:'07:45', returnTime:'17:00', maxWalkMeters:750, scheduleMode:'weekly', startDate:'', dates:[], skipHolidays:true },
  prefs: { homeAddress: '', workAddress: '', preferredPickup: '' },
  request: null,
  club: null,
  returnClub: null,
  lowData: false,
  exceptions: [],
  paymentMethodId: '',
  savedAlert: false,
  sharingConsent: false,
  emergencyContact: '',
  ratedMatchIds: [],
  driver: {
    vehicle: { registration: '', make: '', model: '', year: '', colour: '', seats: 3, bodyType: 'sedan' },
    docs: { id: false, licence: false, registration: false, insurance: false },
    commute: {
      origin: '',
      destination: '',
      offerReturn: true,
      departure: '06:30',
      returnTime: '17:00',
      days: [0, 1, 2, 3, 4],
      maxDeviationMin: 8,
    },
    seatsOpen: 2,
    members: [],
    monthlyContribution: 0,
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
function load(): AppState { return freshLiveState() }

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
    catch(e){
      if(n===generation.current){
        if(isSessionProblem(e)){
          // expired / revoked / account gone: the only cure is a fresh sign-in, so do it cleanly instead of a dead-end error screen
          try{await supabase?.auth.signOut({scope:'local'})}catch{/* nothing more to clear */}
          disposeTrackingFeeds(); clearLiveCaches(); ++generation.current
          setNotice('Your session expired. Please sign in again.')
          setState({...freshLiveState(),authReady:true})
        } else { disposeTrackingFeeds(); setState({...freshLiveState(),authReady:true,authError:restoreFailureMessage(e)}) }
      }
      throw e
    }
  },[applySnapshot])
  useEffect(()=>{
   if(!isLive() || !supabase) return
   const client=supabase
   let previousId: string | null= null
   const {data}=client.auth.onAuthStateChange((event,session)=>{
    if(!isLive())return
    const id=session?.user.id ?? null
    if(id!==previousId){
     // a session that vanishes by itself (refresh token rejected, signed out from another tab) is explained, not silent
     if(!id && previousId!==null && !wasDeliberateSignOut()) setNotice('You were signed out. Please sign in again.')
     ++generation.current; disposeTrackingFeeds(); clearLiveCaches(); setState({...freshLiveState(),authReady:!id}); previousId=id
    }
    if(id&&event!=='TOKEN_REFRESHED') setTimeout(()=>{void refreshAccount().catch(()=>{})},0)
   })
   // never sit on "Restoring your account…" forever: a hung or failed session check ends in a clear, retryable state
   const watchdog=window.setTimeout(()=>{setState(s=>s.authReady?s:{...s,authReady:true,authError:restoreFailureMessage(new Error('timeout'))})},12000)
   const hadLogin=hasStoredLogin()
   client.auth.getSession().then(({data:{session},error})=>{
    if(session){void refreshAccount().catch(()=>{});return}
    // a transient failure (no signal) must not destroy a good stored login: offer a retry instead
    if(error&&isTransientProblem(error)){setState({...freshLiveState(),authReady:true,authError:restoreFailureMessage(error)});return}
    if(hadLogin)setNotice('Your session expired. Please sign in again.') // there was a saved login and it is gone: say so
    setState({...freshLiveState(),authReady:true})
   }).catch((e:unknown)=>{
    if(isTransientProblem(e)){setState({...freshLiveState(),authReady:true,authError:restoreFailureMessage(e)});return}
    void client.auth.signOut({scope:'local'}).catch(()=>undefined) // an unusable stored login: clear it
    setState({...freshLiveState(),authReady:true})
   })
   return()=>{window.clearTimeout(watchdog);++generation.current;data.subscription.unsubscribe();disposeTrackingFeeds()}
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
    setState({...freshLiveState(),authReady:true})
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
