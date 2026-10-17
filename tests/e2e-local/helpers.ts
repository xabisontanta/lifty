import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {assertLocalContainer, sandboxSql} from '../../scripts/sandbox-safety.mjs'

/**
 * The sandbox's fake phone numbers and their fixed one-time code come from supabase/local-e2e/config.toml ([auth.sms.test_otp]).
 * They only exist in the local sandbox — no SMS is sent and nothing here can touch the live project.
 */
const cfg = readFileSync('supabase/local-e2e/config.toml', 'utf8')
const block = cfg.split('[auth.sms.test_otp]')[1].split(/\n\[/)[0]
const pairs = [...block.matchAll(/^(\d+)\s*=\s*"(\d+)"/gm)].map((m) => ({ digits: m[1], code: m[2], national: m[1].replace(/^27/, '') }))
export const [PASSENGER, DRIVER, NEWBIE] = pairs
export const WRONG_CODE = '000000'

const DB = process.env.LIFTY_E2E_DB_CONTAINER ?? 'supabase_db_lifty-e2e'
/** Run SQL in the sandbox database (never the live project). */
export function sql(query: string): string {
  assertLocalContainer(DB)
  return sandboxSql(query)
}
/**
 * Remove whatever accounts earlier runs left on the three reserved fake numbers (they exist only in this sandbox). The names
 * the tests sign up with differ from test to test, so the NUMBER decides — a name filter left two accounts behind and broke
 * the next run. Capture held seats, remove those accounts, then return the seats in one transaction.
 * Returning seats while memberships still exist would exceed the vehicle capacity with two riders.
 * A plain delete leaves counters short and eventually hides fixture drivers from matching.
 */
const reservedPhones = pairs.slice(0, 3).map((p) => `'${p.digits}'`).join(',')
export const resetTestUsers = () => sql(`
  begin;
  create temporary table lifty_reserved_seats on commit drop as
    select cm.leg_id, count(*) n from public.club_members cm join auth.users u on u.id = cm.passenger_id
    where cm.active and u.phone in (${reservedPhones}) group by cm.leg_id;
  delete from auth.users where phone in (${reservedPhones});
  update public.driver_legs l set seats_open = l.seats_open + m.n
    from lifty_reserved_seats m where l.id = m.leg_id;
  commit;
`)
export const userId = (p: { digits: string }) => sql(`select id from auth.users where phone = '${p.digits}'`)

/**
 * Fixture drivers answer requests by themselves (after a short delay) while the simulator runs. A test that wants to look at a
 * PENDING request holds them first and puts them back exactly as they were afterwards.
 */
let heldSettings: string | null = null
export function holdTestDriverResponses() {
  heldSettings = sql(`select coalesce(jsonb_object_agg(driver_id, auto_respond), '{}') from lifty_private.test_driver_settings`)
  sql('update lifty_private.test_driver_settings set auto_respond = false')
}
export function releaseTestDriverResponses() {
  if (heldSettings == null) return
  sql(`update lifty_private.test_driver_settings s set auto_respond = v.value::boolean from jsonb_each_text('${heldSettings}'::jsonb) v where s.driver_id = v.key::uuid`)
  heldSettings = null
}

/**
 * Run the fixture simulator (answers, trips, live positions) for the length of a test, so no separately started simulator is
 * needed. It is its own process, like the one an operator starts: ticking from inside the test would block the test's event
 * loop (every sql() call runs several Docker commands) and make the browser steps crawl.
 */
export function startSimulationTicker() {
  mkdirSync('test-results-local', { recursive: true })
  const log = openSync('test-results-local/simulator.log', 'a') // kept, so a silent simulator can be explained afterwards
  const child = spawn(process.execPath, ['scripts/test-driver-simulator.mjs', 'run'], { stdio: ['ignore', log, log] })
  return () => { child.kill(); closeSync(log) }
}

export async function shot(page: Page, name: string) {
  mkdirSync('test-results-local/shots', { recursive: true })
  await page.screenshot({ path: `test-results-local/shots/${name}.png` })
}

/**
 * The Auth service refuses a second code for the same number within a few seconds (a minute in production). Space the tests like
 * a person would. The times are kept in a file, not in memory: Playwright starts a fresh worker after any failed test, and a
 * worker that forgets would ask too soon and fail for a reason that has nothing to do with the app.
 */
const stamps = join(tmpdir(), 'lifty-e2e-last-code-request.json')
const readStamps = (): Record<string, number> => { try { return JSON.parse(readFileSync(stamps, 'utf8')) } catch { return {} } }
export async function waitForCodeAllowance(p: { national: string }) {
  // 5 s quiet period in the sandbox + the time the request took to reach the service + a margin
  const wait = (readStamps()[p.national] ?? 0) + 6500 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}
/** Call right after a code request has been sent: the service counts its quiet period from that moment. */
export const markCodeRequested = (p: { national: string }) => writeFileSync(stamps, JSON.stringify({ ...readStamps(), [p.national]: Date.now() }))

export async function startSignUp(page: Page, role: 'passenger' | 'driver', name: string, p: { national: string }) {
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Get Started' }).click()
  await page.getByRole('radio', { name: role === 'driver' ? /Driver/ : /Passenger/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Mobile number').fill(p.national)
  await page.getByRole('checkbox').check()
  await waitForCodeAllowance(p)
  await page.getByRole('button', { name: 'Create Account' }).click()
  markCodeRequested(p)
}

export async function enterCode(page: Page, code: string) {
  await page.getByRole('group', { name: /verification code/i }).locator('input').first().fill(code) // paste-style entry
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}

/**
 * Type into an address field and pick a suggestion from the real Mapbox search — the first one whose text matches `mustMatch`
 * (a person reads the list and picks the right line; "Umhlanga Ridge" also matches a Ridge Road 17 km away in central Durban).
 */
export async function pickAddress(page: Page, label: string, query: string, mustMatch: RegExp) {
  await page.getByLabel(label).fill(query)
  const options = page.locator('.suggestions button')
  await options.first().waitFor({ timeout: 20_000 })
  const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  const i = texts.findIndex((t) => mustMatch.test(t))
  if (i < 0) throw new Error(`No suggestion for "${query}" matched ${mustMatch}: ${JSON.stringify(texts)}`)
  await options.nth(i).click()
}
