# Local backend testing and staging preparation

## Targets and safety

All included fixture, simulator and database tools target the fixed Docker container `supabase_db_lifty-e2e`, database port **57322**. The gateway is **57330**, Supabase API **57321**, and the test app **5180**. Arbitrary directories, non-loopback targets and other local databases are rejected.

The stack stages canonical migrations and the replacement test seed in ignored `.local-stack/`. It disables local cron jobs so the fixture environment cannot invoke hosted workers. These instructions do not change the hosted project.

## Start and view

Install with `npm ci`; run Docker. Put the public Mapbox token in ignored `.env` as `VITE_MAPBOX_TOKEN`, or give the local gateway a server `MAPBOX_TOKEN`. Matching uses the same real handler as the Edge Function; the gateway loads its routing token server-side.

Run in separate terminals:

```text
npm run stack:up
npm run stack:gateway
npm run test:simulation
npm run dev:local
```

Open http://127.0.0.1:5180. The app connects to the local backend. Sign up with a fake passenger number listed under `auth.sms.test_otp` in `supabase/local-e2e/config.toml`, using its fixed code. These identities never send SMS. See the config for all driver phone identities; use `npm run test:drivers -- list` for fixture UUIDs. Driver accounts already exist: use **Sign in**.

The test drivers have fictional names, vehicles and completed trip reviews. Every profile/card carries a Test driver label. Routes cover Salt Rock, Ballito, Umhlali, Sheffield, Shaka's Rock, Umhlanga, Durban and King Shaka Airport. Seeded routes were measured with Mapbox; current matching remeasures walking and driver detours.

For a covered example, choose Salt Rock Main Road → Umhlanga Ridge, weekdays, 750 m maximum walking and arrival window 07:30–08:00. Partial drivers cover explicitly labelled subsets. Ballito also has coverage. A remote area and an arrival-after-08:00 driver are negative cases; filters are not relaxed to manufacture matches.

## Requests and trips

Automatic drivers respond after the configured delay while `test:simulation` runs. To exercise a human driver response, set a fixture to manual and sign in with its local driver identity:

```text
npm run test:simulation -- manual <test-driver-uuid>
npm run test:simulation -- automatic <test-driver-uuid>
npm run test:simulation -- decline <test-driver-uuid> 100
```

Decline accepts a percentage from 0 to 100. Default automatic settings use a 5-second delay with no forced decline.

After acceptance, start a labelled test trip using its real request UUID:

```text
npm run test:simulation -- start-trip <accepted-test-request-uuid> 90
```

Duration accepts 30–3600 seconds. The server moves the driver, publishes through authorized participant channels, changes arrival/collection state and completes the trip through normal APIs. It stops publishing on completion. A driver set to **manual** is left entirely to the person driving: the server neither answers requests nor moves, arrives or collects for them, so the driver account’s own taps (arrived, collected, finish) are the only thing that moves the trip. Only automatic drivers are driven by the simulator. Ratings require the completed instance and actual participant.

## Reproducible checks

Stop `dev:local` first; browser tests start their own app on 5180.

```text
npm run check
npm run test:browser -- tests/browser/pilot.spec.ts tests/browser/session.spec.ts --workers=1
npm run test:e2e:local
npm run test:coverage
npm run test:isolation
npm run test:lifecycle
npm run test:safety
npm run check:secrets
```

Map-specific tests use `npx playwright test -c playwright.map.config.ts`. Each suite owns its server; avoid duplicate suite runs on the same port. Reports/traces are ignored because they may contain local sessions. Only reviewed PNG screenshots go into `docs/review/`.

For a shorter real-backend acceptance check, run `npm run test:e2e:local -- tests/e2e-local/manual-accept.spec.ts`. It signs up a local passenger, obtains a real road quote, signs in the test driver, accepts through the normal UI and checks both accounts after reload. It does not simulate a trip. Auth and routing stay real; external fonts are intercepted so a font outage cannot stall the check.

`npm run test:e2e:local` needs the sandbox and `npm run stack:gateway` running, but **not** a separately started simulator: the long journey test starts its own simulator process (its log is kept in `test-results-local/simulator.log`) and fixture drivers answer on their own only where a test wants that. Tests that inspect a *pending* request put the fixture drivers on manual first and restore their settings afterwards. A simulator you started yourself is harmless but unnecessary, and it will answer requests during a test run that you expected to stay pending, so stop it first.

The suite can be run repeatedly: each file removes the accounts earlier runs left on the three reserved fake numbers and gives back the seats their memberships held (a plain `delete from auth.users` does not restore a driver's seat counter, and fixture drivers would vanish from results run after run). If a fixture driver is missing from results anyway, rebuild the sandbox from scratch with `npm run stack:down` then `npm run stack:up`.

The sandbox raises Auth's hourly SMS cap (`sms_sent`) because one full run requests about 20 codes; the per-number gap between codes is unchanged and is what the "second code straight away" test exercises.

Isolation, lifecycle and safety assertions are rollback-only. The safety suite verifies cleanup preserves an unrelated account, seed modes stay unchanged, and fixture notifications cannot be dispatched as real push. Coverage checks use temporary searches and roll back. The original pilot database suite and concurrency check require a local URL:

```powershell
$env:LIFTY_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:57322/postgres'
npm run test:db
npm run test:race
Remove-Item Env:LIFTY_TEST_DATABASE_URL
```

Run `npm run types:local` after schema changes. It verifies its local target and does not query a hosted project.

For an exact fresh migration replay, `node scripts/verify-fresh-schema.mjs` creates a separate disposable database on **58322**. It checks all migrations, fixture counts and the three rollback suites. If that replay target already exists, the script refuses to reuse it; `node scripts/verify-fresh-schema.mjs stop` verifies and removes only that disposable target before a fresh run. The browser sandbox on 57322 and other projects stay untouched.

## Cleanup and reseed

Stop the simulator and browser suites before cleanup. The tool verifies the fixed container and local mode, requires explicit confirmation and deletes only test-labelled fixture IDs and pickup rows.

```text
npm run test:drivers -- cleanup --confirm-lifty-e2e
npm run test:drivers -- seed
```

No normal account is part of fixture cleanup. Do not execute either legacy cleanup or replacement cleanup in a hosted project. Legacy `remove-demo-lifts.sql` now refuses execution.

## Staging proposal — not applied

Prepare a separate non-production Supabase target and reconcile its migrations before applying the isolation migration. Its default mode is disabled; no fixture is visible. Stage only reviewed migration/seed SQL against the explicitly identified staging target. Server credentials and routing keys stay in backend secrets.

A backend operator must set `lifty_private.test_environment.mode` to `staging` and put designated authenticated user UUIDs in `lifty_private.testers`. Unlisted users cannot search, view, request or receive test locations; the client cannot grant itself access. The simulator functions require service-role access and enabled test mode. They are not browser endpoints.

The reviewed seed also requires a transaction-local `lifty.nonproduction_seed` marker matching the already-enabled mode: `LOCAL_LIFTY_ONLY` for local, or `STAGING_LIFTY_ONLY` for staging. It refuses disabled or mismatched targets and never enables or changes a mode itself. Local runners set the local marker only after verifying their fixed Docker target; no staging SQL is executed by them.

Fixture notifications stay in the app. They retain the source trip/leg, become hidden when test access is withdrawn, and are excluded from FCM claims and final per-token dispatch even for an allowlisted tester with a real device token.

The local policy suite exercises disabled, local and staging-allowlist modes against actual Postgres. No remote staging environment was provisioned or verified in this request. Do not enable test visibility on the production project.

