import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { importPKCS8, SignJWT } from 'npm:jose@6.2.12'

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
type Job={kind:'cleanup'|'push';id:string;lease:string;files?:{bucket:string;path:string}[];tokens?:{token:string;hash:string}[];title?:string;body?:string;link?:string}
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw new Error(error.message);return data}
async function accessToken(config:{client_email:string;private_key:string}){
 const key=await importPKCS8(config.private_key,'RS256')
 const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'}).setProtectedHeader({alg:'RS256'}).setIssuer(config.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key)
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new Error('Firebase authentication failed')
 return (await response.json()).access_token as string
}
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405})
 const token=request.headers.get('x-worker-token')
 if(!token || !await rpc('authorize_pilot_worker',{p_token:token}))return new Response('Unauthorized',{status:401})
 let firebase:{project_id:string;client_email:string;private_key:string}|null=null
 try{const raw=Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');if(raw)firebase=JSON.parse(raw)}catch{/* config is reported as unavailable */}
 const ready=!!(firebase?.project_id&&firebase?.client_email&&firebase?.private_key)
 const jobs:Job[]=await rpc('claim_pilot_work',{p_push_ready:ready})
 let bearer:string|undefined
 let completed=0,failed=0
 const deadline=Date.now()+50000
 for(const job of jobs){
  if(Date.now()>deadline)break
  try{
   if(job.kind==='cleanup'){
    const buckets=new Map<string,string[]>()
    for(const file of job.files??[])buckets.set(file.bucket,[...(buckets.get(file.bucket)??[]),file.path])
    for(const [bucket,paths] of buckets){for(let offset=0;offset<paths.length;offset+=100){const {error}=await db.storage.from(bucket).remove(paths.slice(offset,offset+100));if(error)throw new Error('Storage cleanup needs retry')}}
    await rpc('finalize_account_deletion',{p_job:job.id,p_lease:job.lease})
   }else{
    if(!ready)throw new Error('Firebase not configured')
    bearer??=await accessToken(firebase!)
    for(const destination of job.tokens??[]){
     const response=await fetch(`https://fcm.googleapis.com/v1/projects/${firebase!.project_id}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token:destination.token,notification:{title:job.title,body:job.body},data:{link:job.link??'/','notificationId':job.id},android:{priority:'high',ttl:'86400s',notification:{tag:job.id}}}}),signal:AbortSignal.timeout(15000)})
     const result=await response.json()
     if(!response.ok){
      if(result.error?.details?.some((d:{errorCode?:string})=>d.errorCode==='UNREGISTERED')){await db.from('push_tokens').delete().eq('token',destination.token);continue}
      throw new Error(`Firebase delivery failed (${response.status})`)
     }
     await rpc('record_push_receipt',{p_id:job.id,p_lease:job.lease,p_hash:destination.hash,p_provider:result.name})
    }
    await rpc('finish_pilot_work',{p_kind:'push',p_id:job.id,p_lease:job.lease,p_error:null})
   }
   completed++
  }catch(error){
   failed++
   await rpc('finish_pilot_work',{p_kind:job.kind,p_id:job.id,p_lease:job.lease,p_error:error instanceof Error?error.message:'Worker operation failed'})
  }
 }
 return Response.json({completed,failed,pushConfigured:ready})
})
