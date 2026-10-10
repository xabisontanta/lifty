import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { sandbox, signInViaUi } from './auth-helpers'
import { PASSENGER, enterCode, resetTestUsers, sql, startSignUp, startSimulationTicker, userId } from './helpers'

const SIPHO = 'e0000000-0000-4000-8000-000000000101'
const SIPHO_PHONE = { national: '820000101', code: '123456' }
const shots = 'docs/review/local-390'
const configureSipho = (automatic: boolean, delaySeconds: number) => sql(`select public.configure_test_driver('${SIPHO}',${automatic},${delaySeconds},0)`)

// The fixture drivers are moved along from inside this test (answers, trips, live positions), so it does not depend on a
// separately started simulator, and Sipho is always put back to his normal automatic setting.
let stopTicker: (() => void) | undefined
test.beforeEach(() => { stopTicker = startSimulationTicker() })
test.afterEach(() => { stopTicker?.(); configureSipho(true, 5) })

async function screenshot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${shots}/${name}.png` })
}

/** What the signed-in browser's own session gets back from the "current commute" lookup (status and the start of the body). */
async function currentInstanceProbe(page: Page) {
  const { url, anon } = sandbox()
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k))
    return key ? (JSON.parse(localStorage.getItem(key)!).access_token as string) : ''
  })
  const response = await fetch(`${url}/rest/v1/rpc/get_current_instance`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })
  return `${response.status} ${(await response.text()).slice(0, 160)}`
}

async function selectCoordinates(page: Page, field: number, label: string, lat: number, lng: number) {
  await page.getByRole('button', { name: /^(Choose on map|Enter coordinates)$/ }).nth(field).click()
  const manual = page.getByRole('button', { name: 'Enter coordinates manually' })
  if (await manual.isVisible()) await manual.click()
  await page.getByLabel('Location label', { exact: true }).fill(label)
  await page.getByLabel('Latitude', { exact: true }).fill(String(lat))
  await page.getByLabel('Longitude', { exact: true }).fill(String(lng))
  await page.getByRole('button', { name: 'Use this spot' }).click()
}

function collectDriverPositions(message: unknown, positions: string[]) {
  if (!message || typeof message !== 'object') return
  const row = message as Record<string, unknown>
  if (row.from === SIPHO && Number.isFinite(row.lat) && Number.isFinite(row.lng)) positions.push(`${row.lat},${row.lng}`)
  Object.values(row).forEach(value => collectDriverPositions(value, positions))
}

/**
 * Realtime sends database broadcasts (the driver's positions) as BINARY frames — topic, event and the JSON payload packed after a
 * short header — while its own housekeeping is JSON text. Reading only the text frames saw no position at all.
 */
function readFrame(payload: string | Buffer, positions: string[]) {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8')
  try { collectDriverPositions(JSON.parse(text), positions); return } catch { /* not a JSON text frame */ }
  const packed = /\{[^{}]*"from"\s*:\s*"[0-9a-f-]{36}"[^{}]*\}/.exec(text)
  if (packed) try { collectDriverPositions(JSON.parse(packed[0]), positions) } catch { /* partial frame */ }
}

test('390px local backend: labelled road matches, automatic response, live movement, rating and manual driver journey', async ({ page, browser }) => {
  test.setTimeout(1_800_000) // a real-backend journey: address search, road matching, a 2-minute simulated trip, many page loads (30 min: a busy machine needed 18)
  resetTestUsers()
  // Keep the initial pending response observable even on slow CI/browser hosts.
  // The rollback-only SQL suite independently verifies the configured delay.
  sql(`select public.configure_test_driver('${SIPHO}',true,15,0)`)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const positions: string[] = []
  page.on('websocket', ws => ws.on('framereceived', frame => readFrame(frame.payload, positions)))

  await test.step('normal local OTP signup and explicit saved coordinates', async () => {
    await startSignUp(page, 'passenger', 'Test Passenger', PASSENGER)
    await enterCode(page, PASSENGER.code)
    await expect(page.getByText('Your commuting details')).toBeVisible()
    await selectCoordinates(page, 0, 'Salt Rock Main Road', -29.488331, 31.234003)
    await selectCoordinates(page, 1, 'Umhlanga Ridge', -29.739187, 31.076244)
    await screenshot(page, '01-onboarding-addresses')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Preferred arrival time').selectOption('08:00')
    await page.getByLabel('Return time (leave work)').selectOption('17:00')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('switch', { name: 'Allow live location during commutes' }).check()
    await page.getByRole('button', { name: /Finish/ }).click()
    await expect(page).toHaveURL(/\/p\/home/)
    await screenshot(page, '02-home')
  })
  const passengerId = userId(PASSENGER)
  let requestId = ''

  await test.step('road matches and public driver information', async () => {
    await page.goto('/p/find')
    await page.getByRole('button', { name: /Arrival time/ }).click()
    await page.getByRole('radio', { name: '30 min', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Find Lift Clubs' }).click()
    await expect(page.getByText('Available Lift Clubs')).toBeVisible({ timeout: 60_000 })
    const cards = page.getByRole('button', { name: /View match with/ })
    expect(await cards.count()).toBeGreaterThanOrEqual(3)
    expect(Number(sql('select count(*) from public.profiles where role=\'driver\' and is_test'))).toBe(20)
    await expect(page.getByText('Test driver', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Partial schedule', { exact: true })).toBeVisible()
    await screenshot(page, '03-road-matches')
    const quotes = JSON.parse(sql(`select json_agg(match) from public.match_quotes where passenger_id='${passengerId}'`)) as { routing: string; driver: { id: string; isTest: boolean } }[]
    expect(quotes.every(quote => quote.routing === 'road' && quote.driver.isTest)).toBe(true)
    expect(quotes.some(quote => quote.driver.id === 'e0000000-0000-4000-8000-000000000116')).toBe(false)
    await page.getByRole('button', { name: /View match with Sipho/ }).click()
    await page.getByRole('button', { name: 'View Driver Profile' }).click()
    await expect(page.getByText('Test driver', { exact: true })).toBeVisible()
    await expect(page.getByText('Recent Reviews', { exact: true })).toBeVisible()
    await screenshot(page, '04-public-driver-profile')
    await page.getByText('Recent Reviews', { exact: true }).scrollIntoViewIfNeeded()
    await screenshot(page, '05-public-driver-reviews')
    await page.getByRole('button', { name: 'Go back', exact: true }).click()
  })

  await test.step('server request and automatic acceptance survive reload and sign-in', async () => {
    configureSipho(true, 120) // a long answer delay: the request is certain to still be pending when it is checked…
    await page.getByRole('button', { name: 'Request to Join' }).click()
    await page.getByRole('button', { name: 'Send Request' }).click()
    await expect(page.getByText('Request Sent!')).toBeVisible()
    requestId = sql(`select id from public.join_requests where passenger_id='${passengerId}' order by created_at desc limit 1`)
    expect(sql(`select status from public.join_requests where id='${requestId}'`)).toBe('pending')
    await screenshot(page, '06-request-sent')
    configureSipho(true, 0) // …then the driver answers on the next simulator tick
    await expect(page.getByText('You’re In!')).toBeVisible({ timeout: 30_000 })
    expect(sql(`select status from public.join_requests where id='${requestId}'`)).toBe('accepted')
    await page.reload()
    await expect(page.getByText('You’re In!')).toBeVisible()
    await screenshot(page, '07-accepted')
    await page.getByRole('button', { name: 'View Lift Club Details' }).click()
    await expect(page).toHaveURL(/\/p\/commute/)
    await expect(page.getByText('Test driver', { exact: true })).toBeVisible()
    await screenshot(page, '08-agreed-club')
    await page.goto('/p/inbox')
    await expect(page.getByRole('button', { name: /Sipho.*Morning lift club/ })).toBeVisible()
    await screenshot(page, '09-inbox-restored')
    await page.goto('/p/profile')
    await screenshot(page, '10-profile')
    await page.getByRole('button', { name: 'Sign out', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByText(/Data & demo tools|Reset this device|Demo mode|Become a driver/)).toHaveCount(0)
    await screenshot(page, '11-profile-settings')
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await signInViaUi(page, PASSENGER)
    await expect(page).toHaveURL(/\/p\/home/)
    await page.goto('/p/commute')
    await expect(page.getByText('Test driver', { exact: true })).toBeVisible()
  })

  await test.step('authorized Realtime driver movement, collection, completion and actual rating', async () => {
    // This fixture driver's route STARTS at the rider's pickup (a door pickup, "no walking"), so the simulator holds him there
    // until the rider is collected (45 % of the trip) and only then drives on. A 2-minute trip leaves room for both halves:
    // the screen opens ~15 s in and the simulator ticks every few seconds.
    const instanceId = sql(`select public.begin_test_trip('${requestId}',120)`)
    await page.goto('/p/track')
    await expect(page.getByText('Test driver', { exact: true })).toBeVisible()
    await expect.poll(() => positions.length, { timeout: 40_000 }).toBeGreaterThan(0) // the driver's live position reaches this phone
    await expect(page.locator('[data-driver-marker]')).toBeVisible() // the car marker, on the street map or the illustrative fallback
    await screenshot(page, '12-driver-live-position')
    await expect(page.getByText('On Your Way', { exact: true })).toBeVisible({ timeout: 90_000 })
    await screenshot(page, '13-collected-underway')
    await expect.poll(() => new Set(positions).size, { timeout: 60_000 }).toBeGreaterThanOrEqual(2) // …then the driver drives on along the route
    const before = positions.at(-1)
    await expect.poll(() => positions.at(-1), { timeout: 40_000 }).not.toBe(before)
    await screenshot(page, '14-driver-moved')
    // The trip ends at the destination, so the rider is offered "End my sharing"; "View summary" is the other end state (a trip
    // that ended away from the destination). Either way one tap leads to the completed-commute screen.
    const finish = page.getByRole('button', { name: /^(End my sharing|View summary)$/ })
    await expect(finish).toBeVisible({ timeout: 150_000 })
    await finish.click()
    // (a "Commute completed" toast also appears; the summary HEADING is what proves the driver's confirmation landed). The
    // summary opens as soon as the rider ends sharing and then picks the confirmation up by itself, so no Refresh tap is needed.
    await expect(page.getByRole('heading', { name: 'Commute completed' })).toBeVisible({ timeout: 60_000 })
    await screenshot(page, '15-completed')
    await page.getByRole('button', { name: 'Rate this commute' }).click()
    await expect(page.getByText('How was your experience with Sipho?', { exact: false })).toBeVisible()
    await page.getByRole('radio', { name: '5 stars', exact: true }).click()
    await page.getByRole('button', { name: 'Safe Driving', exact: true }).click()
    await page.getByLabel('Comment').fill('Local browser test: punctual pickup and a comfortable commute.')
    await screenshot(page, '16-rating')
    await page.getByRole('button', { name: 'Submit Review' }).click()
    await expect(page).toHaveURL(/\/p\/home/)
    expect(sql(`select count(*) from public.ratings where instance_id='${instanceId}' and rater_id='${passengerId}' and ratee_id='${SIPHO}'`)).toBe('1')
    await page.goto(`/p/rate?instance=${instanceId}`)
    await expect(page.getByRole('button', { name: 'Submit Review' })).toBeDisabled()
    await page.goto('/history')
    await expect(page.getByText('completed', { exact: true }).first()).toBeVisible()
    await screenshot(page, '17-history')
  })

  await test.step('manual driver account sees a real request and can accept and collect its rider', async () => {
    sql(`select public.configure_test_driver('${SIPHO}',false,5,0)`)
    const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg' })
    const driverPage = await driverContext.newPage()
    try {
      await page.goto('/p/find')
      await page.getByRole('radio', { name: 'Home · evening', exact: true }).click()
      await page.getByRole('button', { name: 'Find Lift Clubs' }).click()
      await expect(page.getByText('Available Lift Clubs')).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: /View match with Sipho/ }).click()
      await page.getByRole('button', { name: 'Request to Join' }).click()
      await page.getByRole('button', { name: 'Send Request' }).click()
      await expect(page.getByText('Request Sent!')).toBeVisible()
      const eveningRequest = sql(`select id from public.join_requests where passenger_id='${passengerId}' order by created_at desc limit 1`)
      await signInViaUi(driverPage, SIPHO_PHONE)
      await expect(driverPage).toHaveURL(/\/d\/home/)
      await screenshot(driverPage, '18-driver-home')
      await driverPage.goto(`/d/request/${eveningRequest}`)
      await expect(driverPage.getByRole('button', { name: 'Accept Passenger' })).toBeVisible()
      await screenshot(driverPage, '19-driver-request')
      await driverPage.getByRole('button', { name: 'Accept Passenger' }).click()
      await expect(driverPage).toHaveURL(/\/d\/requests/)
      await expect(page.getByText('You’re In!')).toBeVisible({ timeout: 30_000 })
      sql(`select public.begin_test_trip('${eveningRequest}',120)`)
      // Retried: on a slow machine the first load can land before the trip is visible. If it does not appear, say what the
      // live "current commute" lookup actually returned, so a failure here explains itself.
      await expect(async () => {
        await driverPage.goto('/d/today')
        try { await expect(driverPage.getByLabel('Passenger pickups')).toBeVisible({ timeout: 10_000 }) } catch (error) {
          console.log('driver /d/today shows no pickup list; get_current_instance returned:', await currentInstanceProbe(driverPage))
          throw error
        }
      }).toPass({ timeout: 120_000 })
      await screenshot(driverPage, '20-driver-pickup-list')
      // the driver is on manual, so the simulator leaves this trip alone and these taps are the only thing moving it
      await driverPage.getByRole('button', { name: 'Arrived at this pickup' }).click({ timeout: 30_000 })
      await driverPage.getByRole('button', { name: /Confirm Test collected/ }).click({ timeout: 30_000 })
      await expect(driverPage.getByRole('button', { name: 'Finish commute' })).toBeEnabled()
      await screenshot(driverPage, '21-driver-collected')
      await driverPage.getByRole('button', { name: 'Finish commute' }).click()
      await expect(driverPage).toHaveURL(/\/history/)
      await driverPage.goto('/d/profile')
      await expect(driverPage.getByText('Test driver', { exact: true })).toBeVisible()
      await expect(driverPage.getByText(/Data & demo tools|Reset this device|Become a passenger/)).toHaveCount(0)
      await screenshot(driverPage, '22-driver-profile')
    } catch (error) {
      // the automatic failure screenshot only covers the rider's page: keep the driver's view too
      await driverPage.screenshot({ path: 'test-results-local/driver-page-at-failure.png' }).catch(() => undefined)
      throw error
    } finally {
      sql(`select public.configure_test_driver('${SIPHO}',true,5,0)`)
      await driverContext.close()
    }
  })
  expect(errors).toEqual([])
})
