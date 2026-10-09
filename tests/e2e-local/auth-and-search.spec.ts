import { expect, test } from '@playwright/test'
import { DRIVER, NEWBIE, PASSENGER, WRONG_CODE, enterCode, pickAddress, resetTestUsers, shot, sql, startSignUp, userId } from './helpers'

test.beforeAll(() => {
  resetTestUsers() // sandbox only
})

test('passenger journey: sign up → onboard → search → request a lift → sign out → sign back in', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await test.step('sign up with a texted code', async () => {
    await startSignUp(page, 'passenger', 'Test Passenger', PASSENGER)
    await expect(page.getByText('Verify your number')).toBeVisible()
    await shot(page, '01-code-screen')
    await enterCode(page, PASSENGER.code)
    await expect(page.getByText('Your commuting details')).toBeVisible()
    expect(sql(`select p.role from public.profiles p join auth.users u on u.id = p.id where u.phone = '${PASSENGER.digits}'`)).toBe('passenger')
  })

  await test.step('onboarding: home, work, schedule, privacy', async () => {
    await pickAddress(page, 'Home address', 'Ballito Drive, Ballito', /Ballito/)
    await pickAddress(page, 'Work / study address', 'Umhlanga Ridge', /Umhlanga/)
    await shot(page, '02-onboarding-addresses')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByText('Your travel schedule')).toBeVisible()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByText('Your privacy, your control')).toBeVisible()
    await page.getByRole('button', { name: /Finish/ }).click()
    await expect(page).toHaveURL(/\/p\/home/)
    await shot(page, '03-home')
    const id = userId(PASSENGER)
    expect(sql(`select count(*) from public.passenger_commutes where passenger_id = '${id}'`)).toBe('1')
    // the saved destination is where the passenger meant (Umhlanga), not a namesake elsewhere
    expect(Number(sql(`select st_distance(destination, st_setsrid(st_makepoint(31.0762, -29.7392), 4326)::geography)::int from public.passenger_commutes where passenger_id = '${id}'`))).toBeLessThan(4000)
    expect(sql(`select (onboarding_completed_at is not null)::text from public.profiles where id = '${id}'`)).toBe('true')
  })

  await test.step('search returns real, road-measured lifts', async () => {
    await page.getByRole('link', { name: /Find Lifts/ }).click()
    await page.getByRole('button', { name: 'Find Lift Clubs' }).click()
    await expect(page.getByText('Available Lift Clubs')).toBeVisible({ timeout: 60_000 })
    const cards = page.getByRole('button', { name: /View match with/ })
    expect(await cards.count()).toBeGreaterThanOrEqual(3)
    await shot(page, '04-results')
    // what the database stored is what was shown
    const id = userId(PASSENGER)
    expect(Number(sql(`select count(*) from public.match_quotes where passenger_id = '${id}'`))).toBeGreaterThanOrEqual(3)
    expect(sql(`select count(distinct match->>'routing') from public.match_quotes where passenger_id = '${id}'`)).toBe('1')
    expect(sql(`select distinct match->>'routing' from public.match_quotes where passenger_id = '${id}'`)).toBe('road')
  })

  await test.step('open a lift and request to join', async () => {
    await page.getByRole('button', { name: /View match with/ }).first().click()
    await expect(page.getByText('Why this works')).toBeVisible()
    await shot(page, '05-detail')
    await page.getByRole('button', { name: 'Request to Join' }).click()
    await shot(page, '06-confirm')
    await page.getByRole('button', { name: 'Send Request' }).click()
    await expect(page.getByText('Request Sent!')).toBeVisible({ timeout: 30_000 })
    await shot(page, '07-request-sent')
    const id = userId(PASSENGER)
    expect(sql(`select status from public.join_requests where passenger_id = '${id}'`)).toBe('pending')
    expect(sql(`select match_snapshot->>'routing' from public.join_requests where passenger_id = '${id}'`)).toBe('road')
  })

  await test.step('sign out', async () => {
    await page.goto('/p/profile')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/welcome/)
    await shot(page, '08-signed-out')
  })

  await test.step('sign back in with the same number', async () => {
    await page.getByRole('button', { name: /I already have an account/ }).click()
    await page.getByLabel('Mobile number').fill(PASSENGER.national)
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.getByText('Verify your number')).toBeVisible()
    await enterCode(page, PASSENGER.code)
    await expect(page).toHaveURL(/\/p\/home/)
    await shot(page, '09-signed-back-in')
    await expect(page.getByText('Request awaiting driver response')).toBeVisible() // the pending request survived the sign-out
  })

  expect(errors).toEqual([])
})

test('sign-in with a number that has no account explains that — it does not claim phone sign-in is off', async ({ page }) => {
  await page.goto('/signin')
  await page.getByLabel('Mobile number').fill(NEWBIE.national)
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('No account for this number')).toBeVisible()
  await expect(page.getByText(/isn’t switched on/)).toHaveCount(0)
  await shot(page, '10-no-account')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/role/)
})

test('a wrong code is rejected with a clear message, then the right code works (driver sign-up)', async ({ page }) => {
  await startSignUp(page, 'driver', 'Test Driver', DRIVER)
  await expect(page.getByText('Verify your number')).toBeVisible()
  await enterCode(page, WRONG_CODE)
  await expect(page.getByText(/wrong or has expired/i)).toBeVisible()
  await shot(page, '11-wrong-code')
  await enterCode(page, DRIVER.code)
  await expect(page.getByText('Vehicle information')).toBeVisible()
  expect(sql(`select p.role from public.profiles p join auth.users u on u.id = p.id where u.phone = '${DRIVER.digits}'`)).toBe('driver')
})

test('a device left in demo mode is told so, and can switch to real accounts', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return // only on the first load, so the switch to live sticks
    sessionStorage.setItem('seeded', '1')
    sessionStorage.setItem('lifty.source', 'demo')
  })
  await page.goto('/signin')
  await expect(page.getByText('Demo mode is on')).toBeVisible()
  await shot(page, '12-demo-notice')
  await page.getByRole('button', { name: 'Use real accounts' }).click()
  await expect(page).toHaveURL(/\/welcome/)
  expect(await page.evaluate(() => sessionStorage.getItem('lifty.source'))).toBeNull()
})
