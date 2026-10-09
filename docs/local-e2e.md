# Local end-to-end sandbox

A throwaway Supabase in Docker, built from the **real** migrations and seeds, so sign-up, sign-in, search and booking can be tested end to end without SMS and without touching the live project.

## What it is
- `supabase/local-e2e/config.toml` — sandbox config (ports 573xx so it never clashes with other local databases). Phone sign-in is on; the numbers under `[auth.sms.test_otp]` are **fake** and their fixed codes are the only way in — no SMS is ever sent.
  The dummy `[auth.sms.twilio]` block exists only because the CLI switches the phone provider on when an SMS provider is enabled; test numbers never reach it.
- `scripts/local-stack.mjs` — stages `.local-stack/` (git-ignored) from `supabase/migrations`, `seed.sql` + `seed-demo-lifts.sql` and the config, then starts/stops it.
- `scripts/local-gateway.mjs` — one URL for the app (`http://127.0.0.1:57330`): serves the **real** `find-matches` handler and proxies everything else (REST, Auth, Realtime) to the sandbox. Docker here cannot mount the functions folder into Supabase's edge runtime, so Node runs the same code.
- `tests/e2e-local/` + `playwright.local.config.ts` — phone-sized (390×844) browser tests.

## Run it
```
npm run stack:up          # first run pulls images; a minute or two
npm run stack:gateway     # leave this running (second terminal)
npm run test:e2e:local    # starts Vite on :5180 pointed at the sandbox
npm run stack:down
```
Needs Docker, and `VITE_MAPBOX_TOKEN` in `.env` (address search and routing are real).

## What the tests cover
Sign up with a texted code → onboarding → search returns real road-measured lifts (saved as quotes) → request to join (stored as `pending` with the road figures) → sign out → sign back in (the pending request survives). Also: sign-in with a number that has no account, a wrong code, driver sign-up, and the demo-mode notice.

`node scripts/check-demo-coverage.mjs` (sandbox up, after one e2e run) checks that realistic searches return lifts in KZN, Gauteng and the Western Cape through the real pipeline, and that an uncovered area returns nothing.

## Never against the live project
The tests delete and recreate their fake users (`delete from auth.users where phone in (…)`) — only ever in the sandbox container `supabase_db_lifty-e2e`.
