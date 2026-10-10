import pg from 'pg'
import {readFileSync} from 'node:fs'
import { assertTestDatabase } from './test-database-target.mjs'
const connectionString=process.env.LIFTY_TEST_DATABASE_URL
if(!connectionString){console.error('Set LIFTY_TEST_DATABASE_URL to the local Lifty sandbox on port 57322. No database was changed.');process.exit(1)}
assertTestDatabase(connectionString)
const client=new pg.Client({connectionString})
try {
  await client.connect()
  const results = await client.query(readFileSync('supabase/tests/pilot.sql', 'utf8'))
  const summary = (Array.isArray(results) ? results : [results])
    .flatMap(result => result.rows ?? []).find(row => row.result?.suite === 'reliable-pilot')?.result
  if (!summary || summary.failed !== 0 || summary.passed < 56) throw new Error('Missing complete backend assertion result.')
  console.log(`Pilot backend: ${summary.passed} checks passed, ${summary.failed} failed; synthetic fixtures rolled back.`)
} catch(error) {
  console.error(error.message)
  process.exitCode=1
} finally {
  await client.query('rollback').catch(()=>{})
  await client.end()
}
