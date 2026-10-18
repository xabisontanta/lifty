import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import assert from 'node:assert/strict'
import { sandboxSql, assertLocalContainer } from './sandbox-safety.mjs'

const output = sandboxSql(readFileSync('supabase/tests/vehicle_illustrations.sql', 'utf8'))
const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.includes('"suite": "vehicle-illustrations"'))
if (!line) throw new Error('Vehicle illustration assertions did not return a summary.')
const summary = JSON.parse(line)
if (summary.failed !== 0 || summary.passed < 40) throw new Error('Vehicle illustration verification was incomplete.')
console.log(JSON.stringify(summary))

// Independent database connections prove that first-cache-row claims are atomic.
// Only freshly allocated fixture UUIDs are removed; no real/test-preview accounts
// or current vehicle data are reset by this suite.
assertLocalContainer()
const database = { host: '127.0.0.1', port: 57322, user: 'postgres', password: 'postgres', database: 'postgres' }
const control = new pg.Client(database)
const users = [randomUUID(), randomUUID(), randomUUID()], reference = randomUUID()
const model = `race ${randomUUID()}`
const vehicle = { make: 'lifty qa', model, year: 2022, colour: 'silver', bodyType: 'hatchback' }
const workers = []
await control.connect()
try {
  await control.query('begin')
  for (const user of users) {
    await control.query("insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,'authenticated','authenticated','{}','{}',now(),now())", [user])
    await control.query("insert into public.profiles(id,role,first_name,onboarding_completed_at) values($1,'driver','Vehicle claim race',now())", [user])
    await control.query("insert into public.vehicles(driver_id,make,model,year,colour,body_type,registration_summary,seats_total) values($1,'lifty qa',$2,2022,'silver','hatchback','QA',3)", [user, model])
  }
  await control.query("insert into lifty_private.vehicle_illustration_references(id,make,model,model_year,body_type,storage_path,source_url,rights_confirmed,reviewed_at,active) values($1,'lifty qa',$2,2022,'hatchback','qa/ref.png','https://local.invalid/qa-only',true,now(),true)", [reference, model])
  await control.query('commit')
  const results = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
    const client = new pg.Client(database)
    workers.push(client)
    await client.connect()
    const result = await client.query('select public.claim_vehicle_illustration($1,$2::jsonb,true,true) result', [users[i % users.length], JSON.stringify(vehicle)])
    return result.rows[0].result
  }))
  assert.equal(results.filter(r => r.status === 'claimed').length, 1, 'exactly one concurrent request owns the generation lease')
  assert.equal(results.filter(r => r.status === 'processing').length, 5, 'other concurrent requests share the in-flight result')
  const usage = await control.query('select sum(attempts)::int attempts from lifty_private.vehicle_illustration_usage where user_id=any($1::uuid[])', [users])
  assert.equal(usage.rows[0].attempts, 1, 'one generation claim consumes one quota attempt across accounts')
  console.log(JSON.stringify({ suite: 'vehicle-illustration-concurrency', passed: 3, failed: 0 }))
} finally {
  await Promise.allSettled(workers.map(client => client.end()))
  await control.query('rollback')
  await control.query('begin')
  await control.query('delete from lifty_private.vehicle_illustration_references where id=$1', [reference])
  await control.query('delete from auth.users where id=any($1::uuid[])', [users])
  await control.query('commit')
  await control.end()
}
