import type { AccountSnapshot, DriverOnboardingDraft, LiftyApi } from './api'
import { ApiError } from './api'
import { sb, publicFileUrl, currentUserId } from './supabase'
import { hueFor } from './liveApi'
import { isSessionProblem } from './sessionErrors'
import type { CommutePlan, Place, ScheduleException } from '@/domain/types'
import { validCoordinate } from '@/lib/mapLocation'
import { ownedFilePath } from '@/lib/storagePaths'
import { env } from '@/lib/env'

type J = any
export async function pilotRpc(name: string, args?: Record<string, unknown>): Promise<J> {
 const {data,error}=await sb().rpc(name,args)
 if(error) throw new ApiError(error.message,isSessionProblem(error)?'auth':'server')
 return data
}
const at=(value?:string|null)=>value?new Date(value).getTime():undefined
const place=(label:string,g:J):Place=>{
 const coordinates=g?.coordinates
 const location=Array.isArray(coordinates)?{lng:coordinates[0],lat:coordinates[1]}:null
 if((g?.type&&g.type!=='Point')||!validCoordinate(location))
  throw new ApiError('Your saved commute location could not be loaded. Please retry or update your commute.','server')
 return {label,area:label,location}
}
const exception=(e:J):ScheduleException=>({id:e.id,kind:e.kind,date:e.date??'ongoing',note:e.note??undefined,legId:e.leg_id??undefined})
export function mapAccount(j:J):AccountSnapshot {
 const p=j.profile, q=j.private??{},v=j.vehicle,legs:J[]=[...(j.legs??[])].sort((a:J,b:J)=>Number(a.direction==='to_home')-Number(b.direction==='to_home')),commutes:J[]=j.commutes??[]
 const primary=legs.find(l=>l.direction==='to_work')??legs[0]
 return {
  user:{id:p.id,isTest:p.is_test===true,role:p.role,firstName:p.first_name,lastInitial:p.last_initial,fullName:[p.first_name,q.last_name].filter(Boolean).join(' '),phone:q.phone??'',avatarHue:hueFor(p.id),memberSince:p.created_at.slice(0,10)},
  onboarded:!!p.onboarding_completed_at,avatarUrl:publicFileUrl('avatars',p.avatar_path),verification:j.verification,
  preferences:{locationConsent:!!q.location_consent_at,lowData:!!q.low_data_mode,emergencyContact:q.emergency_contact??''},
  commutes:commutes.map((c):CommutePlan=>({direction:c.direction,
   origin:place(c.direction==='to_home'?c.destination_label:c.origin_label,c.direction==='to_home'?c.destinationPoint:c.originPoint),
   destination:place(c.direction==='to_home'?c.origin_label:c.destination_label,c.direction==='to_home'?c.originPoint:c.destinationPoint),
   days:c.days,arriveBy:c.arrive_by.slice(0,5),arriveWindowStart:c.arrive_by.slice(0,5),returnTime:c.direction==='to_home'?c.arrive_by.slice(0,5):(commutes.find(x=>x.direction==='to_home')?.arrive_by?.slice(0,5)??'17:00'),
   maxWalkMeters:c.max_walk_m,scheduleMode:c.specific_dates?'dates':'weekly',startDate:c.start_date,endDate:c.end_date??undefined,dates:c.specific_dates??[],skipHolidays:!!c.skip_holidays})),
  driverSetup:v?{vehicle:{registration:v.registration_summary,make:v.make,model:v.model,colour:v.colour,year:String(v.year??''),seats:v.seats_total,bodyType:v.body_type,photoUrl:publicFileUrl('vehicle-photos',v.photo_path)},
   legs:legs.map((l:J)=>({direction:l.direction,requestsPaused:!!l.requests_paused,origin:place(l.origin_label,l.originPoint),destination:place(l.destination_label,l.destinationPoint),departure:l.departure_time.slice(0,5),days:l.days,route:{coordinates:l.routeGeometry.coordinates,distanceM:l.route_distance_m,durationS:l.route_duration_s}})),
   seats:primary?.direction==='to_work'?primary.seats_open+(j.memberCount??0):v.seats_total,maxDeviationMin:primary?.max_deviation_min??8,pickupPolicy:primary?.pickup_policy??'flexible',monthlyContribution:primary?.monthly_contribution??0}:undefined,
  documents:(j.documents??[]).map((d:J)=>({id:d.id,kind:d.kind,status:d.status,expiresOn:d.expires_on??d.expiresOn??undefined,reviewNote:d.review_note??d.reviewNote??undefined})),exceptions:(j.exceptions??[]).map(exception),savedAlert:commutes.some(c=>c.notify_on_match),
  pendingRequests:(j.requests??[]).map((r:J)=>({id:r.id,matchId:r.leg_id,status:r.status,createdAt:r.created_at,startDate:r.start_date})),
 }
}

/** Drafts deliberately use a small flat Place contract and never carry approval state. */
function draftToWire(d: DriverOnboardingDraft) {
 const point=(p?:Place)=>p?{label:p.label,lng:p.location.lng,lat:p.location.lat}:undefined
 const vehicle={registration:d.vehicle.registration,make:d.vehicle.make,model:d.vehicle.model,year:d.vehicle.year,colour:d.vehicle.colour,seats:d.vehicle.seats,bodyType:d.vehicle.bodyType}
 const vehiclePhotoPath=ownedFilePath(d.vehicle.photoUrl,'vehicle-photos',currentUserId,env.supabaseUrl)
 return {...d,vehicle,...(vehiclePhotoPath?{vehiclePhotoPath}:{}),commute:{...d.commute,originPlace:point(d.commute.originPlace),destinationPlace:point(d.commute.destinationPlace)}}
}
function draftFromWire(d:J):DriverOnboardingDraft|null {
 if(!d||typeof d!=='object'||!d.commute||!d.vehicle)return null
 const point=(p:J):Place|undefined=>p&&validCoordinate({lng:p.lng,lat:p.lat})?{label:p.label,area:p.label,location:{lng:p.lng,lat:p.lat}}:undefined
 return {...d,vehicle:{...d.vehicle,...(d.vehiclePhotoPath?{photoUrl:publicFileUrl('vehicle-photos',d.vehiclePhotoPath)}:{})},commute:{...d.commute,originPlace:point(d.commute.originPlace),destinationPlace:point(d.commute.destinationPlace)}}
}
let draftQueue:Promise<void>=Promise.resolve()

export const pilotMethods: Pick<LiftyApi,
 'getAccountSnapshot'|'completeOnboarding'|'updateProfileName'|'saveDriverSettings'|'saveDriverOnboardingDraft'|'getDriverOnboardingDraft'|'clearDriverOnboardingDraft'|'setDriverRequestsPaused'|'listExceptions'|'deleteException'|'setPause'|
 'requestPickupChange'|'listPickupChanges'|'reviewPickupChange'|'listContributions'|'reportContribution'|'confirmContribution'|'listHistory'|'setMatchAlert'|'getAdminHealth'|'suspendUser'> = {
 async getAccountSnapshot(){
  const {data,error}=await sb().auth.getSession()
  if(error) throw new ApiError(error.message,'auth')
  if(!data.session) return null
  const j=await pilotRpc('get_account_snapshot')
  if(!j)return null
  const snapshot=mapAccount(j)
  if(snapshot.user.role==='driver'&&!snapshot.onboarded)snapshot.driverDraft=await pilotMethods.getDriverOnboardingDraft()??undefined
  return snapshot
 },
 async completeOnboarding(){await pilotRpc('complete_onboarding')},
 async updateProfileName(fullName){return await pilotRpc('update_profile_name',{p_full_name:fullName})},
 async saveDriverOnboardingDraft(draft){
  const owner=currentUserId,payload=draftToWire(draft)
  const save=draftQueue.catch(()=>undefined).then(async()=>{
   if(!owner||currentUserId!==owner)throw new ApiError('The account changed. Sign in again before saving setup.','auth')
   await pilotRpc('save_driver_onboarding_draft',{p_draft:payload})
  })
  draftQueue=save;await save
 },
 async getDriverOnboardingDraft(){return draftFromWire(await pilotRpc('get_driver_onboarding_draft'))},
 async clearDriverOnboardingDraft(){await pilotRpc('clear_driver_onboarding_draft')},
 async setDriverRequestsPaused(legId,paused){await pilotRpc('set_driver_requests_paused',{p_leg:legId,p_paused:paused})},
 async saveDriverSettings(legId,input){await pilotRpc('save_driver_settings',{p_leg:legId,p_seats:input.seats,p_deviation:input.maxDeviationMin,p_contribution:input.monthlyContribution,p_departure:input.departureTime??null,p_days:input.days??null,p_pickup_policy:input.pickupPolicy??null})},
 async listExceptions(){const {data:user}=await sb().auth.getUser();const {data,error}=await sb().from('schedule_exceptions').select('*').eq('user_id',user.user?.id??'').order('created_at');if(error)throw new ApiError(error.message,'server');return (data??[]).map(exception)},
 async deleteException(id){const {error}=await sb().from('schedule_exceptions').delete().eq('id',id);if(error)throw new ApiError(error.message,'server')},
 async setPause(legId,paused){await pilotRpc('set_club_pause',{p_leg:legId,p_paused:paused})},
 async requestPickupChange({legId,date,pickup}){await pilotRpc('request_pickup_change',{p_leg:legId,p_date:date,p_label:pickup.label,p_lng:pickup.location.lng,p_lat:pickup.location.lat})},
 async listPickupChanges(){return await pilotRpc('list_pickup_changes')},
 async reviewPickupChange(id,approve){await pilotRpc('review_pickup_change',{p_id:id,p_approve:approve})},
 async listContributions(legId){
  const {data,error}=await sb().from('contributions').select('*,passenger:profiles!contributions_passenger_id_fkey(first_name)').order('period',{ascending:false})
  if(error)throw new ApiError(error.message,'server')
  return (data??[]).filter(c=>!legId||c.leg_id===legId).map(c=>({id:c.id,legId:c.leg_id,passengerId:c.passenger_id,passengerName:c.passenger?.first_name??'Member',period:c.period,amount:c.amount,status:c.status==='paid'?'confirmed':c.reported_at?'reported':'due',reportedAt:at(c.reported_at),confirmedAt:at(c.paid_at),note:c.report_note??undefined}))
 },
 async reportContribution(id,note){await pilotRpc('report_contribution',{p_id:id,p_note:note??null})},
 async confirmContribution(id){await pilotRpc('confirm_contribution',{p_id:id})},
 async listHistory(){return (await pilotRpc('get_commute_history')).map((h:J)=>({...h,departsAt:at(h.departsAt)}))},
 async setMatchAlert(enabled){const {data}=await sb().auth.getUser();if(!data.user)throw new ApiError('Sign in first','auth');const {error}=await sb().from('passenger_commutes').update({notify_on_match:enabled}).eq('passenger_id',data.user.id);if(error)throw new ApiError(error.message,'server')},
 async getAdminHealth(){return await pilotRpc('get_admin_health')},
 async suspendUser(userId,suspended,reason){await pilotRpc('suspend_account',{p_user:userId,p_suspended:suspended,p_reason:reason})},
}
