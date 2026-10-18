import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { DRIVER, enterCode, sql, startSignUp } from './helpers'

async function coordinates(page: Page, index: number, label: string, lat: number, lng: number) {
  await page.getByRole('button', { name: /^(Choose on map|Enter coordinates)$/ }).nth(index).click()
  const manual = page.getByRole('button', { name: 'Enter coordinates manually' })
  if (await manual.isVisible()) await manual.click({ timeout: 3000 }).catch(async () => { await expect(page.getByLabel('Latitude', { exact: true })).toBeVisible() })
  await page.getByLabel('Location label', { exact: true }).fill(label)
  await page.getByLabel('Latitude', { exact: true }).fill(String(lat))
  await page.getByLabel('Longitude', { exact: true }).fill(String(lng))
  await page.getByRole('button', { name: 'Use this spot' }).click()
}

async function cleanupCreatedDriver(created: string) {
  expect(created).toMatch(/^[0-9a-f-]{36}$/)
  const status = execSync('npx --no-install supabase status --workdir .local-stack -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const key = status.split(/\r?\n/).find(line => line.startsWith('SERVICE_ROLE_KEY='))?.slice(17).replace(/^"|"$/g, '')
  if (!key) throw new Error('Local-only cleanup credentials unavailable')
  const admin = createClient('http://127.0.0.1:57321', key, { auth: { persistSession: false } })
  const files = await admin.storage.from('kyc').list(created)
  if (files.error) throw new Error('Local upload cleanup could not list owned files')
  if (files.data?.length) {
    const cleanup = await admin.storage.from('kyc').remove(files.data.map(file => `${created}/${file.name}`))
    if (cleanup.error) throw new Error('Local upload cleanup failed')
  }
  sql(`delete from auth.users where id='${created}' and phone='${DRIVER.digits}'`)
}

test('fresh driver completes real local onboarding with persisted preferences and pending human verification', async ({ page }) => {
  test.setTimeout(300_000)
  // Refuse to reset a manually reviewed account. Other suites can clean their
  // reserved identities first; this test only removes the account it creates.
  expect(sql(`select count(*) from auth.users where phone='${DRIVER.digits}'`), 'Reserved driver phone must be unused before this test; no existing account is reset').toBe('0')
  let created: string | undefined
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://api.mapbox.com/styles/**', route => route.abort())
  // Real Auth, Storage, database RPCs and driving directions remain connected.
  try {
    await startSignUp(page, 'driver', 'Local Driver', DRIVER)
    await enterCode(page, DRIVER.code)
    await expect(page.getByRole('heading', { name: 'Vehicle information' })).toBeVisible()
    created = sql(`select id from auth.users where phone='${DRIVER.digits}'`)
    expect(created).toMatch(/^[0-9a-f-]{36}$/)
    await page.getByLabel('Full name', { exact: true }).fill('Onboarding Reviewer')
    await page.getByLabel('Registration number').fill('ND TEST222')
    await page.getByLabel('Make', { exact: true }).fill('Volkswagen')
    await page.getByLabel('Model', { exact: true }).fill('Polo Vivo')
    await page.getByLabel('Year', { exact: true }).fill('2022')
    await page.getByLabel('Colour', { exact: true }).fill('Silver')
    await page.getByRole('radio', { name: 'Hatch', exact: true }).click()
    await expect(page.getByRole('img', { name: /Silver 2022 Volkswagen Polo Vivo.*AI model illustration/ })).toBeVisible()
    mkdirSync('test-results-local/shots', { recursive: true })
    await page.screenshot({ path: 'test-results-local/shots/driver-onboarding-vehicle.png', fullPage: true })
    await page.getByRole('img', { name: /Silver 2022 Volkswagen Polo Vivo.*AI model illustration/ }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results-local/shots/driver-onboarding-car-illustration.png', fullPage: true })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your regular commute' })).toBeVisible()
    expect(sql(`select p.first_name||' '||q.last_name from public.profiles p join public.profile_private q on q.id=p.id where p.id='${created}'`)).toBe('Onboarding Reviewer')
    await coordinates(page, 0, 'Salt Rock Main Road', -29.488331, 31.234003)
    await coordinates(page, 1, 'Umhlanga Ridge', -29.739187, 31.076244)
    await page.getByLabel('How would you like to pick passengers up?').selectOption('meeting_point')
    await page.getByRole('slider', { name: 'Maximum detour for pickups' }).fill('12')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Verification documents' })).toBeVisible()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Verification documents' })).toBeVisible()
    const draft = JSON.parse(sql(`select draft from lifty_private.driver_onboarding_drafts where user_id='${created}'`))
    expect(draft.commute).toMatchObject({ pickupPolicy: 'meeting_point', maxDeviationMin: 12 })
    await page.getByLabel("Driver's licence expiry date").fill('2028-12-31')
    await page.getByLabel('Proof of insurance expiry date').fill('2028-12-31')
    for (const [index, label] of ['South African ID', "Driver's licence", 'Vehicle registration', 'Proof of insurance'].entries()) {
      // Synthetic test evidence proves upload/pending state only. Never approved.
      await page.locator('input[type=file]').nth(index).setInputFiles({ name: `TEST-ONLY-${index}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% SYNTHETIC LOCAL TEST DOCUMENT - NOT IDENTITY EVIDENCE\n%%EOF') })
      await expect(page.getByRole('button', { name: `${label}: uploaded`, exact: true })).toBeVisible()
    }
    expect(sql(`select count(*) from public.verification_documents where user_id='${created}' and status='pending'`)).toBe('4')
    expect(sql(`select count(*) from public.verification_documents where user_id='${created}' and status='verified'`)).toBe('0')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Review your driver setup' })).toBeVisible()
    await expect(page.getByText('Verification: 0/4 documents approved.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Finish set-up', exact: true })).toBeEnabled({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Finish set-up', exact: true }).click()
    await expect(page).toHaveURL(/\/d\/home$/, { timeout: 60_000 })
    const legs = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('policy',pickup_policy,'detour',max_deviation_min)) from public.driver_legs where driver_id='${created}'`))
    expect(legs).toHaveLength(2)
    for (const leg of legs) expect(leg).toEqual({ policy: 'meeting_point', detour: 12 })
    expect(sql(`select public.driver_approved('${created}')`)).toBe('f')
    expect(sql(`select count(*) from lifty_private.driver_onboarding_drafts where user_id='${created}'`)).toBe('0')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/d\/home$/)
    await expect(page.getByText('Driver setup', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    // Capture only this initially absent reserved identity, even on a signup error.
    created ||= sql(`select id from auth.users where phone='${DRIVER.digits}'`) || undefined
    if (created) await cleanupCreatedDriver(created)
  }
})
