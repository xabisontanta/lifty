// Replay all migrations and seed in a separate disposable LOCAL database. Browser sandbox stays untouched.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { assertLocalDocker, assertSandboxDirectory, sandboxDirectory } from './sandbox-safety.mjs'
const dir = resolve(sandboxDirectory(), 'schema-replay')
const container = 'supabase_db_lifty-schema-replay'
assertSandboxDirectory(dir)
assertLocalDocker()
const migrations = resolve(dir,'supabase/migrations')
assertSandboxDirectory(migrations)
if (process.argv[2] === 'stop') {
  const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0]
  if(inspect?.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort!=='58322') throw new Error('Refusing to stop an unexpected database.')
  const result=spawnSync('npx --no-install supabase stop --workdir .local-stack/schema-replay --no-backup',{shell:true,encoding:'utf8'})
  console.log(result.stdout);if(result.stderr)console.error(result.stderr);process.exit(result.status??1)
}
if(spawnSync('docker',['inspect',container],{encoding:'utf8'}).status===0) throw new Error('A replay database already exists. Stop that exact disposable replay first; the browser sandbox is untouched.')
if(existsSync(migrations)) rmSync(migrations,{recursive:true,force:true})
mkdirSync(migrations,{recursive:true})
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')))cpSync(resolve('supabase/migrations',file),resolve(migrations,file))
let config=readFileSync('supabase/local-e2e/config.toml','utf8').replace('project_id = "lifty-e2e"','project_id = "lifty-schema-replay"').replaceAll('573','583')
writeFileSync(resolve(dir,'supabase/config.toml'),config)
writeFileSync(resolve(dir,'supabase/seed.sql'),`begin;update lifty_private.test_environment set mode='local' where id;set local lifty.nonproduction_seed='LOCAL_LIFTY_ONLY';${readFileSync('supabase/seed-test-drivers.sql','utf8')}select cron.alter_job(job_id:=jobid,active:=false) from cron.job;commit;`)
const result=spawnSync('npx --no-install supabase db start --workdir .local-stack/schema-replay',{shell:true,encoding:'utf8',maxBuffer:20*1024*1024})
console.log(result.stdout);if(result.stderr)console.error(result.stderr)
if(result.status!==0)process.exit(result.status??1)
const sql=query=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',maxBuffer:64*1024*1024})
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0]
if(inspect?.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort!=='58322')throw new Error('Fresh replay container does not have the expected local port.')
console.log(sql(`select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),'test_drivers',(select count(*) from public.profiles where is_test and role='driver'),'routes',(select count(*) from public.driver_legs),'reviews',(select count(*) from public.ratings),'schema_replay','local-only');`))
for(const test of ['test_driver_isolation.sql','test_driver_lifecycle.sql','test_driver_safety.sql']) {
 const source=readFileSync(resolve('supabase/tests',test),'utf8').replaceAll('__SAFE_CLEANUP_SQL__',()=>readFileSync('supabase/remove-test-drivers-local.sql','utf8'))
 const output=sql(source)
 console.log(output.split(/\r?\n/).filter(line=>line.includes('"suite"')).join('\n'))
}
