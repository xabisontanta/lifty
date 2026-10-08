import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('Vercel serves phone review assets directly and still rewrites application routes', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const rewrite = new RegExp(`^${config.rewrites[0].source}$`)
  for (const file of ['/review.html', '/review-qr.png', '/review-qr.json', '/manifest.webmanifest', '/icons/lifty-192.png']) {
    expect(rewrite.test(file), `${file} must bypass the app fallback`).toBe(false)
  }
  expect(rewrite.test('/p/track')).toBe(true)
  expect(rewrite.test('/d/home')).toBe(true)
  expect(rewrite.test('/')).toBe(true)
})

test('QR destinations contain no session data and install icons have the declared sizes', () => {
  const qr = JSON.parse(readFileSync('public/review-qr.json', 'utf8'))
  const target = new URL(qr.url)
  expect(target.href).toBe('https://lifty-ten.vercel.app/')
  expect(target.search).toBe('')
  expect(target.hash).toBe('')
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
  for (const size of [192, 512]) {
    expect(manifest.icons).toContainEqual({ src: `/icons/lifty-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })
    const png = readFileSync(`public/icons/lifty-${size}.png`)
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
  }
})
