import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { assertTestDatabase } from './test-database-target.mjs'

const connectionString = process.env.LIFTY_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:57322/postgres'
assertTestDatabase(connectionString)
const owner = new pg.Client({ connectionString, application_name: 'lifty-chat-race-fixture' })
const senders = [0, 1].map(index => new pg.Client({ connectionString, application_name: `lifty-chat-race-sender-${index}` }))
const reader = new pg.Client({ connectionString, application_name: 'lifty-chat-race-reader' })
const ids = [randomUUID(), randomUUID(), randomUUID()]
const [driver, passenger, readingPassenger] = ids
const leg = randomUUID(), messageA = randomUUID(), messageB = randomUUID(), retryMessage = randomUUID()
let committedFixture = false
const pendingQueries = []
let assertions = 0
const check = (ok, label) => { assert.ok(ok, label); assertions++ }
async function asAccount(client, id) {
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, role: 'authenticated' })])
}
async function waitForAdvisoryLock(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = (await owner.query("select wait_event_type,wait_event from pg_stat_activity where pid=$1", [pid])).rows[0]
    if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') return true
    await delay(20)
  }
  return false
}
async function unread() {
  const row = (await reader.query('select j from public.list_chat_summaries()j where j->>\'legId\'=$1', [leg])).rows[0]
  return Number(row?.j?.unreadCount)
}

try {
  await owner.connect()
  await Promise.all([...senders, reader].map(client => client.connect()))
  await owner.query('begin')
  check((await owner.query("select mode='local' as local from lifty_private.test_environment where id")).rows[0]?.local, 'Only explicitly enabled local fixture mode is allowed.')
  for (const [index, id] of ids.entries()) {
    await owner.query(`insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'authenticated','authenticated',$2,'{"provider":"email"}','{}',now(),now())`, [id, `pilot-chat-race-${id}@example.invalid`])
    await owner.query("insert into public.profiles(id,role,first_name,last_initial,is_demo) values($1,$2,'Chat race','T',true)", [id, index === 0 ? 'driver' : 'passenger'])
    await owner.query('insert into public.profile_private(id,terms_accepted_at) values($1,now())', [id])
  }
  await owner.query("insert into public.vehicles(driver_id,make,model,year,colour,registration_summary,seats_total,status) values($1,'Test','Chat race',2024,'Blue','ND CHAT 123',4,'verified')", [driver])
  await owner.query(`insert into public.verification_documents(user_id,kind,storage_path,status,expires_on)
    select $1::uuid,k::public.doc_kind,$1::text||'/'||k||'.pdf','verified',current_date+30 from unnest(array['id','licence','vehicle_registration','insurance'])k`, [driver])
  const copied = await owner.query(`insert into public.driver_legs(id,driver_id,direction,origin_label,origin,destination_label,destination,route,route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution)
    select $1,$2,'to_work','Chat start',origin,'Chat destination',destination,route,route_distance_m,route_duration_s,'07:00','{0,1,2,3,4,5,6}',2,8,100
    from public.driver_legs where id='e0000000-0000-4000-8000-000000001011'`, [leg, driver])
  check(copied.rowCount === 1, 'Fixed local seed route is available.')
  for (const id of ids.slice(1)) {
    await owner.query(`insert into public.club_members(leg_id,passenger_id,pickup_label,pickup,pickup_time,monthly_contribution,start_date,agreement)
      select id,$2,'Chat pickup',origin,'07:10',100,current_date+1,
      jsonb_build_object('scheduleMode','weekly','days',jsonb_build_array(0,1,2,3,4,5,6),'startDate',current_date+1,'monthlyContribution',100)
      from public.driver_legs where id=$1`, [leg, id])
  }
  await owner.query('commit')
  committedFixture = true

  // A has allocated a sequence but has not committed. B must wait before it can
  // allocate its own sequence; its INSERT cannot overtake A's commit.
  await asAccount(senders[0], driver)
  await senders[0].query('select public.send_club_message($1,$2,$3)', [leg, messageA, 'First committed message'])
  await asAccount(senders[1], passenger)
  const pidB = (await senders[1].query('select pg_backend_pid() as pid')).rows[0].pid
  const sendB = senders[1].query('select public.send_club_message($1,$2,$3)', [leg, messageB, 'Second committed message'])
  void sendB.catch(() => {}) // Await below; keep early failures inside finally cleanup.
  pendingQueries.push(sendB)
  check(await waitForAdvisoryLock(pidB), 'Concurrent second send waits on the per-club advisory lock.')
  await senders[0].query('commit')
  await sendB

  await asAccount(reader, readingPassenger)
  check(await unread() === 1, 'Reader sees only the committed first message.')
  await reader.query('select public.mark_club_read($1,$2)', [leg, messageA])
  check(await unread() === 0, 'Read cursor covers the visible first commit only.')
  await reader.query('commit')
  await senders[1].query('commit')
  await asAccount(reader, readingPassenger)
  check(await unread() === 1, 'Later second commit becomes unread after the first read acknowledgement.')
  await reader.query('select public.mark_club_read($1,$2)', [leg, messageB])
  check(await unread() === 0, 'Acknowledging the second message clears unread state.')
  await reader.query('commit')
  const sequenceRows = (await owner.query('select id,message_seq from public.messages where id=any($1::uuid[]) order by message_seq', [[messageA, messageB]])).rows
  check(sequenceRows.length === 2 && sequenceRows[0].id === messageA && sequenceRows[1].id === messageB, 'Server sequences agree with serialised commit order.')

  // Two calls with the same user/id/body race while the first transaction is
  // uncommitted. Both succeed, but only one INSERT/notification fan-out exists.
  await asAccount(senders[0], driver)
  await asAccount(senders[1], driver)
  await senders[0].query('select public.send_club_message($1,$2,$3)', [leg, retryMessage, 'A retry keeps the identifier'])
  const retry = senders[1].query('select public.send_club_message($1,$2,$3)', [leg, retryMessage, 'A retry keeps the identifier'])
  void retry.catch(() => {})
  pendingQueries.push(retry)
  check(await waitForAdvisoryLock(pidB), 'Concurrent retry waits for the original send commit.')
  await senders[0].query('commit')
  await retry
  await senders[1].query('commit')
  check(Number((await owner.query('select count(*) from public.messages where id=$1', [retryMessage])).rows[0].count) === 1, 'Concurrent UUID retry stores exactly one message.')
  check(Number((await owner.query('select count(*) from public.notifications where source_message_id=$1', [retryMessage])).rows[0].count) === 2, 'Concurrent UUID retry produces exactly one notification per other member.')
  check(Number((await owner.query('select count(*) from public.notifications where source_message_id=$1 and is_test', [retryMessage])).rows[0].count) === 2, 'Fixture chat notifications retain the nonproduction boundary.')
  await asAccount(senders[0], driver)
  await assert.rejects(senders[0].query('select public.send_club_message($1,$2,$3)', [leg, retryMessage, 'Different content']), /identifier is already in use/)
  assertions++
  await senders[0].query('rollback')
  console.log(JSON.stringify({ suite: 'chat-concurrency', passed: assertions, failed: 0, fixtures: 'synthetic accounts removed in finally' }))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  // Release either contender before awaiting pending work, including on failures.
  await Promise.all([...senders, reader].map(client => client.query('rollback').catch(() => {})))
  await Promise.allSettled(pendingQueries)
  await Promise.all([...senders, reader].map(client => client.end().catch(() => {})))
  await owner.query('rollback').catch(() => {})
  if (committedFixture) {
    try {
      const owned = (await owner.query("select u.id from auth.users u join public.profiles p on p.id=u.id where u.id=any($1::uuid[]) and u.email='pilot-chat-race-'||u.id||'@example.invalid' and p.is_test", [ids])).rows
      assert.equal(owned.length, ids.length, 'Cleanup provenance did not match all generated chat fixture accounts.')
      await owner.query('delete from auth.users where id=any($1::uuid[])', [ids])
      assert.equal(Number((await owner.query('select count(*) from auth.users where id=any($1::uuid[])', [ids])).rows[0].count), 0)
      assert.equal(Number((await owner.query('select count(*) from public.driver_legs where id=$1', [leg])).rows[0].count), 0)
      console.log('Chat race fixture cleanup verified: three generated accounts and their club removed.')
    } catch (error) {
      console.error(`Chat race cleanup failed: ${error.message}. Generated fixture IDs: ${JSON.stringify(ids)}`)
      process.exitCode = 1
    }
  }
  await owner.end().catch(() => {})
}
