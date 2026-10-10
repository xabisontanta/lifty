import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Isolate map regression checks from the other browser suites using a second local port. */
export default defineConfig({
  ...base,
  testMatch: 'map-location.spec.ts',
  timeout: 90_000,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5177', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5177 --strictPort', url: 'http://127.0.0.1:5177', reuseExistingServer: false, env: { VITE_MAPBOX_TOKEN: 'pk.map-browser-test' } },
  outputDir: 'test-results-map',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-map' }]],
})
