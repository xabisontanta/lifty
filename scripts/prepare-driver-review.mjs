// Two fake local passengers create real requests for the labelled manual driver.
// Does not delete accounts, auto-approve documents, reserve seats or send real SMS.
import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {assertLocalContainer,sandboxSql} from './sandbox-safety.mjs'

assertLocalContainer()
if(sandboxSql("select mode from lifty_private.test_environment where id")!=='local')throw new Error('Local test mode is required.')
const config=readFileSync('supabase/local-e2e/config.toml','utf8')
const phones=['27820000001','27820000003']
if(phones.some(phone=>!config.includes(`${phone} = "123456"`)))throw new Error('Fixed local OTP identities are missing.')
const output=execSync('npx --no-install supabase status --workdir .local-stack -o env',{encoding:'utf8',stdio:['ignore','pipe','ignore']})
const anon=output.split(/\r?\n/).find(line=>line.startsWith('ANON_KEY='))?.slice(9).replace(/^"|"$/g,'')
if(!anon)throw new Error('Start the fixed local Supabase stack first.')
const driver='e0000000-0000-4000-8000-000000000101'
sandboxSql(`select public.configure_test_driver('${driver}',false,5,0);`)
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const checked=({data,error})=>{if(error)throw new Error(error.message);return data}
for(const [index,phone]of phones.entries()){
  const client=createClient('http://127.0.0.1:57330',anon,{auth:{persistSession:false,autoRefreshToken:false}})
  checked(await client.auth.signInWithOtp({phone:`+${phone}`,options:{channel:'sms',data:{full_name:`Preview${index+1} Passenger`,role:'passenger',terms_accepted:true}}}))
  const auth=checked(await client.auth.verifyOtp({phone:`+${phone}`,token:'123456',type:'sms'}))
  checked(await client.rpc('bootstrap_account',{p_full_name:`Preview${index+1} Passenger`,p_role:'passenger'}))
  const existing=checked(await client.from('join_requests').select('id,status').eq('passenger_id',auth.user.id).eq('leg_id','e0000000-0000-4000-8000-000000001011').in('status',['pending','accepted']).limit(1))
  if(existing.length){console.log(`Local passenger ${phone}: existing ${existing[0].status} request ${existing[0].id}`);continue}
  const commute=checked(await client.from('passenger_commutes').upsert({passenger_id:auth.user.id,direction:'to_work',origin_label:'Salt Rock Main Road',origin:'SRID=4326;POINT(31.234003 -29.488331)',destination_label:'Umhlanga Ridge',destination:'SRID=4326;POINT(31.076244 -29.739187)',days:[0,1,2,3,4],arrive_by:'08:00',window_min:30,max_walk_m:750,start_date:today,skip_holidays:true},{onConflict:'passenger_id,direction'}).select('id').single())
  checked(await client.from('profile_private').update({terms_accepted_at:new Date().toISOString(),low_data_mode:true}).eq('id',auth.user.id))
  checked(await client.rpc('complete_onboarding'))
  const offers=checked(await client.functions.invoke('find-matches',{body:{commuteId:commute.id}}))
  const offer=offers.matches?.find(match=>match.driver.id===driver)
  if(!offer?.quoteId)throw new Error('Manual test driver has no compatible current road quote. Check availability without weakening matching rules.')
  const request=checked(await client.rpc('request_to_join_quote',{p_commute:commute.id,p_leg:offer.legId,p_quote:offer.quoteId}))
  console.log(`Local passenger ${phone}: pending request ${request}`)
}
console.log('Sign in at http://127.0.0.1:5180/signin as 0820000101, code 123456, then open Requests. Local fixtures only.')
