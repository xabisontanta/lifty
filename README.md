# Lifty — recurring commuter lift clubs

Lifty matches recurring commuters with approved drivers along their route. The app uses React 18, TypeScript and Vite, with Capacitor 8 for Android. Designs are in [design/README.md](design/README.md).

The driver review branch and local preview instructions are documented in [Driver pilot review](docs/driver-pilot-review.md). Keep main and the hosted project unchanged until preview review and the remaining device/provider checks are complete.

## Development

Use Node 24 and npm. Docker is required for the isolated backend.

```text
npm ci
npm run dev
npm run check
```

For a configured backend, supply the public Supabase URL/key and the public Mapbox token in an ignored `.env` file using `.env.example`. Never put a service-role key, SMS credentials, or a server Mapbox secret in a VITE variable. The matching Edge Function reads only its server `MAPBOX_TOKEN`.

The app always uses its configured backend. Missing configuration shows a setup error. Profile has no demo switch or data reset. Signing out clears account-specific state and tracking subscriptions.

## Stack

| Layer | Choice |
|---|---|
| App | React 18 + TypeScript + Vite, wrapped as a native app with **Capacitor 8** (Android project in `android/`) |
| Maps | **Mapbox GL** (lazy-loaded), Search (SA addresses), Directions (routes, ETAs). Low-data mode uses a zero-download schematic map |
| Navigation | Hand-off to **Google Maps / Waze** deep links (via the pickup point) — no in-app turn-by-turn |
| Backend | **Supabase** (project `Lifty`): Postgres + PostGIS, RLS, Auth (phone code), Realtime, Storage, pg_cron, the `find-matches` Edge Function |
| Live tracking | Background GPS (`@capacitor-community/background-geolocation`) → private per-participant Realtime channels `commute:<instanceId>:<userId>`; breadcrumbs every 30 s; purged after 30 days |
| Monitoring | Sentry (only loaded when `VITE_SENTRY_DSN` is set) |

## Safe local test app

See [the local testing guide](docs/local-e2e.md). The local stack contains 20 labelled fictional North Coast drivers, measured road routes, synthetic completed reviews, fixed local OTP identities and a server simulator. It uses the same matching handler, request APIs and authorized tracking channels as the application.

Run these in separate terminals:

```text
npm run stack:up
npm run stack:gateway
npm run test:simulation
npm run dev:local
```

Open http://127.0.0.1:5180. No SMS is sent for configured local test numbers. The gateway uses the ignored local Mapbox configuration for real routing. Local fixture automation runs only while the simulator process is running.

Stop `dev:local` before browser tests, which own port 5180:

```text
npm run test:e2e:local
npm run test:coverage
npm run test:isolation
npm run test:lifecycle
npm run check:secrets
```

The database and final-seat race checks require `LIFTY_TEST_DATABASE_URL` targeting only the fixed local database on port 57322. They reject hosted projects and other local databases. `npm run types:local` generates types from this sandbox.

## Backend and isolation

Canonical changes are in `supabase/migrations/`. Preserve the deployed schema and migration history; reconcile them before any hosted application. Old pending/erasure instructions and legacy demo seed files are not deployment instructions.

`20261009124455_test_driver_isolation_and_simulation.sql` defaults test visibility to **disabled**. A local operator enables local mode; staging requires an explicit tester allowlist. Test profile/leg/member/instance/review labels and restrictive RLS prevent ordinary accounts from seeing test fixtures in disabled mode. Server functions also check visibility, including location recipients at publication time. Client accounts cannot change labels or operate the simulator.

This branch's test isolation migration and replacement seed have been verified locally. They have **not** been applied to the hosted project. Existing hosted demo data therefore remains a separate release task.

Matching validates road and pedestrian distances, available seats, approval, directions, agreed days and arrival windows. Partial matches identify uncovered days. Account state, accepted arrangements, contributions and ratings load from Supabase. GPS sharing uses server-authorized channels for each participant; the foreground map watcher is separate and does not publish location.

## Local fixture controls and cleanup

```text
npm run test:drivers -- list
npm run test:simulation -- manual <test-driver-uuid>
npm run test:simulation -- automatic <test-driver-uuid>
npm run test:simulation -- decline <test-driver-uuid> 100
npm run test:simulation -- start-trip <accepted-test-request-uuid> 90
```

Cleanup requires the explicit local target confirmation and removes only labelled fixture IDs:

```text
npm run test:drivers -- cleanup --confirm-lifty-e2e
npm run test:drivers -- seed
```

These commands are locked to `supabase_db_lifty-e2e`. Do not copy the cleanup SQL into a hosted SQL editor. `supabase/remove-demo-lifts.sql` now refuses execution.

## Still to do outside the code (dashboard / accounts)

These cannot be done from this repository:

1. **Auth URLs.** Supabase → Authentication → URL Configuration: set the Site URL to the deployed address and add the local development address(es) as redirect URLs.
2. **SMS provider.** Phone sign-in uses the Twilio Verify provider configured in Supabase → Authentication → Sign In / Providers → Phone. Keep its credentials only there, and rotate them if they are ever exposed. Texting South Africa needs Twilio geo permission, and trial accounts only reach verified numbers.
3. **First admin — only after that person has signed up once** (the row is looked up by phone number, so running it earlier inserts nothing): `insert into public.admins (user_id) select id from auth.users where phone = '27XXXXXXXXX';`
4. **Mapbox token:** restrict the public token to your domains / app bundle id in the Mapbox account. The server `MAPBOX_TOKEN` secret for the Edge Function is a separate, private token.
5. **Push notifications:** add Firebase `google-services.json` to `android/app/`, then send FCM pushes from the `notifications` table (in-app and local notifications already work).
6. **Sentry (optional):** set `VITE_SENTRY_DSN`.

## Android and validation limits

`npm run android` builds and opens the Capacitor Android project. Android Studio, a JDK and the Android SDK are needed. This React DOM application does not support Expo Go.

Browser geolocation needs a secure context: localhost is supported; a phone accessing an HTTP LAN address needs a trusted HTTPS setup. [Map testing instructions](docs/map-location-validation.md) distinguish synthetic browser GPS checks from physical-phone validation.

Local OTP tests do not prove Twilio delivery. Synthetic GPS and server simulation do not prove locked-screen Android GPS or closed-app push. Those require device/provider testing before a pilot release.

See [findings and verification evidence](docs/map-pin-test-drivers-findings.md).

