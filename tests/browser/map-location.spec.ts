import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Johannesburg' })
const project = 'kdjzevtryezwbjdgyqaf'
const uid = '44444444-4444-4444-8444-444444444444'
const home = [-29.5378, 31.2105]
const device = [-29.5024, 31.2331]
const authUser = { id: uid, aud: 'authenticated', role: 'authenticated', phone: '27000000000', app_metadata: { provider: 'phone', providers: ['phone'] }, user_metadata: {}, created_at: '2026-10-08T00:00:00Z' }
const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'browser-test-signature'].join('.')

async function prepare(page: Page, denied = false, emptyCommute = false, lowData = true) {
  // External font availability must not delay this application's load event.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://fonts.gstatic.com/**', route => route.abort())
  await page.route('**/' + project + '.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: any = []
    if (path === '/auth/v1/user') body = authUser
    if (path === '/rest/v1/rpc/get_account_snapshot') body = {
      profile: { id: uid, role: 'passenger', first_name: 'Location', last_initial: 'Q', created_at: '2026-10-08T00:00:00Z', onboarding_completed_at: '2026-10-08T00:00:00Z' },
      private: { phone: '27000000000', last_name: 'Fixture', location_consent_at: null, low_data_mode: lowData }, vehicle: null, legs: [],
      commutes: emptyCommute ? [] : [{ direction: 'to_work', origin_label: 'Saved Ballito address', destination_label: 'Umhlanga workplace', originPoint: { coordinates: [home[1], home[0]] }, destinationPoint: { coordinates: [31.067, -29.726] }, days: [0, 1, 2, 3, 4], arrive_by: '08:00:00', max_walk_m: 750, start_date: '2026-10-09', skip_holidays: true }],
      documents: [], exceptions: [], requests: [], memberCount: 0, verification: { identity: 'pending', licence: 'pending', vehicle: 'pending', insurance: 'pending' },
    }
    if (path === '/rest/v1/rpc/get_my_clubs') body = { asPassenger: [], asDriver: [] }
    if (path === '/rest/v1/rpc/get_current_instance') body = null
    if (path === '/rest/v1/rpc/is_admin') body = false
    if (path === '/rest/v1/rpc/list_pickup_points') body = [{ id: 'pickup-fixture', label: 'Salt Rock Main Road', area: 'Salt Rock', lat: -29.503, lng: 31.234 }]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.addInitScript(({ project, token, user, denied }) => {
    localStorage.setItem('sb-' + project + '-auth-token', JSON.stringify({ access_token: token, refresh_token: 'map-browser-test', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }))
    const callbacks = new Map<number, { good: (p: any) => void; bad: (e: any) => void }>()
    let sequence = 0
    let visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: denied ? 'denied' : 'granted' }) } })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (good: (p: any) => void, bad: (e: any) => void, options: any) => { const id = ++sequence; callbacks.set(id, { good, bad }); (window as any).__mapLocationOptions = options; return id },
      clearWatch: (id: number) => callbacks.delete(id),
      getCurrentPosition: (_good: any, bad: any) => bad({ code: 1 }),
    } })
    ;(window as any).__mapGps = {
      watches: () => callbacks.size,
      fix: (lat: number, lng: number, accuracy: number, age = 0) => callbacks.forEach(c => c.good({ timestamp: Date.now() - age, coords: { latitude: lat, longitude: lng, accuracy, heading: null, speed: null } })),
      deny: () => callbacks.forEach(c => c.bad({ code: 1 })),
      visibility: (next: string) => { visibility = next; document.dispatchEvent(new Event('visibilitychange')) },
    }
  }, { project, token, user: authUser, denied })
}

test('one current position follows GPS movement, shows metre accuracy, and recentres exactly', async ({ page }) => {
  await prepare(page)
  await page.goto('/p/home')
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true)
  expect(await page.evaluate(() => (window as any).__mapLocationOptions)).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
  await page.evaluate(([lat, lng]) => (window as any).__mapGps.fix(lat, lng, 120), device)
  const marker = page.locator('[data-current-location=true]')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute('data-location-lat', String(device[0]))
  await expect(marker).toHaveAttribute('data-location-lng', String(device[1]))
  await expect(page.getByText('You are here', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Saved home', { exact: true })).toHaveCount(1)
  await expect(page.locator('[data-location-accuracy-m="120"]')).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: 'Location accuracy: about 120 m' })).toBeVisible()
  await expect(page.locator('circle[fill="#00b386"]')).toHaveCount(1)
  await expect(page.getByText('Salt Rock Main Road', { exact: true })).toHaveCount(0)
  await fs.mkdir('docs/review/map', { recursive: true })
  await page.screenshot({ path: 'docs/review/map/correct-pin-390.png', fullPage: true })

  await page.evaluate(() => (window as any).__mapGps.fix(-29.504, 31.235, 8))
  await expect(marker).toHaveAttribute('data-location-lat', '-29.504')
  await expect(marker).toHaveAttribute('data-location-lng', '31.235')
  await expect(page.locator('[data-location-accuracy-m]')).toHaveCount(0)
  const before = await marker.getAttribute('style')
  await page.getByRole('button', { name: 'Re-centre on my location' }).click()
  await expect.poll(() => marker.getAttribute('style')).not.toBe(before)
  const bounds = await page.getByRole('img', { name: 'Your area with nearby pickup points' }).boundingBox()
  const style = await marker.getAttribute('style')
  const xy = style?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
  expect(Number(xy?.[1])).toBeCloseTo(bounds!.width / 2, 3)
  expect(Number(xy?.[2])).toBeCloseTo(bounds!.height / 2, 3)

  await page.evaluate(() => (window as any).__mapGps.deny())
  await expect(marker).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('set your location manually')
  await page.getByRole('link', { name: 'Profile', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(0)
})

test('permission denied has a persistent manual-location message and no fake current marker', async ({ page }) => {
  await prepare(page, true)
  await page.goto('/p/home')
  await expect(page.getByRole('alert')).toContainText('Location permission is off')
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mapGps.watches())).toBe(0)
  await page.getByRole('link', { name: 'Find Lifts', exact: true }).click()
  await page.getByRole('button', { name: 'Change start: Saved Ballito address' }).click()
  await page.getByRole('button', { name: 'Choose on map' }).click()
  await page.getByRole('button', { name: 'Enter coordinates manually' }).click()
  const useSpot = page.getByRole('button', { name: 'Use this spot', exact: true })
  await expect(useSpot).toBeDisabled()
  await page.getByLabel('Location label', { exact: true }).fill('Manual Salt Rock pickup')
  await page.getByLabel('Latitude', { exact: true }).fill('-29.5024')
  await page.getByLabel('Longitude', { exact: true }).fill('31.2331')
  await expect(useSpot).toBeEnabled()
  await expect(useSpot).toBeVisible()
  await page.screenshot({ path: 'docs/review/map/manual-location-390.png', fullPage: true })
  await useSpot.click()
  await expect(page.getByRole('button', { name: 'Change start: Manual Salt Rock pickup' })).toBeVisible()
})

test('stale GPS is rejected before a fresh fix can appear', async ({ page }) => {
  await prepare(page)
  await page.goto('/p/home')
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.1, 31.1, 20, 90_000))
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('fresh GPS fix')
  await page.evaluate(() => (window as any).__mapGps.fix(-29.5024, 31.2331, 10))
  await expect(page.locator('[data-current-location=true]')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a silent location watch expires instead of presenting old coordinates as current', async ({ page }) => {
  await page.clock.install()
  await prepare(page)
  await page.goto('/p/home')
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.5024, 31.2331, 10))
  await expect(page.locator('[data-current-location=true]')).toHaveCount(1)
  await page.clock.fastForward(31_000)
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('last location is out of date')
  await page.getByRole('button', { name: 'Find my location' }).click()
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.505, 31.236, 10))
  await expect(page.locator('[data-current-location=true]')).toHaveAttribute('data-location-lat', '-29.505')
})

test('an empty server commute cannot place default origin/destination pins or be searched', async ({ page }) => {
  await prepare(page, true, true)
  await page.goto('/p/find')
  await expect(page.getByRole('button', { name: 'Find Lift Clubs', exact: true })).toBeDisabled()
  await expect(page.getByText('Choose a valid start and destination before searching.')).toBeVisible()
  await expect(page.getByText('Saved home', { exact: true })).toHaveCount(0)
  await expect(page.locator('.map path[fill="#ef4444"]')).toHaveCount(0)
})

test('hiding and resuming the page revalidates GPS and does not restore the old dot', async ({ page }) => {
  await prepare(page)
  await page.goto('/p/home')
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.5024, 31.2331, 10))
  await expect(page.locator('[data-current-location=true]')).toHaveCount(1)
  await page.evaluate(() => (window as any).__mapGps.visibility('hidden'))
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mapGps.watches())).toBe(0)
  await page.evaluate(() => (window as any).__mapGps.visibility('visible'))
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await expect(page.locator('[data-current-location=true]')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.506, 31.239, 8))
  await expect(page.locator('[data-current-location=true]')).toHaveAttribute('data-location-lng', '31.239')
})

test('a stalled street-map request falls back within a bounded time and retains actual markers', async ({ page }) => {
  await page.clock.install()
  await prepare(page, false, false, false)
  // Hold every provider request; no network request or real token is needed.
  await page.route('**://*.mapbox.com/**', () => {})
  await page.goto('/p/home')
  await expect(page.locator('.map-gl')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await page.evaluate(() => (window as any).__mapGps.fix(-29.5024, 31.2331, 10))
  await page.clock.fastForward(8_100)
  await expect(page.locator('.map-svg')).toBeVisible()
  await expect(page.locator('[data-map-fallback]')).toContainText('illustrative layout')
  await expect(page.locator('[data-current-location=true]')).toHaveAttribute('data-location-lat', '-29.5024')
  await expect(page.getByText('Saved home', { exact: true })).toHaveCount(1)
})

test('a street-map network failure falls back instead of remaining blank', async ({ page }) => {
  await page.clock.install()
  await prepare(page, false, false, false)
  let failedRequests = 0
  await page.route('**://*.mapbox.com/**', async route => { failedRequests++; await route.abort('internetdisconnected') })
  await page.goto('/p/home')
  await expect.poll(() => page.evaluate(() => (window as any).__mapGps.watches())).toBe(1)
  await expect.poll(() => failedRequests, { timeout: 15_000 }).toBeGreaterThan(0)
  await page.clock.fastForward(8_100)
  await expect(page.locator('[data-map-fallback]')).toBeVisible()
  await expect(page.locator('.map-svg')).toBeVisible()
})

test('a stalled address-picker map opens manual coordinates without accepting its default centre', async ({ page }) => {
  await page.clock.install()
  await prepare(page, true)
  await page.route('**://*.mapbox.com/**', () => {})
  await page.goto('/p/find')
  await page.getByRole('button', { name: 'Change start: Saved Ballito address' }).click()
  await page.getByRole('button', { name: 'Choose on map' }).click()
  const dialog = page.getByRole('dialog')
  const useSpot = dialog.getByRole('button', { name: 'Use this spot', exact: true })
  await expect(useSpot).toBeDisabled()
  await expect(dialog.locator('.mapboxgl-canvas')).toHaveCount(1)
  await page.clock.fastForward(8_100)
  await expect(dialog.getByText('The street map is unavailable.', { exact: false })).toBeVisible()
  await expect(dialog.getByLabel('Latitude', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('Longitude', { exact: true })).toHaveValue('')
  await expect(useSpot).toBeDisabled()
  await dialog.getByLabel('Location label', { exact: true }).fill('Manually chosen pickup')
  await dialog.getByLabel('Latitude', { exact: true }).fill('-29.5024')
  await dialog.getByLabel('Longitude', { exact: true }).fill('31.2331')
  await expect(useSpot).toBeEnabled()
  await useSpot.click()
  await expect(page.getByRole('button', { name: 'Change start: Manually chosen pickup' })).toBeVisible()
})
