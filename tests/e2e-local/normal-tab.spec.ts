import { expect, test, type Browser } from '@playwright/test'
import { sandbox, signInViaUi } from './auth-helpers'
import { DRIVER, NEWBIE, PASSENGER, enterCode, resetTestUsers, shot, sql, startSignUp, userId, markCodeRequested, waitForCodeAllowance } from './helpers'

/**
 * "Works in a private tab, fails in a normal tab" against the REAL Auth service of the sandbox. A normal browser carries state
 * from earlier visits; each test gives the app exactly that state and checks that it recovers by itself.
 */
test.beforeAll(() => {
  resetTestUsers() // sandbox only
})

const finishOnboardingInDb = (p: { digits: string }) => sql(`update public.profiles set onboarding_completed_at = now() where id = '${userId(p)}'`)

test('a normal tab that once chose demo mode (old permanent flag) still signs up for real', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('lifty.source', JSON.stringify('demo')) // exactly what the old build left behind
  })
  await startSignUp(page, 'passenger', 'Normal Tab', PASSENGER)
  await expect(page.getByText('Verify your number')).toBeVisible()
  await expect(page.getByText(/Demo mode: any 6 digits/)).toHaveCount(0)
  await enterCode(page, PASSENGER.code)
  await expect(page.getByText('Your commuting details')).toBeVisible()
  // the account is REAL: it exists in the database (in demo mode nothing is ever created)
  expect(sql(`select (phone_confirmed_at is not null)::text from auth.users where phone = '${PASSENGER.digits}'`)).toBe('true')
  expect(sql(`select count(*) from public.profiles where id = '${userId(PASSENGER)}'`)).toBe('1')
  await shot(page, '20-normal-tab-signup')
})

test('the login survives a refresh and is shared with a second tab; a logged-out visitor is sent to the welcome screen', async ({ page, context, browser }) => {
  finishOnboardingInDb(PASSENGER)
  await signInViaUi(page, PASSENGER)
  await expect(page).toHaveURL(/\/p\/home/)
  await page.goto('/p/profile')
  await expect(page.getByRole('heading', { name: /Normal/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: /Normal/ })).toBeVisible() // refresh while signed in: still signed in
  const second = await context.newPage()
  await second.goto('/p/profile')
  await expect(second.getByRole('heading', { name: /Normal/ })).toBeVisible() // another tab of the same browser
  await shot(page, '21-after-refresh')
  // a browser that never signed in
  const stranger = await (await browser.newContext()).newPage()
  for (const path of ['/p/home', '/p/profile', '/p/find', '/d/home']) {
    await stranger.goto(path)
    await expect(stranger, path).toHaveURL(/\/welcome$/)
  }
  await stranger.context().close()
})

async function signedIn(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-ZA' })
  const page = await ctx.newPage()
  await signInViaUi(page, PASSENGER)
  await expect(page).toHaveURL(/\/p\/home/)
  return { ctx, page }
}

test('signing out on one device or tab does NOT sign the account out everywhere', async ({ browser }) => {
  const a = await signedIn(browser)
  const b = await signedIn(browser)
  const sessions = () => Number(sql(`select count(*) from auth.sessions where user_id = '${userId(PASSENGER)}'`))
  const before = sessions()
  expect(before).toBeGreaterThanOrEqual(2)
  await b.page.goto('/p/profile')
  await b.page.getByRole('button', { name: 'Sign out' }).click()
  await expect(b.page).toHaveURL(/\/welcome$/)
  expect(sessions()).toBe(before - 1) // only B's session went away; A's is intact and still works
  await a.page.goto('/p/profile')
  await expect(a.page.getByRole('heading', { name: /Normal/ })).toBeVisible()
  await a.ctx.close()
  await b.ctx.close()
})

test('a login the server has revoked is cleared cleanly on the next visit, with an explanation', async ({ browser }) => {
  const a = await signedIn(browser)
  sql(`delete from auth.sessions where user_id = '${userId(PASSENGER)}'`) // revoked server-side (e.g. signed out everywhere)
  // time passes: the short-lived access token has expired, so the app must try to refresh it — and the server refuses
  await a.page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /^sb-.+-auth-token$/.test(x))!
    const s = JSON.parse(localStorage.getItem(k)!)
    s.expires_at = Math.floor(Date.now() / 1000) - 120
    localStorage.setItem(k, JSON.stringify(s))
  })
  await a.page.goto('/p/profile')
  await expect(a.page).toHaveURL(/\/welcome$/)
  await expect(a.page.getByText(/session expired|signed out/i)).toBeVisible()
  await expect(a.page.getByText('Restoring your account')).toHaveCount(0)
  await shot(a.page, '22-revoked-session')
  // and they can simply sign in again
  await signInViaUi(a.page, PASSENGER)
  await expect(a.page).toHaveURL(/\/p\/home/)
  await a.ctx.close()
})

test('with no connection, asking for a code says so plainly', async ({ page, context }) => {
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Offline Person')
  await page.getByLabel('Mobile number').fill(NEWBIE.national)
  await page.getByRole('checkbox').check()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page.getByText("You're offline. Check your connection and try again.")).toBeVisible()
  await shot(page, '23-offline')
  await context.setOffline(false)
})

test('the database itself creates the profile when the code is confirmed — not before, and without the app', async () => {
  const { url, anon } = sandbox()
  const headers = { apikey: anon, 'Content-Type': 'application/json' }
  const phone = `+${DRIVER.digits}`
  const asked = await fetch(`${url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone, create_user: true, data: { full_name: 'Thandi van der Merwe', role: 'driver', terms_accepted: true } }) })
  expect(asked.status).toBe(200)
  // only asked for a code: an account row exists but nothing is created for an unproven number
  expect(sql(`select count(*) from auth.users where phone = '${DRIVER.digits}'`)).toBe('1')
  expect(sql(`select count(*) from public.profiles where id = '${userId(DRIVER)}'`)).toBe('0')
  const verified = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ type: 'sms', phone, token: DRIVER.code }) })
  expect(verified.status).toBe(200)
  expect(sql(`select role || '|' || first_name || '|' || last_initial from public.profiles where id = '${userId(DRIVER)}'`)).toBe('driver|Thandi|V')
  expect(sql(`select last_name || '|' || (terms_accepted_at is not null)::text || '|' || (phone = '${DRIVER.digits}')::text from public.profile_private where id = '${userId(DRIVER)}'`)).toBe('van der Merwe|true|true')
})

test('odd sign-up details can never block signing in, or pick a power the person should not have', async () => {
  const { url, anon } = sandbox()
  const headers = { apikey: anon, 'Content-Type': 'application/json' }
  sql(`delete from auth.users where phone = '${NEWBIE.digits}'`)
  // an enormous name and a role that does not exist
  const asked = await fetch(`${url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone: `+${NEWBIE.digits}`, create_user: true, data: { full_name: 'x'.repeat(400), role: 'admin' } }) })
  expect(asked.status).toBe(200)
  const verified = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ type: 'sms', phone: `+${NEWBIE.digits}`, token: NEWBIE.code }) })
  expect(verified.status).toBe(200) // never blocked by profile creation
  expect(sql(`select role::text from public.profiles where id = '${userId(NEWBIE)}'`)).toBe('passenger') // unknown role → the safe default
  expect(Number(sql(`select char_length(first_name) from public.profiles where id = '${userId(NEWBIE)}'`))).toBeLessThanOrEqual(60)
  expect(sql(`select count(*) from public.admins where user_id = '${userId(NEWBIE)}'`)).toBe('0')
})

test('asking for a second code straight away explains the wait instead of failing silently', async ({ page }) => {
  const ask = async () => {
    await page.goto('/signin')
    await page.getByLabel('Mobile number').fill(PASSENGER.national)
    await page.getByRole('button', { name: 'Send code' }).click()
  }
  await waitForCodeAllowance(PASSENGER)
  await ask()
  markCodeRequested(PASSENGER)
  await expect(page.getByText('Verify your number')).toBeVisible()
  await ask() // straight away — deliberately not spaced
  await expect(page.getByText(/Please wait \d+ seconds before asking for another code/)).toBeVisible()
  await shot(page, '24-rate-limited')
  await waitForCodeAllowance(PASSENGER) // …and it works again once the wait is over
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Verify your number')).toBeVisible()
})
