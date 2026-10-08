import { readFileSync, writeFileSync } from 'node:fs'
const edit=(p,f)=>writeFileSync(p,f(readFileSync(p,'utf8')))
edit('src/services/api.ts',s=>s.replace('  async signOut() {},',`  async getAccountSnapshot() { return null },
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
  async signOut() {},`).replace('  async addException() {},',"  async addException(e) { return { ...e, id: crypto.randomUUID() } },"))
edit('src/store/app.tsx',s=>s.replace("import { DEFAULT_PLAN, HOME, WORK } from '@/data/mock'",`import { DEFAULT_PLAN, HOME, WORK } from '@/data/mock'
import { api, getDataSource, isLive, type AccountSnapshot } from '@/services/api'
import { supabase } from '@/services/supabase'
import { clearLiveCaches } from '@/services/liveApi'
import { disposeTrackingFeeds } from '@/services/tracking'
import { useRef } from 'react'`).replace('  role: Role | null','  authReady: boolean\n  authError: string | null\n  verification: import(\'@/domain/types\').PublicVerification\n  role: Role | null').replace('  role: null,',"  authReady: true, authError: null, verification: { identity: 'pending', licence: 'pending', vehicle: 'pending', insurance: 'pending' },\n  role: null,").replace('function load(): AppState {',`export function freshLiveState(): AppState {
 return { ...initialState, authReady: false, sharingConsent: false, paymentMethodId: '',
 plan: { ...initialState.plan, origin: {label:'',area:'',location:{lat:0,lng:0}}, destination:{label:'',area:'',location:{lat:0,lng:0}}, preferredPickup:undefined, startDate:new Date().toISOString().slice(0,10),dates:[] },
 prefs:{homeAddress:'',workAddress:'',preferredPickup:''},
 driver:{ ...initialState.driver, vehicle:{registration:'',make:'',model:'',year:'',colour:'',seats:3,bodyType:'sedan'}, members:[], monthlyContribution:0,
 commute:{...initialState.driver.commute,origin:'',destination:'',originPlace:undefined,destinationPlace:undefined} } }
}
function load(): AppState {
  if (getDataSource()==='live') return freshLiveState()`).replace('  addException: (e: Omit<ScheduleException, \'id\'>) => void',"  refreshAccount: () => Promise<AccountSnapshot | null>\n  addException: (e: Omit<ScheduleException, 'id'>) => Promise<void>").replace('  removeException: (id: string) => void','  removeException: (id: string) => Promise<void>').replace('  useEffect(() => {\n    try {\n      localStorage.setItem(KEY',"  useEffect(() => {\n    if (isLive()) return\n    try {\n      localStorage.setItem(KEY").replace('  const update = useCallback(',`  const generation = useRef(0)
  const applySnapshot = useCallback((snapshot: AccountSnapshot | null) => {
    if (!snapshot) { setState({...freshLiveState(),authReady:true}); return }
    const input=snapshot.driverSetup
    const first=input?.legs.find(l=>l.direction==='to_work') ?? input?.legs[0]
    const evening=input?.legs.find(l=>l.direction==='to_home')
    const base=freshLiveState()
    setState({ ...base,authReady:true,user:snapshot.user,phone:snapshot.user.phone,role:snapshot.user.role,verified:true,onboarded:snapshot.onboarded,
      plan:snapshot.commutes.find(c=>c.direction==='to_work') ?? snapshot.commutes[0] ?? base.plan,
      sharingConsent:snapshot.preferences.locationConsent,lowData:snapshot.preferences.lowData,emergencyContact:snapshot.preferences.emergencyContact,
      avatarUrl:snapshot.avatarUrl,exceptions:snapshot.exceptions,request:snapshot.pendingRequests.find(r=>r.status==='pending'||r.status==='reviewing') ?? snapshot.pendingRequests[0] ?? null,
      savedAlert:snapshot.savedAlert,verification:snapshot.verification,
      driver:input ? {...base.driver,vehicle:input.vehicle,seatsOpen:input.seats,monthlyContribution:input.monthlyContribution,
      docs:{id:snapshot.documents.some(d=>d.kind==='id'),licence:snapshot.documents.some(d=>d.kind==='licence'),registration:snapshot.documents.some(d=>d.kind==='vehicle_registration'),insurance:snapshot.documents.some(d=>d.kind==='insurance')},
      commute:{...base.driver.commute,origin:first?.origin.label ?? '',destination:first?.destination.label ?? '',originPlace:first?.origin,destinationPlace:first?.destination,
       departure:first?.departure ?? '06:30',returnTime:evening?.departure ?? '17:00',offerReturn:!!evening,days:first?.days ?? [],maxDeviationMin:input.maxDeviationMin}} : base.driver })
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
    const id=session?.user.id ?? null
    if(id!==previousId){ ++generation.current; disposeTrackingFeeds(); clearLiveCaches(); setState({...freshLiveState(),authReady:!id}); previousId=id }
    if(id) setTimeout(()=>{void refreshAccount().catch(()=>{})},0)
   })
   void supabase.auth.getSession().then(({data})=>{if(data.session) void refreshAccount().catch(()=>{}); else setState({...freshLiveState(),authReady:true})})
   return()=>{++generation.current;data.subscription.unsubscribe();disposeTrackingFeeds()}
  },[refreshAccount])
  const update = useCallback(`).replace("    (e: Omit<ScheduleException, 'id'>) =>\n      setState((s) => ({ ...s, exceptions: [...s.exceptions, { ...e, id: `ex-${Date.now()}` }] })),",`    async (e: Omit<ScheduleException, 'id'>) => {
      const saved=await api.addException(e)
      setState(s=>({...s,exceptions:[...s.exceptions,saved]}))
    },`).replace("    (id: string) => setState((s) => ({ ...s, exceptions: s.exceptions.filter((x) => x.id !== id) })),",`    async (id: string) => { await api.deleteException(id); setState(s=>({...s,exceptions:s.exceptions.filter(x=>x.id!==id)})) },`).replace('    setState(initialState)','    disposeTrackingFeeds(); clearLiveCaches(); ++generation.current\n    setState(isLive()?{...freshLiveState(),authReady:true}:initialState)').replace('({ state, update, updateDriver, updatePlan, addException, removeException, reset })','({ state, update, updateDriver, updatePlan, addException, removeException, reset, refreshAccount })').replace('[state, update, updateDriver, updatePlan, addException, removeException, reset]','[state, update, updateDriver, updatePlan, addException, removeException, reset, refreshAccount]'))
edit('src/App.tsx',s=>s.replace('  return (\n    <MapSettings.Provider',`  if (!state.authReady) return <div className="app-frame center" role="status">Restoring your account…</div>
  if (state.authError) return <div className="app-frame center"><p role="alert">{state.authError}</p><button className="btn btn-primary" onClick={()=>location.reload()}>Retry</button><button className="btn btn-text" onClick={()=>void api.signOut()}>Sign out</button></div>
  return (
    <MapSettings.Provider`))
edit('src/screens/auth/Auth.tsx',s=>{
 s=s.replace("  const [password, setPassword] = useState('')\n",'').replace('  const passOk = password.length >= 8\n','').replace('nameOk && phoneOk && passOk && agree','nameOk && phoneOk && agree').replace('phone: `+27${digits}`, password, role:','phone: `+27${digits}`, role:')
 s=s.replace(/^.*<TextField label="Password".*\n/m,'').replaceAll('WhatsApp / mobile number','mobile number').replace('Choose one. You can switch later from your profile — it just needs a short set-up.','Choose your role. Each pilot account has one role.')
 const start=s.indexOf('      // returning users (live)')
 const end=s.indexOf('\n    } catch (e)',start)
 s=s.slice(0,start)+`      const role = profile?.user.role ?? state.role ?? 'passenger'
      const onboarded = profile?.onboarded ?? false
      if (profile) await refreshAccount()
      else update({verified:true,role,onboarded:false})
      nav(onboarded ? (role === 'driver' ? '/d/home' : '/p/home') : role === 'driver' ? '/onboarding/driver/1' : '/onboarding/passenger/1', { replace: true })`+s.slice(end)
 const pos=s.indexOf('export function Otp()')
 s=s.slice(0,pos)+s.slice(pos).replace('const { state, update } = useApp()','const { state, update, refreshAccount } = useApp()')
 return s
})
