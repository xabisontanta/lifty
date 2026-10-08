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

function load(): AppState {
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
  addException: (e: Omit<ScheduleException, 'id'>) => void
  removeException: (id: string) => void
  reset: () => void
}

const AppContext = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }, [state])

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
    (e: Omit<ScheduleException, 'id'>) =>
      setState((s) => ({ ...s, exceptions: [...s.exceptions, { ...e, id: `ex-${Date.now()}` }] })),
    [],
  )
  const removeException = useCallback(
    (id: string) => setState((s) => ({ ...s, exceptions: s.exceptions.filter((x) => x.id !== id) })),
    [],
  )
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
      localStorage.removeItem('lifty.requests')
      localStorage.removeItem('lifty.incoming')
      localStorage.removeItem('lifty.commuteIds')
      localStorage.removeItem('lifty.source')
    } catch {
      /* ignore */
    }
    setState(initialState)
  }, [])

  const value = useMemo(
    () => ({ state, update, updateDriver, updatePlan, addException, removeException, reset }),
    [state, update, updateDriver, updatePlan, addException, removeException, reset],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const c = useContext(AppContext)
  if (!c) throw new Error('useApp must be used inside AppProvider')
  return c
}
