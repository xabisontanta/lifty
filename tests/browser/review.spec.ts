import { expect, test } from '@playwright/test'

test('phone review uses a same-origin interactive frame and a public QR destination', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 980 })
  await page.goto('/review.html')
  await expect(page.getByRole('heading', { name: 'Your daily commute, in your pocket.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'lifty-ten.vercel.app' })).toHaveAttribute('href', 'https://lifty-ten.vercel.app/')
  await expect(page.locator('iframe')).toHaveAttribute('src', '/')
  await expect(page.frameLocator('iframe').getByRole('button', { name: /Get started/i })).toBeVisible()
  const qr = await page.request.get('/review-qr.png')
  expect(qr.ok()).toBeTruthy()
  expect((await qr.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
})

test('phone review launches the app without loading a hidden authenticated frame on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/review.html')
  await expect(page.locator('iframe')).not.toHaveAttribute('src', '/')
  await expect(page.getByRole('link', { name: 'Open Lifty' })).toHaveAttribute('href', '/')
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  expect(await manifest.json()).toMatchObject({ scope: '/', start_url: '/', display: 'standalone' })
  await page.getByRole('link', { name: 'Open Lifty' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
})
