// Fixed, loopback-only Supabase sandbox. Never accepts a hosted target or arbitrary directory.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertSandboxDirectory, sandboxDirectory, assertLocalContainer, assertLocalDocker } from './sandbox-safety.mjs'
const DIR = sandboxDirectory()
const cmd = process.argv[2]
const run = (args) => {
  const r = spawnSync('npx --no-install supabase ' + args.join(' '), { shell: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  console.log((r.stdout ?? '').split(/\r?\n/).filter(line => !/service.?role|secret.?key|anon.?key|publishable.?key|JWT.?secret|S3.?access|S3.?secret/i.test(line)).join('\n'))
  if (r.stderr) console.error(r.stderr)
  return r
}
export function stageSandbox() {
  assertLocalDocker()
  assertSandboxDirectory(DIR)
  const migrationDir = resolve(DIR, 'supabase/migrations'), functionsDir = resolve(DIR, 'supabase/functions')
  assertSandboxDirectory(migrationDir); assertSandboxDirectory(functionsDir)
  rmSync(migrationDir, { recursive: true, force: true }); mkdirSync(migrationDir, { recursive: true })
  cpSync('supabase/local-e2e/config.toml', resolve(DIR, 'supabase/config.toml'))
  for (const f of readdirSync('supabase/migrations')) if (f.endsWith('.sql')) cpSync(`supabase/migrations/${f}`, resolve(migrationDir, f))
  rmSync(functionsDir, { recursive: true, force: true }); cpSync('supabase/functions', functionsDir, { recursive: true })
  const seedFiles = ['supabase/seed-test-drivers.sql']
  if (seedFiles.some(f => !existsSync(f))) throw new Error('The reviewed test-driver seed is missing; legacy demo seeds are never used automatically.')
  const seeds = seedFiles.map(f => readFileSync(f, 'utf8')).join('\n\n')
  writeFileSync(resolve(DIR, 'supabase/seed.sql'), `begin;\nupdate lifty_private.test_environment set mode='local' where id;\nset local lifty.nonproduction_seed = 'LOCAL_LIFTY_ONLY';\n${seeds}\n-- Local fixtures must never invoke hosted workers.\nselect cron.alter_job(job_id:=jobid, active:=false) from cron.job;\ncommit;\n`)
}
if (cmd === 'up') { stageSandbox(); process.exit(run(['start', '--workdir', '.local-stack']).status ?? 1) }
else if (cmd === 'down') { assertLocalContainer(); process.exit(run(['stop', '--workdir', '.local-stack', '--no-backup']).status ?? 1) }
else if (cmd === 'env') {
  const out = spawnSync('npx --no-install supabase status --workdir .local-stack -o env', { shell: true, encoding: 'utf8' }).stdout
  const get = k => out.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).replace(/^"|"$/g, '')
  if (!get('ANON_KEY')) throw new Error('Sandbox is not running.')
  console.log('VITE_SUPABASE_URL=http://127.0.0.1:57330'); console.log(`VITE_SUPABASE_ANON_KEY=${get('ANON_KEY')}`)
} else if (cmd === 'gateway') await import('./local-gateway.mjs')
else { console.error('usage: node scripts/local-stack.mjs up | down | env | gateway'); process.exit(2) }

