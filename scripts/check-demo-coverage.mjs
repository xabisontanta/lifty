// Checks that realistic searches return lifts in every metro the demo seed covers — through the real pipeline:
// SQL pre-filter (match_candidates) → real road routing (Mapbox) → the shared engine (same code as the Edge Function).
// Runs against the LOCAL sandbox only (it creates and removes temporary commutes for the sandbox test passenger).
//   node scripts/local-stack.mjs up   then   node scripts/check-demo-coverage.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { scoreCandidates } from '../supabase/functions/find-matches/core.ts'
import { mapboxRouter } from '../supabase/functions/find-matches/handler.ts'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const router = mapboxRouter(env.VITE_MAPBOX_TOKEN, null)
const psql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_lifty-e2e', 'psql', '-U', 'postgres', '-At', '-c', q], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const me = psql("select id from auth.users where phone = '27820000001'")
if (!me) throw new Error('Run the end-to-end suite once first: it creates the sandbox test passenger.')

// [name, direction, origin(lng,lat,label), destination, arriveBy, expectation]
const S = [
  ['Ballito → Umhlanga Ridge', 'to_work', [31.2117, -29.5353, 'Ballito'], [31.0762, -29.7392, 'Umhlanga Ridge'], '08:00', 'results'],
  ['Umhlanga Ridge → Ballito (evening)', 'to_home', [31.0762, -29.7392, 'Umhlanga Ridge'], [31.2117, -29.5353, 'Ballito'], '17:00', 'results'],
  ['La Lucia → Durban CBD', 'to_work', [31.0773, -29.7448, 'La Lucia'], [31.0218, -29.8587, 'Durban CBD'], '08:00', 'results'],
  ['Durban North → Durban CBD', 'to_work', [31.0206, -29.7937, 'Durban North'], [31.0218, -29.8587, 'Durban CBD'], '08:00', 'results'],
  ['Centurion → Sandton', 'to_work', [28.188, -25.86, 'Centurion'], [28.0567, -26.1076, 'Sandton'], '08:00', 'results'],
  ['Midrand → Sandton', 'to_work', [28.1079, -25.9987, 'Midrand'], [28.0567, -26.1076, 'Sandton'], '08:00', 'results'],
  ['Durbanville → Cape Town CBD', 'to_work', [18.65, -33.833, 'Durbanville'], [18.4241, -33.9249, 'Cape Town CBD'], '08:00', 'results'],
  ['Century City → Cape Town CBD', 'to_work', [18.511, -33.893, 'Century City'], [18.4241, -33.9249, 'Cape Town CBD'], '08:30', 'results'],
  ['Gqeberha → Gqeberha CBD (no drivers there)', 'to_work', [25.6, -33.96, 'Gqeberha'], [25.62, -33.92, 'Gqeberha CBD'], '08:00', 'empty'],
]
const pt = (p) => `st_setsrid(st_makepoint(${p[0]}, ${p[1]}), 4326)::geography`
let failures = 0
try {
  for (const [name, direction, o, d, arriveBy, expect] of S) {
    const id = psql(`insert into public.passenger_commutes (passenger_id, direction, origin_label, origin, destination_label, destination, days, arrive_by, window_min, max_walk_m, start_date, skip_holidays)
      values ('${me}', '${direction}', '${o[2]}', ${pt(o)}, '${d[2]}', ${pt(d)}, '{0,1,2,3,4}', '${arriveBy}', 15, 750, current_date + 1, true)
      on conflict (passenger_id, direction) do update set origin_label = excluded.origin_label, origin = excluded.origin, destination_label = excluded.destination_label, destination = excluded.destination, arrive_by = excluded.arrive_by
      returning id`).split('\n')[0]
    const payload = JSON.parse(psql(`select public.match_candidates('${id}', '${me}')::text`))
    const run = await scoreCandidates(payload, router, (m) => console.log('   · ' + m))
    const ok = expect === 'results' ? run.matches.length > 0 : run.matches.length === 0
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${payload.candidates.length} candidate(s) → ${run.matches.length} match(es)` + (run.matches.length ? `  best ${run.matches[0].compatibility}% ${run.matches[0].driver.firstName}` : run.rejected.length ? `  rejected: ${run.rejected.map((r) => r.reason).join(', ')}` : ''))
  }
} finally {
  psql(`delete from public.passenger_commutes where passenger_id = '${me}' and origin_label in ('Ballito','Umhlanga Ridge','La Lucia','Durban North','Centurion','Midrand','Durbanville','Century City','Gqeberha') and destination_label in ('Umhlanga Ridge','Ballito','Durban CBD','Sandton','Cape Town CBD','Gqeberha CBD')`)
}
process.exit(failures ? 1 : 0)
