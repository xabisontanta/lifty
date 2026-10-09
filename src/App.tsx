import { useEffect, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from '@/store/app'
import { useOnline } from '@/hooks/useAsync'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/kit'
import { ErrorBoundary } from '@/components/ui/extras'
import { MapSettings } from '@/components/map/MapView'
import { api, isLive } from '@/services/api'
import { ensureNotificationPermission, notifyLocal, registerPush } from '@/services/notifications'
import { ChooseRole, Otp, SignIn, SignUp, Welcome } from '@/screens/auth/Auth'
import { DriverCommute, DriverSchedule, DriverVehicle, DriverVerification, PassengerCommute, PassengerConsent, PassengerSchedule } from '@/screens/auth/Onboarding'
import { Inbox, MyCommute, PassengerHome, PassengerProfile, PassengerTabs } from '@/screens/passenger/Tabs'
import { PlanCommute } from '@/screens/passenger/Plan'
import { Accepted, Complete, DriverPublicProfile, Finding, MatchDetail, Matches, NoMatch, PassengerTracking, RateDriver, RequestSent } from '@/screens/passenger/Flow'
import {ContributionLedger,CommuteHistory,ScheduleExceptions} from '@/screens/shared/Pilot'
import { Admin, Chat, Exceptions, Payments, Privacy, Safety, Terms } from '@/screens/shared/Shared'
import { Contributions, DriverHome, DriverProfile, DriverSettings, DriverTabs, DriverToday, MyRoute, Ratings, RequestDetail, Requests, Seats } from '@/screens/driver/Driver'
import { DriverInbox } from '@/screens/driver/Inbox'
import {DriverControls,DriverLiveTrip} from '@/screens/driver/PilotDriver'
import {currentUserId,sb} from '@/services/supabase'

function homeFor(role: string | null, onboarded: boolean): string {
  if (!role) return '/welcome'
  if (!onboarded) return role === 'driver' ? '/onboarding/driver/1' : '/onboarding/passenger/1'
  return role === 'driver' ? '/d/home' : '/p/home'
}

/** Keeps passenger and driver areas strictly separate. */
function Guard({ role, children }: { role: 'passenger' | 'driver'; children: ReactElement }) {
  const { state } = useApp()
  const loc = useLocation()
  if (state.role !== role || !state.onboarded) return <Navigate to={homeFor(state.role, state.onboarded)} replace state={{ from: loc.pathname }} />
  return children
}

function Landing() {
  const { state } = useApp()
  return <Navigate to={homeFor(state.role, state.onboarded)} replace />
}

function SetupGuard({role,children}:{role:'passenger'|'driver';children:ReactElement}) {
  const {state}=useApp()
  if(isLive()&&(!state.user||state.role!==role))return <Navigate to={homeFor(state.role,state.onboarded)} replace/>
  return children
}

/** App-wide realtime alerts: in-app toast + device notification; push registration on native. */
function LiveAlerts() {
  const toast = useToast()
  const { state, update } = useApp()
  useEffect(() => {
    if (!state.onboarded || !isLive()) return
    const accountId=state.user?.id
    let active=true
    let removePush:(()=>void)|undefined
    void registerPush(async(token,platform)=>{if(active&&currentUserId===accountId)await api.savePushToken(token,platform)}).then(remove=>{if(active)removePush=remove;else remove()})
    const unsubscribe=api.subscribeNotifications((n) => {
      if(n.kind==='verification'&&accountId)void sb().rpc('driver_verification',{p_user:accountId}).then(({data,error})=>{if(active&&!error&&data)update({verification:data})})
      toast(n.title, n.kind === 'declined' || n.kind === 'no_show' ? 'error' : 'success')
      void notifyLocal(n.title, n.body)
    })
    return()=>{active=false;removePush?.();unsubscribe()}
  }, [state.onboarded,state.user?.id, toast])
  useEffect(() => {
    if (state.onboarded) void ensureNotificationPermission()
  }, [state.onboarded])
  return null
}

export default function App() {
  const online = useOnline()
  const { state, reset } = useApp()
  if (!state.authReady) return <div className="app-frame center" role="status">Restoring your account…</div>
  if (state.authError) return <div className="app-frame center" style={{ gap: 14, padding: 24, textAlign: 'center' }}><p role="alert">{state.authError}</p><button className="btn btn-primary" onClick={()=>location.reload()}>Try again</button><button className="btn btn-text" onClick={async()=>{await api.signOut().catch(()=>undefined);reset()}}>Sign out</button></div>
  return (
    <MapSettings.Provider value={{ lowData: state.lowData }}>
    <ErrorBoundary>
    <div className="app-frame">
      <LiveAlerts />
      {!online && (
        <div role="status" style={{ background: 'var(--navy)', color: '#fff', fontSize: 13, padding: 'calc(var(--safe-top) + 6px) 12px 6px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <Icon name="wifiOff" size={16} /> You’re offline — showing saved information
        </div>
      )}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/role" element={<ChooseRole />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/otp" element={<Otp />} />

        <Route path="/onboarding/passenger/1" element={<SetupGuard role="passenger"><PassengerCommute /></SetupGuard>} />
        <Route path="/onboarding/passenger/2" element={<SetupGuard role="passenger"><PassengerSchedule /></SetupGuard>} />
        <Route path="/onboarding/passenger/3" element={<SetupGuard role="passenger"><PassengerConsent /></SetupGuard>} />
        <Route path="/onboarding/driver/1" element={<SetupGuard role="driver"><DriverVehicle /></SetupGuard>} />
        <Route path="/onboarding/driver/2" element={<SetupGuard role="driver"><DriverCommute /></SetupGuard>} />
        <Route path="/onboarding/driver/3" element={<SetupGuard role="driver"><DriverVerification /></SetupGuard>} />
        <Route path="/onboarding/driver/4" element={<SetupGuard role="driver"><DriverSchedule /></SetupGuard>} />

        {/* Passenger */}
        <Route path="/p" element={<Guard role="passenger"><PassengerTabs /></Guard>}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<PassengerHome />} />
          <Route path="commute" element={<MyCommute />} />
          <Route path="find" element={<PlanCommute />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="profile" element={<PassengerProfile />} />
        </Route>
        <Route path="/p/finding" element={<Guard role="passenger"><Finding /></Guard>} />
        <Route path="/p/matches" element={<Guard role="passenger"><Matches /></Guard>} />
        <Route path="/p/no-match" element={<Guard role="passenger"><NoMatch /></Guard>} />
        <Route path="/p/match/:id" element={<Guard role="passenger"><MatchDetail /></Guard>} />
        <Route path="/p/sent" element={<Guard role="passenger"><RequestSent /></Guard>} />
        <Route path="/p/accepted" element={<Guard role="passenger"><Accepted /></Guard>} />
        <Route path="/p/track" element={<Guard role="passenger"><PassengerTracking /></Guard>} />
        <Route path="/p/complete" element={<Guard role="passenger"><Complete /></Guard>} />
        <Route path="/p/rate" element={<Guard role="passenger"><RateDriver /></Guard>} />
        <Route path="/p/driver/:id" element={<Guard role="passenger"><DriverPublicProfile /></Guard>} />
        <Route path="/p/payments" element={<Guard role="passenger"><ContributionLedger /></Guard>} />
        <Route path="/p/exceptions" element={<Guard role="passenger"><ScheduleExceptions /></Guard>} />

        {/* Driver */}
        <Route path="/d" element={<Guard role="driver"><DriverTabs /></Guard>}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<DriverHome />} />
          <Route path="route" element={<MyRoute />} />
          <Route path="requests" element={<Requests />} />
          <Route path="inbox" element={<DriverInbox />} />
          <Route path="profile" element={<DriverProfile />} />
        </Route>
        <Route path="/d/request/:id" element={<Guard role="driver"><RequestDetail /></Guard>} />
        <Route path="/d/today" element={<Guard role="driver">{isLive()?<DriverLiveTrip/>:<DriverToday/>}</Guard>} />
        <Route path="/d/seats" element={<Guard role="driver"><DriverControls seatsOnly /></Guard>} />
        <Route path="/d/contributions" element={<Guard role="driver"><ContributionLedger /></Guard>} />
        <Route path="/d/ratings" element={<Guard role="driver"><Ratings /></Guard>} />
        <Route path="/d/settings" element={<Guard role="driver"><DriverControls /></Guard>} />
        <Route path="/d/exceptions" element={<Guard role="driver"><ScheduleExceptions /></Guard>} />

        {/* Shared */}
        <Route path="/history" element={state.user?<CommuteHistory/>:<Navigate to="/signin" replace/>} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/chat/:id" element={<Chat />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </div>
    </ErrorBoundary>
    </MapSettings.Provider>
  )
}
