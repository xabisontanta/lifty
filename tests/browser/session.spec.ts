import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * "Works in a private tab, fails in a normal tab": a normal browser carries state from earlier visits (an old demo choice, an
 * expired login, a login the server no longer accepts, a bad connection at launch). These tests give the app exactly that
 * leftover state and check that it recovers on its own — no clearing of site data, no private tab.
 */
const project = 'kdjzevtryezwbjdgyqaf'
const uid = '11111111-1111-4111-8111-111111111111'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const user = { id: uid, aud: 'authenticated', role: 'authenticated', phone: '27000000000', app_metadata: { provider: 'phone', providers: ['phone'] }, user_metadata: {}, created_at: '2026-10-08T00:00:00Z' }
const session = (expiresInSeconds = 3600) => ({
  access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }), 'test-signature'].join('.'),
  refresh_token: 'browser-fixture', token_type: 'bearer', expires_in: expiresInSeconds, expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds, user,
})
const snapshot = {
  profile: { id: uid, role: 'passenger', first_name: 'Browser', last_initial: 'Q', created_at: '2026-10-08T00:00:00Z', onboarding_completed_at: '2026-10-08T00:00:00Z' },
  private: { phone: '27000000000', last_name: 'Fixture', location_consent_at: null, low_data_mode: true },
  vehicle: null, legs: [], commutes: [], documents: [], exceptions: [], requests: [], memberCount: 0,
  verification: { identity: 'pending', licence: 'pending', vehicle: 'pending', insurance: 'pending' },
}
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface Backend { calls: string[]; snapshot: (route: Route) => Promise<void> | void }
/** A tiny fake Supabase. `snapshot` decides how the account lookup behaves, so each test can break it differently. */
async function fakeBackend(page: Page, snapshotHandler?: Backend['snapshot']): Promise<Backend> {
  const state: Backend = { calls: [], snapshot: snapshotHandler ?? ((route) => json(route, snapshot)) }
  await page.route(`**/${project}.supabase.co/**`, async (route) => {
    const url = new URL(route.request().url())
    state.calls.push(`${route.request().method()} ${url.pathname}${url.search}`)
    const p = url.pathname
    if (p === '/auth/v1/otp') return json(route, {})
    if (p === '/auth/v1/user') return json(route, user)
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' })
    if (p === '/rest/v1/rpc/get_account_snapshot') return state.snapshot(route)
    if (p === '/rest/v1/rpc/get_my_clubs') return json(route, { asPassenger: [], asDriver: [] })
    if (p === '/rest/v1/rpc/is_admin') return json(route, false)
    if (p === '/rest/v1/rpc/get_current_instance') return json(route, null)
    return json(route, [])
  })
  return state
}
const storeSession = (page: Page, s: object) => page.addInitScript(({ s, project }) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(s)) } }, { s, project })
const signUp = async (page: Page) => {
  await page.getByLabel('Full name').fill('Browser Fixture')
  await page.getByLabel('Mobile number', { exact: true }).fill('820000000')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create Account', exact: true }).click()
}

test('a permanent demo flag left by an older build is removed — the app asks the backend for the code', async ({ page }) => {
  const backend = await fakeBackend(page)
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('lifty.source', JSON.stringify('demo')) } })
  await page.goto('/signup')
  await expect(page.getByText('Demo mode is on')).toHaveCount(0)
  await signUp(page)
  await expect(page).toHaveURL(/\/otp$/)
  expect(backend.calls).toContain('POST /auth/v1/otp') // a private tab does this; a normal tab used to silently skip it
  await expect(page.getByText(/Demo mode: any 6 digits/)).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('lifty.source'))).toBeNull()
})

test('demo mode lasts for the current tab only and is clearly flagged, with one tap back to real accounts', async ({ page }) => {
  const backend = await fakeBackend(page)
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('lifty.source', 'demo') } })
  await page.goto('/signin')
  await expect(page.getByText('Demo mode is on')).toBeVisible()
  await page.getByRole('button', { name: 'Use real accounts' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  expect(await page.evaluate(() => sessionStorage.getItem('lifty.source'))).toBeNull()
  await page.getByRole('button', { name: /I already have an account/ }).click()
  await expect(page.getByText('Demo mode is on')).toHaveCount(0)
  expect(backend.calls.filter((c) => c.includes('/auth/v1/otp'))).toHaveLength(0) // nothing was sent just by switching
})

test('an expired login (refresh token rejected) lands on the welcome screen with an explanation, not a spinner or error', async ({ page }) => {
  await fakeBackend(page)
  await page.route(`**/${project}.supabase.co/auth/v1/token*`, (route) => json(route, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }, 400))
  await storeSession(page, session(-7200))
  await page.goto('/p/home')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByText('Restoring your account')).toHaveCount(0)
  await expect(page.getByText(/session expired|signed out/i)).toBeVisible()
  expect(await page.evaluate((p) => localStorage.getItem(`sb-${p}-auth-token`), project)).toBeNull() // the dead login is cleared
})

test('a login the server rejects while loading the account signs out cleanly instead of showing "JWT expired"', async ({ page }) => {
  await fakeBackend(page, (route) => json(route, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null }, 401))
  await storeSession(page, session())
  await page.goto('/p/profile')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible()
  await expect(page.getByText('JWT expired')).toHaveCount(0)
  expect(await page.evaluate((p) => localStorage.getItem(`sb-${p}-auth-token`), project)).toBeNull()
})

test('a weak connection at launch keeps the saved login and offers Try again, which recovers', async ({ page }) => {
  let offline = true
  await fakeBackend(page, (route) => (offline ? route.abort('failed') : json(route, snapshot)))
  await storeSession(page, session())
  await page.goto('/p/profile')
  await expect(page.getByText(/couldn.t reach Lifty/i)).toBeVisible()
  expect(await page.evaluate((p) => localStorage.getItem(`sb-${p}-auth-token`), project)).not.toBeNull() // not signed out for a signal blip
  offline = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Browser Fixture' })).toBeVisible()
})

test('a backend that never answers ends in a retryable message — never "Restoring your account…" forever', async ({ page }) => {
  await page.clock.install()
  await fakeBackend(page, () => new Promise(() => undefined)) // never fulfils
  await storeSession(page, session())
  await page.goto('/p/profile')
  await expect(page.getByText('Restoring your account')).toBeVisible()
  await page.clock.fastForward(13_000)
  await expect(page.getByText(/couldn.t reach Lifty/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('signing out is for this device only (so it cannot kill a login open in another tab) and works', async ({ page }) => {
  const backend = await fakeBackend(page)
  await storeSession(page, session())
  await page.goto('/p/profile')
  await expect(page.getByRole('heading', { name: 'Browser Fixture' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  expect(backend.calls.some((c) => c.startsWith('POST /auth/v1/logout') && c.includes('scope=local'))).toBe(true)
  expect(backend.calls.some((c) => c.startsWith('POST /auth/v1/logout') && !c.includes('scope=local'))).toBe(false)
  await expect(page.getByText(/session expired|signed out/i)).toHaveCount(0) // a deliberate sign-out is not "explained" as a problem
})

test('signing out works with no connection at all', async ({ page }) => {
  await fakeBackend(page)
  await storeSession(page, session())
  await page.goto('/p/profile')
  await expect(page.getByRole('heading', { name: 'Browser Fixture' })).toBeVisible()
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
})

test('every signed-in area sends a logged-out visitor to the welcome screen', async ({ page }) => {
  await fakeBackend(page)
  for (const path of ['/p/home', '/p/find', '/p/profile', '/p/matches', '/d/home', '/d/profile', '/onboarding/passenger/1']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/welcome$/)
  }
})
