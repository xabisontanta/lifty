import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

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
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-At', '-c', query], { encoding: 'utf8' }).trim()
}
export const resetTestUsers = () => sql(`delete from auth.users where phone in (${pairs.map((p) => `'${p.digits}'`).join(',')})`)
export const userId = (p: { digits: string }) => sql(`select id from auth.users where phone = '${p.digits}'`)

export async function shot(page: Page, name: string) {
  mkdirSync('test-results-local/shots', { recursive: true })
  await page.screenshot({ path: `test-results-local/shots/${name}.png` })
}

/** The Auth service refuses a second code for the same number within a few seconds (a minute in production). Space the tests like a person would. */
const lastCodeRequest = new Map<string, number>()
export async function waitForCodeAllowance(p: { national: string }) {
  const wait = (lastCodeRequest.get(p.national) ?? 0) + 5500 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}
/** Call right after a code request has been sent: the service counts its quiet period from that moment. */
export const markCodeRequested = (p: { national: string }) => void lastCodeRequest.set(p.national, Date.now())

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
