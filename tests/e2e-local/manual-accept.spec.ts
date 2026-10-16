import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { signInViaUi } from './auth-helpers'
import { PASSENGER, enterCode, resetTestUsers, sql, startSignUp, userId } from './helpers'

const SIPHO = 'e0000000-0000-4000-8000-000000000101'
const SIPHO_PHONE = { national: '820000101', code: '123456' }

async function manualAddress(page: Page, index: number, label: string, lat: number, lng: number) {
  await page.getByRole('button', { name: /^(Choose on map|Enter coordinates)$/ }).nth(index).click()
  const manual = page.getByRole('button', { name: 'Enter coordinates manually' })
  if (await manual.isVisible()) await manual.click()
  await page.getByLabel('Location label', { exact: true }).fill(label)
  await page.getByLabel('Latitude', { exact: true }).fill(String(lat))
  await page.getByLabel('Longitude', { exact: true }).fill(String(lng))
  await page.getByRole('button', { name: 'Use this spot' }).click()
}

test('current manual driver accepts a fresh road quote through the normal UI and restores the accepted state', async ({ page, browser }) => {
  test.setTimeout(300_000) // real road routing, two OTP sessions, reloads and scoped database cleanup
  resetTestUsers() // only the three reserved local fake phone numbers; restores seats first
  const settings = JSON.parse(sql(`select json_build_object('auto',auto_respond,'delay',response_delay_seconds,'decline',decline_percent) from lifty_private.test_driver_settings where driver_id='${SIPHO}'`))
  sql(`select public.configure_test_driver('${SIPHO}',false,5,0)`)
  const driverContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5180', viewport: { width: 390, height: 844 }, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg' })
  const driverPage = await driverContext.newPage()
  try {
    // Keep Auth, matching and acceptance real; font availability is unrelated.
    for (const current of [page, driverPage]) {
      await current.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
      await current.route('https://fonts.gstatic.com/**', route => route.abort())
    }
    await startSignUp(page, 'passenger', 'Test Passenger', PASSENGER)
    await enterCode(page, PASSENGER.code)
    await expect(page.getByText('Your commuting details')).toBeVisible()
    await manualAddress(page, 0, 'Salt Rock Main Road', -29.488331, 31.234003)
    await manualAddress(page, 1, 'Umhlanga Ridge', -29.739187, 31.076244)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Preferred arrival time').selectOption('08:00')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: /Finish/ }).click()
    await expect(page).toHaveURL(/\/p\/home/)
    await page.goto('/p/find', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Arrival time/ }).click()
    await page.getByRole('radio', { name: '30 min', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Find Lift Clubs' }).click()
    await expect(page.getByText('Available Lift Clubs')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /View match with Sipho/ }).click()
    const [statsResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/rpc/get_driver_trip_stats')),
      page.getByRole('button', { name: 'View Driver Profile' }).click(),
    ])
    expect(statsResponse.ok()).toBe(true)
    const stats = await statsResponse.json()
    expect(stats.completedTrips).toBeGreaterThan(0)
    await expect(page.locator('.metric').filter({ hasText: 'Completed trips' }).locator('.metric-value')).toHaveText(String(stats.completedTrips))
    await expect(page.getByText(`${stats.reliability}% reliable`, { exact: true })).toBeVisible()
    mkdirSync('docs/review/local-390', { recursive: true })
    await page.screenshot({ path: 'docs/review/local-390/04-public-driver-profile.png' })
    await page.getByText('Recent Reviews', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'docs/review/local-390/05-public-driver-reviews.png' })
    await page.getByRole('button', { name: 'Go back', exact: true }).click()
    await page.getByRole('button', { name: 'Request to Join' }).click()
    await page.getByRole('button', { name: 'Send Request' }).click()
    await expect(page.getByText('Request Sent!')).toBeVisible()
    const requestId = new URL(page.url()).searchParams.get('request')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sql(`select match_snapshot->>'routing' from public.join_requests where id='${requestId}'`)).toBe('road')

    await signInViaUi(driverPage, SIPHO_PHONE)
    await expect(driverPage).toHaveURL(/\/d\/home/)
    await driverPage.goto(`/d/request/${requestId}`, { waitUntil: 'domcontentloaded' })
    await expect(driverPage.getByRole('button', { name: 'Accept Passenger' })).toBeEnabled()
    mkdirSync('docs/review/local-390', { recursive: true })
    await driverPage.screenshot({ path: 'docs/review/local-390/manual-accept-request-390.png' })
    const acceptStarted = Date.now()
    const [response] = await Promise.all([
      driverPage.waitForResponse(response => response.url().endsWith('/rpc/respond_to_request') && response.request().method() === 'POST'),
      driverPage.getByRole('button', { name: 'Accept Passenger' }).click(),
    ])
    const responseText = await response.text()
    expect(response.ok(), responseText).toBe(true)
    await expect(driverPage).toHaveURL(/\/d\/requests/)
    console.log(`Manual acceptance RPC returned ${response.status()} in ${Date.now() - acceptStarted}ms`)
    await expect(driverPage.getByText('Accepted', { exact: true }).first()).toBeVisible()
    await driverPage.reload({ waitUntil: 'domcontentloaded' })
    await expect(driverPage.getByText('Accepted', { exact: true }).first()).toBeVisible()
    await driverPage.screenshot({ path: 'docs/review/local-390/manual-accept-persisted-390.png' })
    await expect(page.getByText('You’re In!', { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText('You’re In!', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'docs/review/local-390/manual-accept-passenger-390.png' })
    const passengerId = userId(PASSENGER)
    expect(sql(`select status from public.join_requests where id='${requestId}' and passenger_id='${passengerId}'`)).toBe('accepted')
    expect(sql(`select count(*) from public.club_members where request_id='${requestId}' and passenger_id='${passengerId}' and active`)).toBe('1')
  } catch (error) {
    await driverPage.screenshot({ path: 'test-results-local/manual-driver-page-at-failure.png' }).catch(() => undefined)
    throw error
  } finally {
    await driverContext.close()
    // Restore only the reserved fixture accounts and the one test driver's operator setting.
    resetTestUsers()
    sql(`select public.configure_test_driver('${SIPHO}',${settings.auto},${settings.delay},${settings.decline})`)
  }
})
