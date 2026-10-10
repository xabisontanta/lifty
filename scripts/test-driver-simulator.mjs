// Local server process: same booking, private Realtime feed and trip-status APIs as real users.
import { sandboxSql } from './sandbox-safety.mjs'
import { setTimeout as sleep } from 'node:timers/promises'
const [command, value, extra] = process.argv.slice(2)
const uuid = value && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value) ? value : null
if (command === 'start-trip') {
  if (!uuid) throw new Error('Pass the accepted test request UUID, not a real account or trip.')
  const duration = extra ? Number(extra) : 90
  if (!Number.isInteger(duration) || duration < 30 || duration > 3600) throw new Error('Duration must be 30–3600 seconds.')
  console.log(sandboxSql(`select public.begin_test_trip('${uuid}',${duration});`))
} else if (command === 'manual' || command === 'automatic') {
  if (!uuid) throw new Error('Pass a labelled test driver UUID.')
  console.log(sandboxSql(`select public.configure_test_driver('${uuid}',${command === 'automatic'},5,0);`))
} else if (command === 'decline') {
  if (!uuid) throw new Error('Pass a labelled test driver UUID.')
  const percent = extra ? Number(extra) : 100
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Decline percentage must be 0–100.')
  console.log(sandboxSql(`select public.configure_test_driver('${uuid}',true,5,${percent});`))
} else if (command === 'tick') console.log(sandboxSql('select public.advance_test_simulation();'))
else if (command === 'run' || !command) {
  console.log('Local test simulator running. Requests use normal validation; location broadcasts use the real authorized per-rider channels.')
  for (;;) {
    // One failed tick (a deadlock with a real request, a hiccup in Docker) must not end the simulator: say so and carry on.
    try {
      const result = JSON.parse(sandboxSql('select public.advance_test_simulation();'))
      if (result.disabled) throw new Error('Test fixtures are disabled; no simulated action was taken.')
      if (result.responses || result.completed) console.log(JSON.stringify(result))
    } catch (error) {
      if (error instanceof Error && /fixtures are disabled/.test(error.message)) throw error
      console.error(`tick failed, retrying: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`)
    }
    await sleep(2000)
  }
} else throw new Error('Usage: run | tick | start-trip <accepted-request> [seconds] | manual <test-driver> | automatic <test-driver> | decline <test-driver> [percent]')
