import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Johannesburg' })

const project = 'kdjzevtryezwbjdgyqaf'
const driverId = '11111111-1111-4111-8111-111111111111'
const p1 = '22222222-2222-4222-8222-222222222222'
const p2 = '33333333-3333-4333-8333-333333333333'
const morningId = '44444444-4444-4444-8444-444444444444'
const eveningId = '55555555-5555-4555-8555-555555555555'
const requestId = '66666666-6666-4666-8666-666666666666'
const tripId = '77777777-7777-4777-8777-777777777777'
const point = { label: 'Library pickup', lat: -29.55, lng: 31.14 }
const destination = { label: 'Office park', lat: -29.72, lng: 31.07 }
const routeLine = { type: 'LineString', coordinates: [[point.lng, point.lat], [destination.lng, destination.lat]] }
const verification = { identity: 'verified', licence: 'verified', vehicle: 'verified', insurance: 'verified' }
const user = { id: driverId, aud: 'authenticated', role: 'authenticated', phone: '27000000000', app_metadata: { provider: 'phone', providers: ['phone'] }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: driverId, role: 'authenticated', exp: 1_800_000_000 })).toString('base64url'), 'test-signature'].join('.')
const session = { access_token: token, refresh_token: 'driver-browser-fixture', token_type: 'bearer', expires_at: 1_800_000_000, expires_in: 3600, user }
const account = {
  profile: { id: driverId, role: 'driver', first_name: 'Driver', last_initial: 'Q', created_at: '2026-10-01T00:00:00Z', onboarding_completed_at: '2026-10-01T00:00:00Z' },
  private: { phone: '27000000000', last_name: 'Fixture', location_consent_at: null, low_data_mode: true },
  vehicle: { registration_summary: 'ND ••• 123', make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Silver', seats_total: 3, body_type: 'sedan' },
  legs: [], commutes: [], documents: [], exceptions: [], requests: [], memberCount: 0, verification,
}
function leg(id = morningId, direction = 'to_work') {
  return { legId: id, direction, originLabel: direction === 'to_home' ? 'Office park' : 'Library pickup', destinationLabel: direction === 'to_home' ? 'Evening home' : 'Office park', departureTime: direction === 'to_home' ? '16:30' : '06:30', days: [0, 1, 2, 3, 4], seatsOpen: 3, maxDeviationMin: 8, monthlyContribution: 500, routeDistanceM: 20_000, route: routeLine, members: [], requestsPaused: false }
}
function request(status = 'pending') {
  return { id: requestId, legId: morningId, direction: 'to_work', passenger: { id: p1, firstName: 'Amina', lastInitial: 'Q', rating: 0, ratingCount: 0, verified: false, reliability: null }, pickup: point, destination, days: [0, 1, 2, 3, 4], arriveBy: '08:00', walkingFlexibilityM: 500, routeOverlap: 90, currentCommuteMinutes: 30, deviationMinutes: 3, additionalDistanceKm: 1, geometry: { path: routeLine, deviation: { type: 'LineString', coordinates: [] } }, startDate: '2026-10-16', status, monthlyContribution: 500 }
}
function trip() {
  return {
    id: tripId, legId: morningId, direction: 'to_work', status: 'sharing', isDriver: true,
    departsAt: new Date(Date.now() - 60_000).toISOString(), sharingStartsAt: new Date(Date.now() - 600_000).toISOString(), sharingEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
    route: routeLine, routeDurationS: 1800, destination,
    driver: { id: driverId, firstName: 'Driver', lastInitial: 'Q', rating: 0, ratingCount: 0, verification }, vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', bodyType: 'sedan', registrationSummary: 'ND ••• 123' },
    riders: [
      { passengerId: p1, firstName: 'Amina', lastInitial: 'Q', status: 'expected', pickup: point, pickupTime: '06:30', driverArrivedAt: null },
      { passengerId: p2, firstName: 'Bongi', lastInitial: 'Q', status: 'expected', pickup: { label: 'Station pickup', lat: -29.57, lng: 31.12 }, pickupTime: '06:35', driverArrivedAt: null },
    ],
  }
}
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface Fixture {
  requests: any[]
  legs: any[]
  currentTrip: ReturnType<typeof trip> | null
  calls: { path: string; body: any }[]
  failDecision: boolean
  failArrival: boolean
  decisionDelay: number
}
async function backend(page: Page): Promise<Fixture> {
  const fixture: Fixture = { requests: [], legs: [leg(), leg(eveningId, 'to_home')], currentTrip: null, calls: [], failDecision: false, failArrival: false, decisionDelay: 0 }
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://fonts.gstatic.com/**', r => r.abort())
  await page.route('https://api.mapbox.com/**', r => r.abort())
  await page.route(`**/${project}.supabase.co/**`, async r => {
    const path = new URL(r.request().url()).pathname
    const body = r.request().postDataJSON()
    fixture.calls.push({ path, body })
    if (path === '/auth/v1/user') return json(r, user)
    if (path === '/rest/v1/rpc/get_account_snapshot') return json(r, account)
    if (path === '/rest/v1/rpc/get_my_clubs') return json(r, { asPassenger: [], asDriver: fixture.legs })
    if (path === '/rest/v1/rpc/list_incoming_requests') return json(r, fixture.requests)
    if (path === '/rest/v1/rpc/get_current_instance') return json(r, fixture.currentTrip)
    if (path === '/rest/v1/rpc/is_admin') return json(r, false)
    if (path === '/rest/v1/rpc/can_track') return json(r, false)
    if (path === '/rest/v1/rpc/respond_to_request') {
      if (fixture.decisionDelay) await new Promise(resolve => setTimeout(resolve, fixture.decisionDelay))
      if (fixture.failDecision) return json(r, { message: 'The last seat was taken. Refresh this request.' }, 400)
      fixture.requests.find(q => q.id === body.p_request).status = body.p_accept ? 'accepted' : 'declined'
      return json(r, null)
    }
    if (path === '/rest/v1/rpc/set_driver_requests_paused') {
      fixture.legs.find(l => l.legId === body.p_leg).requestsPaused = body.p_paused
      fixture.legs.reverse() // UPDATE can change row order; selected route must stay the same.
      return json(r, null)
    }
    if (path === '/rest/v1/rpc/mark_driver_arrived') {
      if (fixture.failArrival) return json(r, { message: 'Arrival could not be saved. Try again.' }, 400)
      fixture.currentTrip!.riders.find(p => p.passengerId === body.p_passenger)!.driverArrivedAt = new Date().toISOString() as any
      return json(r, null)
    }
    if (path === '/rest/v1/rpc/mark_rider_status') {
      fixture.currentTrip!.riders.find(p => p.passengerId === body.p_passenger)!.status = body.p_status
      return json(r, null)
    }
    if (path === '/rest/v1/commute_instances') return json(r, { status: fixture.currentTrip?.status ?? 'sharing' })
    if (path === '/rest/v1/instance_riders') return json(r, fixture.currentTrip?.riders.map(p => ({ passenger_id: p.passengerId, status: p.status, driver_arrived_at: p.driverArrivedAt })) ?? [])
    return json(r, [])
  })
  await page.addInitScript(({ s, p }) => localStorage.setItem(`sb-${p}-auth-token`, JSON.stringify(s)), { s: session, p: project })
  return fixture
}

test('browser notification settings confirm permission without claiming native push registration', async ({ page }) => {
  await backend(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      static permission = 'granted'
      static async requestPermission() { return 'granted' }
    } })
  })
  await page.goto('/d/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Browser alerts work while Lifty is open.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Enable device notifications', exact: true }).click()
  await expect(page.getByText('Browser alerts are allowed while Lifty is open.', { exact: true })).toBeVisible()
  await expect(page.getByText('This device is registered for push alerts.', { exact: false })).toHaveCount(0)
})

test('open driver inbox catches up after reconnect and distinguishes withdrawn requests', async ({ page }) => {
  const f = await backend(page)
  await page.goto('/d/requests')
  await expect(page.getByText('No pending requests', { exact: true })).toBeVisible()
  f.requests = [request()]
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Amina Q.', { exact: true })).toBeVisible()
  f.requests[0].status = 'cancelled'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible()
  await expect(page.getByText('Declined', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No pending requests', { exact: true })).toBeVisible()
})

test('driver home selects the evening route after morning instead of reusing morning', async ({ page }) => {
  await backend(page)
  await page.clock.install({ time: new Date('2026-10-16T11:00:00Z') })
  await page.goto('/d/home')
  await expect(page.getByRole('heading', { name: 'Office park → Evening home' })).toBeVisible()
  await expect(page.getByText('Next commute · Evening', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open today’s commute', exact: true })).toBeDisabled()
})

test('rapid acceptance makes one decision and recovers the server result after reload', async ({ page }) => {
  const f = await backend(page)
  f.requests = [request()]
  f.decisionDelay = 500
  await page.goto('/d/request/' + requestId)
  const accept = page.getByRole('button', { name: 'Accept Passenger', exact: true })
  await expect(accept).toBeVisible()
  await accept.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page).toHaveURL(/\/d\/requests$/)
  expect(f.calls.filter(c => c.path.endsWith('/respond_to_request'))).toHaveLength(1)
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible()
})

test('failed acceptance keeps an actionable error without showing a successful arrangement', async ({ page }) => {
  const f = await backend(page)
  f.requests = [request()]
  f.failDecision = true
  await page.goto('/d/request/' + requestId)
  await page.getByRole('button', { name: 'Accept Passenger', exact: true }).click()
  await expect(page.getByText('The last seat was taken. Refresh this request.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp('/d/request/' + requestId + '$'))
  await expect(page.getByRole('button', { name: 'Accept Passenger', exact: true })).toBeEnabled()
  expect(f.requests[0].status).toBe('pending')
})

test('pausing new requests persists on the selected leg without cancelling existing arrangements', async ({ page }) => {
  const f = await backend(page)
  await page.goto('/d/settings')
  await page.getByLabel('Commute', { exact: true }).selectOption(eveningId)
  await page.getByRole('button', { name: 'Pause new requests', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen new requests', exact: true })).toBeVisible()
  expect(f.legs.find(l=>l.legId===morningId)?.requestsPaused).toBe(false)
  expect(f.legs.find(l=>l.legId===eveningId)?.requestsPaused).toBe(true)
  await expect(page.getByLabel('Commute',{exact:true})).toHaveValue(eveningId)
  expect(f.calls.find(c => c.path.endsWith('/set_driver_requests_paused'))?.body).toEqual({ p_leg: eveningId, p_paused: true })
  await page.reload()
  await page.getByLabel('Commute', { exact: true }).selectOption(eveningId)
  await expect(page.getByRole('button', { name: 'Reopen new requests', exact: true })).toBeVisible()
})

test('driver pickup actions and errors stay with the selected passenger when GPS is off', async ({ page }) => {
  const f = await backend(page)
  f.currentTrip = trip()
  f.failArrival = true
  await page.goto('/d/today')
  await expect(page.getByText(/Your agreed pickup points and club chat still work/)).toBeVisible()
  await page.getByRole('button', { name: 'Arrived at this pickup', exact: true }).click()
  await expect(page.getByText('Arrival could not be saved. Try again.', { exact: true }).first()).toBeVisible()
  const pickups = page.getByLabel('Passenger pickups', { exact: true })
  await pickups.getByRole('button', { name: /Bongi/ }).click()
  await expect(page.getByRole('button', { name: "Navigate to Bongi's pickup", exact: true })).toBeVisible()
  f.failArrival = false
  await page.getByRole('button', { name: 'Arrived at this pickup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm Bongi collected', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm Bongi collected', exact: true }).click()
  await expect(pickups.getByRole('button', { name: /Bongi/ })).toContainText('Collected')
  await expect(pickups.getByRole('button', { name: /Amina/ })).toContainText('Expected')
  expect(f.calls.filter(c => c.path.endsWith('/mark_rider_status')).map(c => c.body.p_passenger)).toEqual([p2])
  await expect(page.getByRole('button', { name: 'Finish commute', exact: true })).toBeDisabled()
})

test('pickup navigation targets the selected pickup and never routes to the final destination first', async ({ page }) => {
  const f = await backend(page)
  f.currentTrip = trip()
  await page.addInitScript(() => {
    ;(window as any).openedNavigation = []
    window.open = ((url: string) => { (window as any).openedNavigation.push(url); return null }) as any
  })
  await page.goto('/d/today')
  await page.getByRole('button', { name: "Navigate to Amina's pickup", exact: true }).click()
  await page.getByRole('button', { name: 'Google Maps', exact: true }).click()
  const urls = await page.evaluate(() => (window as any).openedNavigation as string[])
  expect(urls).toHaveLength(1)
  const url = new URL(urls[0])
  expect(url.searchParams.get('destination')).toBe(`${point.lat},${point.lng}`)
  expect(url.searchParams.has('waypoints')).toBe(false)
  await expect(page.getByRole('button', { name: 'Share commute details', exact: true })).toBeVisible()
})

test('an approval hold blocks new pickups and permits safe completion for a passenger already collected',async({page})=>{
  const f=await backend(page)
  f.currentTrip=trip()
  ;(f.currentTrip as any).verificationHold=true
  f.currentTrip.riders[0].status='collected'
  await page.goto('/d/today')
  await expect(page.getByText(/New pickups are on hold/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Arrived at this pickup',exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'Finish commute',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Finish commute',exact:true}).click()
  await expect(page).toHaveURL(/\/history$/)
  expect(f.calls.filter(c=>c.path.endsWith('/complete_instance'))).toHaveLength(1)
  expect(f.calls.filter(c=>c.path.endsWith('/mark_rider_status'))).toHaveLength(0)
})
