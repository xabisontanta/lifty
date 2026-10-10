// Real PostGIS filters + actual Mapbox walking/driving measurements. Local container only.
import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'
import { scoreCandidates } from '../supabase/functions/find-matches/core.ts'
import { mapboxRouter } from '../supabase/functions/find-matches/handler.ts'
const localToken = readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith('VITE_MAPBOX_TOKEN='))?.slice('VITE_MAPBOX_TOKEN='.length).trim()
const router = mapboxRouter(process.env.MAPBOX_TOKEN || localToken, null)
const scenarios = [
  ['Salt Rock → Umhlanga by 08:00', [31.234003, -29.488331], [31.076244, -29.739187], '08:00', true],
  ['Ballito → Umhlanga by 08:00', [31.211652, -29.535325], [31.076244, -29.739187], '08:00', true],
  ['Salt Rock → King Shaka by 08:00', [31.234003, -29.488331], [31.118457, -29.616021], '08:00', true],
  ['Remote destination with no driver corridor', [31.234003, -29.488331], [18.4241, -33.9249], '08:00', false],
]
const pt = ([lng, lat]) => `extensions.st_setsrid(extensions.st_makepoint(${lng},${lat}),4326)::extensions.geography`
let fails = 0
for (const [name, origin, destination, arriveBy, expected] of scenarios) {
  // Each SQL invocation rolls back the temporary real commute and profiles; no cleanup DELETE is needed.
  const raw = sandboxSql(`begin;do $$ declare u uuid:=gen_random_uuid();c uuid;begin
    insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
    insert into public.profiles(id,role,first_name,last_initial) values(u,'passenger','Coverage','T');
    insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,window_min,max_walk_m,start_date) values(u,'to_work','Coverage origin',${pt(origin)},'Coverage destination',${pt(destination)},'{0,1,2,3,4}','${arriveBy}',15,750,(now() at time zone 'Africa/Johannesburg')::date+1) returning id into c;
    perform set_config('lifty.coverage_payload',public.match_candidates(c,u)::text,true);
  end $$;select current_setting('lifty.coverage_payload');rollback;`)
  const payload = JSON.parse(raw.split(/\r?\n/).find(l => l.startsWith('{')))
  const result = await scoreCandidates(payload, router)
  const okay = expected ? result.matches.length > 0 : result.matches.length === 0
  if (!okay) fails++
  console.log(JSON.stringify({ scenario: name, passed: okay, candidates: payload.candidates.length, matches: result.matches.map(m => ({ driver: m.driver.firstName, isTest: m.driver.isTest, partial: m.partial, walk: m.walkingDistanceM, arrival: m.arrivalEta, score: m.compatibility })), rejected: result.rejected }))
}
if (fails) process.exitCode = 1
