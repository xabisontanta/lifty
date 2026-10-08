import {readFileSync,writeFileSync} from 'node:fs'
const p='src/services/liveApi.ts';let s=readFileSync(p,'utf8')
s=s.replace("import { publicFileUrl, sb } from './supabase'","import { publicFileUrl, sb, currentUserId } from './supabase'\nimport { pilotMethods, pilotRpc } from './pilotApi'")
s=s.replace("import { holidayName, holidaysFor } from '@/lib/holidays'","import { holidayName } from '@/lib/holidays'")
s=s.replace("verification: { identity: status, vehicle: vStatus(v?.status ?? d?.identityStatus), licence: status },","verification: d?.verification ?? { identity: status, vehicle: vStatus(v?.status), licence: 'pending', insurance: 'pending' },")
s=s.replace('    days: days(j.days),','    days: days(j.days),\n    coveredDays:days(j.coveredDays),uncoveredDays:days(j.uncoveredDays),coveredDates:j.coveredDates??[],uncoveredDates:j.uncoveredDates??[],partial:(j.uncoveredDays?.length??0)>0||(j.uncoveredDates?.length??0)>0,')
s=s.replace('    legId: j.legId,','    legId: j.legId,\n    direction:j.direction,')
s=s.replace('      pickupTime: r.pickupTime,','      pickupTime: r.pickupTime,\n      driverArrivedAt:r.driverArrivedAt?new Date(r.driverArrivedAt).getTime():null,passengerAtPickup:!!r.passengerAtPickup,collectedAt:r.collectedAt?new Date(r.collectedAt).getTime():null,noShowAt:r.noShowAt?new Date(r.noShowAt).getTime():null,')
s=s.replace('avatarHue: hueFor(j.driver.id) },','avatarHue: hueFor(j.driver.id),verification:j.driver.verification },')
s=s.replace("localStorage.getItem(COMMUTE_KEY)","localStorage.getItem(`${COMMUTE_KEY}:${currentUserId}`)")
s=s.replace('localStorage.setItem(COMMUTE_KEY,','localStorage.setItem(`${COMMUTE_KEY}:${currentUserId}`,')
s=s.replace('// ---------- implementation ----------',`export function clearLiveCaches() { matchCache.clear(); try { for(const k of Object.keys(localStorage)) if(k.startsWith(COMMUTE_KEY)||k==='lifty.state.v1') localStorage.removeItem(k) } catch {} }
// ---------- implementation ----------`)
s=s.replace('export const liveApi: LiftyApi = {','export const liveApi: LiftyApi = {\n  ...pilotMethods,')
let start=s.indexOf('  async signUp('),end=s.indexOf('  async signOut()',start)
s=s.slice(0,start)+`  async signUp({fullName,phone,role}) {
    const e164=toE164(phone)
    const {error}=await sb().auth.signInWithOtp({phone:e164,options:{channel:'sms',data:{full_name:fullName,role}}})
    if(error) fail(error)
    sessionStorage.setItem(PENDING_KEY,JSON.stringify({fullName,role,phone:e164}))
    return {resendInSeconds:30}
  },
  async sendOtp(phone) {
    const {error}=await sb().auth.signInWithOtp({phone:toE164(phone),options:{channel:'sms',shouldCreateUser:false}})
    if(error)fail(error)
    return {resendInSeconds:30}
  },
  async verifyOtp(phone,code) {
    const e164=toE164(phone)
    const {data,error}=await sb().auth.verifyOtp({phone:e164,token:code,type:'sms'})
    if(error)fail(error)
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
`+s.slice(end)
s=s.replace('    await sb().auth.signOut()','    clearLiveCaches()\n    const {error}=await sb().auth.signOut();if(error)fail(error)',1)
s=s.replace("    const me = await uid()\n    const [h, m]", "    const me = await uid()\n    const origin=plan.direction==='to_home'?plan.destination:plan.origin\n    const destination=plan.direction==='to_home'?plan.origin:plan.destination\n    const [h, m]")
for(const a of ['label','location.lng','location.lat']) {s=s.replaceAll('plan.origin.'+a,'origin.'+a);s=s.replaceAll('plan.destination.'+a,'destination.'+a)}
s=s.replace('          start_date: plan.scheduleMode', '          skip_holidays:plan.skipHolidays,\n          start_date: plan.scheduleMode')
start=s.indexOf('    // weekly commuters skip');end=s.indexOf('    return data.id as string',start)
s=s.slice(0,start)+s.slice(end)
s=s.replace('const summary = reg.length > 4 ?', "const summary = reg.includes('•') ? reg : reg.length > 4 ?")
s=s.replace("      v && { make:","      v && { make:")
s=s.replace('    const r = await sb()\n      .from(\'ratings\')',"    driver.verification=await pilotRpc('driver_verification',{p_user:id})\n    const r = await sb()\n      .from('ratings')")
s=s.replace('        paused: !!c.paused,','        paused: !!c.paused,\n        schedule:c.schedule,')
start=s.indexOf('  async addException(e) {');end=s.indexOf('\n  async getCurrentInstance()',start)
s=s.slice(0,start)+`  async addException(e) {
    const me=await uid()
    const {data,error}=await sb().from('schedule_exceptions').insert({user_id:me,leg_id:e.legId??null,kind:e.kind,date:e.date==='ongoing'?null:e.date,note:e.note??null}).select('id').single()
    if(error)fail(error)
    return {...e,id:data.id}
  },
`+s.slice(end)
s=s.replace('  async listMessages(clubId) {','  async listMessages(clubId,before) {').replace("    const { data, error } = await sb().from('messages').select('id, sender_id, body, created_at, sender:profiles(first_name)').eq('leg_id', clubId).order('created_at').limit(200)","    let query=sb().from('messages').select('id, sender_id, body, created_at, sender:profiles(first_name)').eq('leg_id',clubId).order('created_at',{ascending:false}).limit(100)\n    if(before)query=query.lt('created_at',new Date(before).toISOString())\n    const {data,error}=await query")
s=s.replace('return (data as J[]).map((m) => ({ id: m.id, senderId:', 'return (data as J[]).reverse().map((m) => ({ id: m.id, senderId:')
s=s.replace('  async submitRating({ driverId, stars, tags, comment, legId })','  async submitRating({ driverId, stars, tags, comment, legId, instanceId })').replace("    if (!legId) throw new ApiError('Rating needs a lift club.', 'invalid')","    if (!legId||!instanceId) throw new ApiError('Choose a completed commute to rate.', 'invalid')").replace('leg_id: legId, stars, tags,','leg_id: legId, instance_id:instanceId, stars, tags,')
s=s.replace("    direction: 'to_work',\n    liveInstance",'    direction: inst.direction,\n    liveInstance').replace("verification: { identity: 'verified', vehicle: 'verified', licence: 'verified' },",'verification: inst.driver.verification,')
// Stable accepted request snapshot survives matching changes and reloads.
s=s.replace('    const hit = matchCache.get(id)',`    const {data:snapshots,error:snapshotError}=await sb().from('join_requests').select('match_snapshot').eq('leg_id',id).in('status',['pending','accepted']).order('created_at',{ascending:false}).limit(1)
    if(snapshotError)fail(snapshotError)
    if(snapshots?.[0]?.match_snapshot)return toMatch(snapshots[0].match_snapshot)
    const hit = matchCache.get(id)`)
writeFileSync(p,s)
