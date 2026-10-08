import pg from 'pg'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const connectionString = process.env.LIFTY_TEST_DATABASE_URL
if (!connectionString) {
  console.error('Set LIFTY_TEST_DATABASE_URL to an authorized PostgreSQL test connection. No database was changed.')
  process.exit(1)
}

const owner = new pg.Client({ connectionString, application_name: 'lifty-race-fixture' })
const racers = [0, 1].map(index => new pg.Client({ connectionString, application_name: `lifty-race-${index}` }))
let fixture
let running = []
try {
  await owner.connect()
  await Promise.all(racers.map(client => client.connect()))
  const setup = await owner.query(readFileSync('supabase/tests/concurrency-setup.sql', 'utf8'))
  fixture = (Array.isArray(setup) ? setup : [setup]).flatMap(result => result.rows ?? []).find(row => row.fixture)?.fixture
  assert.ok(fixture?.driver && fixture.passengers?.length === 2 && fixture.requests?.length === 2, 'Fixture setup did not return three generated accounts and two requests.')
  assert.equal(new Set([fixture.driver, ...fixture.passengers]).size, 3)

  // Hold the leg row until both requests actually wait for the same final seat.
  // This makes the test exercise lock contention, even on a very fast local DB.
  await owner.query('begin')
  await owner.query('select id from public.driver_legs where id=$1 for update', [fixture.leg])
  await Promise.all(racers.map(async client => {
    await client.query('begin')
    await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [fixture.driver, JSON.stringify({ sub: fixture.driver, role: 'authenticated' })])
  }))
  const pids = await Promise.all(racers.map(async client => (await client.query('select pg_backend_pid() as pid')).rows[0].pid))
  running = racers.map(async (client, index) => {
    try {
      await client.query('select public.respond_to_request($1,true)', [fixture.requests[index]])
      await client.query('commit')
      return { accepted: true }
    } catch (error) {
      await client.query('rollback')
      return { accepted: false, message: error.message }
    }
  })
  let waiting = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    waiting = Number((await owner.query("select count(*) from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [pids])).rows[0].count)
    if (waiting === 2) break
    await delay(50)
  }
  await owner.query('commit')
  const outcomes = await Promise.all(running)
  assert.equal(waiting, 2, 'Both contenders must block on the same leg before release.')
  assert.equal(outcomes.filter(result => result.accepted).length, 1, 'Exactly one request must acquire the final seat.')
  assert.match(outcomes.find(result => !result.accepted).message, /no open seats/i)
  const counts = (await owner.query(`select
    (select count(*)::int from public.club_members where leg_id=$1 and active) as members,
    (select seats_open from public.driver_legs where id=$1) as seats,
    (select count(*)::int from public.join_requests where id=any($2::uuid[]) and status='accepted') as accepted`, [fixture.leg, fixture.requests])).rows[0]
  assert.deepEqual(counts, { members: 1, seats: 0, accepted: 1 })
  console.log('Final-seat race passed: two lock contenders, one accepted request, one active member, zero open seats.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await owner.query('rollback').catch(() => {})
  await Promise.allSettled(running)
  await Promise.all(racers.map(async client => {
    await client.query('rollback').catch(() => {})
    await client.end().catch(() => {})
  }))
  if (fixture) {
    try {
      const ids = [fixture.driver, ...fixture.passengers]
      const owned = (await owner.query("select u.id from auth.users u join public.profiles p on p.id=u.id where u.id=any($1::uuid[]) and u.email='pilot-race-'||u.id||'@example.invalid' and p.is_demo", [ids])).rows
      assert.equal(owned.length, 3, 'Cleanup provenance failed; generated IDs retained for manual review.')
      await owner.query('delete from auth.users where id=any($1::uuid[])', [ids])
      assert.equal(Number((await owner.query('select count(*) from auth.users where id=any($1::uuid[])', [ids])).rows[0].count), 0)
      console.log('All three synthetic fixture accounts and their cascaded records were removed.')
    } catch (error) {
      console.error(`Fixture cleanup failed: ${error.message}. Generated accounts: ${JSON.stringify([fixture.driver, ...fixture.passengers])}`)
      process.exitCode = 1
    }
  }
  await owner.end().catch(() => {})
}
