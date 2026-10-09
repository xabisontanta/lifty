// Builds supabase/local-e2e/config.toml from the CLI's generated defaults.
// Usage: node scripts/make-local-config.mjs <generated-config.toml> <out.toml>
// The sandbox is for end-to-end tests only: fake phone numbers with fixed OTP codes, no real SMS, no secrets.
import { readFileSync, writeFileSync } from 'node:fs'
const [src, out] = process.argv.slice(2)
let t = readFileSync(src, 'utf8').replace(/\r\n/g, '\n')

/** set `key = value` inside [section] (first occurrence in that section) */
function set(section, key, value) {
  const lines = t.split('\n')
  let inSec = false
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^\[(.+)\]\s*$/)
    if (h) inSec = h[1] === section
    else if (inSec && lines[i].replace(/^#\s*/, '').startsWith(`${key} =`)) { lines[i] = `${key} = ${value}`; t = lines.join('\n'); return }
  }
  throw new Error(`not found: [${section}] ${key}`)
}

t = t.replace(/^project_id = ".*"/m, 'project_id = "lifty-e2e"')
set('api', 'port', 57321)
set('db', 'port', 57322)
set('db', 'shadow_port', 57320)
set('studio', 'enabled', 'false'); set('studio', 'port', 57323)
set('local_smtp', 'enabled', 'false'); set('local_smtp', 'port', 57324)
// realtime + storage stay ON: the real migrations create policies on realtime.messages and rows in storage.buckets
set('storage.s3_protocol', 'enabled', 'false')
set('edge_runtime', 'enabled', 'false') // Docker here cannot mount the functions folder; scripts/local-gateway.mjs serves them
set('analytics', 'enabled', 'false'); set('analytics', 'port', 57327)
set('auth', 'site_url', '"http://127.0.0.1:5180"')
set('auth', 'additional_redirect_urls', '["http://127.0.0.1:5180"]')
set('auth.sms', 'enable_signup', 'true')
set('auth.sms', 'enable_confirmations', 'true')

// The CLI only switches the phone provider on when an SMS provider is enabled. Test numbers never reach it, so these
// dummy values are never used and no SMS can leave the sandbox.
set('auth.sms.twilio', 'enabled', 'true')
set('auth.sms.twilio', 'account_sid', '"ACsandboxnotused"')
set('auth.sms.twilio', 'message_service_sid', '"MGsandboxnotused"')
set('auth.sms.twilio', 'auth_token', '"sandbox-not-used"')

// Fake South African numbers with fixed codes: no SMS is ever sent. Local sandbox only.
t = t.replace('# [auth.sms.test_otp]\n# 4152127777 = "123456"', '[auth.sms.test_otp]\n27820000001 = "123456"\n27820000002 = "123456"\n27820000003 = "123456"')
writeFileSync(out, t)
console.log('wrote', out)
