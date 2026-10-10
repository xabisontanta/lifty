import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { enterCode, markCodeRequested, waitForCodeAllowance } from './helpers'

/** Sandbox API address (the gateway) and anon key (from `supabase status`), for tests that talk to Auth directly. */
let cached: { url: string; anon: string } | null = null
export function sandbox() {
  if (cached) return cached
  const out = execFileSync('npx', ['--no-install', 'supabase', 'status', '--workdir', '.local-stack', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const get = (k: string) => out.split(/\r?\n/).find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).replace(/^"|"$/g, '') ?? ''
  cached = { url: `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 57330}`, anon: get('ANON_KEY') }
  return cached
}

/** Sign in an existing account through the screens: number → code. */
export async function signInViaUi(page: Page, p: { national: string; code: string }) {
  await page.goto('/signin')
  await page.getByLabel('Mobile number').fill(p.national)
  await waitForCodeAllowance(p)
  await page.getByRole('button', { name: 'Send code' }).click()
  markCodeRequested(p)
  await page.getByText('Verify your number').waitFor({ timeout: 30_000 }) // bounded: a refused code request must fail here, not hang the test
  await enterCode(page, p.code)
}
