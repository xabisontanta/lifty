import { execSync } from 'node:child_process'
import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests against the LOCAL sandbox (real migrations, real Auth, real seeds, real find-matches handler; fixed OTP codes for
 * fake numbers, no SMS, no live data). Start it first:
 *   node scripts/local-stack.mjs up        (once; a minute or two)
 *   node scripts/local-stack.mjs gateway   (leave running)
 *   npm run test:e2e:local
 */
const stack = Object.fromEntries(
  execSync('npx --no-install supabase status --workdir .local-stack -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }),
)
const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 57330}`

export default defineConfig({
  testDir: 'tests/e2e-local',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://127.0.0.1:5180',
    channel: process.env.LIFTY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
    headless: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, // software WebGL so the maps render headless
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
    geolocation: { latitude: -29.5378, longitude: 31.2105 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: gateway, VITE_SUPABASE_ANON_KEY: stack.ANON_KEY },
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-local' }]],
  outputDir: 'test-results-local',
})
