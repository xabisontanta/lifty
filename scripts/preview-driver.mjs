// Production-format browser preview, connected only to the fixed local Lifty sandbox.
import { execSync, spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { assertLocalContainer, assertLoopbackUrl, assertSandboxDirectory } from './sandbox-safety.mjs'

assertLocalContainer()
const directory=resolve('.local-stack/driver-review')
assertSandboxDirectory(directory)
const output=execSync('npx --no-install supabase status --workdir .local-stack -o env',{encoding:'utf8',stdio:['ignore','pipe','ignore']})
const local=Object.fromEntries(output.split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{
  const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')]
}))
if(assertLoopbackUrl(local.API_URL).port!=='57321'||!local.ANON_KEY)throw new Error('Start the fixed Lifty local sandbox first.')
const gateway='http://127.0.0.1:57330'
const health=await fetch(`${gateway}/auth/v1/health`).catch(()=>null)
if(!health?.ok)throw new Error('Start npm run stack:gateway before the driver preview.')
const cli=resolve('node_modules/vite/bin/vite.js')
const build=spawnSync(process.execPath,[cli,'build','--outDir',directory,'--emptyOutDir'],{
  stdio:'inherit',env:{...process.env,VITE_SUPABASE_URL:gateway,VITE_SUPABASE_ANON_KEY:local.ANON_KEY},
})
if(build.status!==0)process.exit(build.status??1)
const server=spawn(process.execPath,[cli,'preview','--host','127.0.0.1','--port','5180','--strictPort','--outDir',directory],{stdio:'inherit'})
server.on('exit',code=>process.exit(code??1))
server.on('error',error=>{console.error(error.message);process.exitCode=1})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill(signal))
console.log('Local driver review: http://127.0.0.1:5180/signin (fixed sandbox only; no hosted deployment).')
