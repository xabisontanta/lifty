import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { importPKCS8, SignJWT } from 'npm:jose@6.2.12'
import { handle } from './handler.ts'

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw new Error(error.message);return data}
async function accessToken(config:{client_email:string;private_key:string}){
 const key=await importPKCS8(config.private_key,'RS256')
 const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'}).setProtectedHeader({alg:'RS256'}).setIssuer(config.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key)
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new Error('Firebase authentication failed')
 return (await response.json()).access_token as string
}
Deno.serve(request => handle(request, {
 env: name => Deno.env.get(name), rpc, accessToken, fetch,
 removeFiles: async (bucket, paths) => { const {error}=await db.storage.from(bucket).remove(paths);if(error)throw new Error('Storage cleanup needs retry') },
 deleteToken: async token => { await db.from('push_tokens').delete().eq('token',token) },
}))
