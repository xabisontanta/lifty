# Lifty — recurring commuter lift clubs

Not e-hailing: Lifty matches people who already drive a route with people who live along it, and helps them run a recurring lift club. Designs live in [`design/`](design/README.md).

```
npm install
npm run dev          # http://localhost:5173 (phone width)
npm run build        # typecheck + production build
npm run android      # build, sync and open the Android project (needs Android Studio)
npm run ios          # same for iOS (needs a Mac with Xcode + CocoaPods)
```

## Stack
| Layer | Choice |
|---|---|
| App | React 18 + TypeScript + Vite, wrapped as a native app with **Capacitor 8** (Android project in `android/`) |
| Maps | **Mapbox GL** (lazy-loaded), Search (SA addresses), Directions (routes, ETAs). Low-data mode uses a zero-download schematic map |
| Navigation | Hand-off to **Google Maps / Waze** deep links (via the pickup point) — no in-app turn-by-turn |
| Backend | **Supabase** project `Lifty` (`kdjzevtryezwbjdgyqaf`, eu-west-2): Postgres + PostGIS, RLS, Realtime, Storage, pg_cron |
| Live tracking | Background GPS (`@capacitor-community/background-geolocation`) → private Realtime broadcast channel `commute:<instanceId>`; breadcrumbs every 30 s; purged after 30 days |
| Monitoring | Sentry (only loaded when `VITE_SENTRY_DSN` is set) |

## Data sources
- **Live** (default when `.env` has Supabase keys): real accounts, PostGIS matching, realtime tracking.
- **Demo**: sample drivers + a simulated commute on this device. Used automatically if phone sign-in isn’t configured yet (the sign-up screen offers “Use demo”), and switchable in Profile → Data & demo tools.

## Backend (supabase/)
- `migrations/0001_init.sql` schema · `0002_security.sql` RLS, column grants, realtime authorization · `0003_functions.sql` RPCs (matching, requests, instances, tracking actions, admin, POPIA) · `0005` pickup-point RPC + storage buckets
- `seed.sql` demo drivers on real Mapbox routes (Salt Rock / Ballito → Umhlanga Ridge) + community pickup points
- **`0004_popia_erasure_PENDING.sql` must be run manually** in the Supabase SQL editor (account deletion + 30-day location purge — the automated tool blocks delete statements).

### Key server functions
`find_matches` (PostGIS corridor search, ranks by overlap / walk / detour / schedule; trims routes so driver homes are never exposed) · `request_to_join` · `respond_to_request` · `get_my_clubs` · `generate_commute_instances` (daily cron) · `get_current_instance` · `mark_driver_arrived` · `mark_rider_status` (at pickup / collected / no-show after a 3-min grace) · `complete_instance` · `record_location` · `upsert_driver_leg` (enforces the cost-sharing cap) · `review_document` (admin) · `export_my_data`

## You still need to do (dashboard / accounts)
1. **Phone sign-in (SMS / WhatsApp OTP):** Supabase → Authentication → Sign In / Providers → Phone → enable, choose **Twilio Verify** (supports WhatsApp), paste the Twilio credentials. Until then the app offers demo mode.
2. **Leaked-password protection:** Authentication → Settings → enable.
3. **Run `supabase/migrations/20261008000004_popia_erasure_PENDING.sql`** in the SQL editor.
4. **Make yourself an admin** (SQL editor): `insert into public.admins (user_id) select id from auth.users where phone = '27XXXXXXXXX';`
5. **Mapbox token:** restrict it to your domains / app bundle id in the Mapbox account.
6. **Push notifications:** add Firebase `google-services.json` to `android/app/`, then send FCM pushes from the `notifications` table (in-app + local notifications already work).
7. **Sentry (optional):** set `VITE_SENTRY_DSN`.

## Testing
Browser E2E scripts (Edge + Playwright) cover passenger, driver and error/offline flows in demo mode. A Node script exercises the live backend end to end, including two-way realtime location and RLS refusal for outsiders.
