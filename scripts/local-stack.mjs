// Local end-to-end sandbox: a throwaway Supabase (Postgres + Auth + REST + Realtime + Storage) in Docker, built from the REAL
// migrations and seeds, with fake phone numbers whose OTP codes are fixed in supabase/local-e2e/config.toml (no SMS is ever sent,
// no live data is touched).
//   node scripts/local-stack.mjs up        stage migrations/seeds/config into .local-stack/ and start the containers
//   node scripts/local-stack.mjs down      stop and remove them
//   node scripts/local-stack.mjs env       print the VITE_ settings that point the app at the sandbox
//   node scripts/local-stack.mjs gateway   serve the find-matches function + proxy (keep running while testing)
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const DIR = process.env.LIFTY_STACK_DIR ?? '.local-stack'
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 57330)
const run = (args, opts = {}) => spawnSync(`npx --no-install supabase ${args}`, { stdio: 'inherit', shell: true, ...opts })

function stage() {
  rmSync(`${DIR}/supabase/migrations`, { recursive: true, force: true })
  mkdirSync(`${DIR}/supabase/migrations`, { recursive: true })
  cpSync('supabase/local-e2e/config.toml', `${DIR}/supabase/config.toml`)
  for (const f of readdirSync('supabase/migrations')) if (f.endsWith('.sql')) cpSync(`supabase/migrations/${f}`, `${DIR}/supabase/migrations/${f}`)
  rmSync(`${DIR}/supabase/functions`, { recursive: true, force: true })
  cpSync('supabase/functions', `${DIR}/supabase/functions`, { recursive: true })
  // seeds: the original demo data, then the realistic mock lifts
  const seeds = ['supabase/seed.sql', 'supabase/seed-demo-lifts.sql'].filter(existsSync).map((f) => readFileSync(f, 'utf8'))
  writeFileSync(`${DIR}/supabase/seed.sql`, seeds.join('\n\n'))
}

const cmd = process.argv[2]
if (cmd === 'up') {
  stage()
  process.exit(run(`start --workdir ${DIR}`).status ?? 1)
} else if (cmd === 'down') {
  process.exit(run(`stop --workdir ${DIR} --no-backup`).status ?? 1)
} else if (cmd === 'env') {
  const out = spawnSync(`npx --no-install supabase status --workdir ${DIR} -o env`, { shell: true, encoding: 'utf8' }).stdout
  const get = (k) => out.split(/\r?\n/).find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).replace(/^"|"$/g, '')
  console.log(`VITE_SUPABASE_URL=http://127.0.0.1:${GATEWAY_PORT}`)
  console.log(`VITE_SUPABASE_ANON_KEY=${get('ANON_KEY')}`)
} else if (cmd === 'gateway') {
  await import('./local-gateway.mjs')
} else {
  console.error('usage: node scripts/local-stack.mjs up | down | env | gateway')
  process.exit(2)
}
