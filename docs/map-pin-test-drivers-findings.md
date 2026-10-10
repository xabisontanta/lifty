# Map, searches and test drivers — 10 October 2026

## Step 0: inventory before changes

Starting commit: `330256c`, branch `feature/server-side-matching`; working tree was clean. This request is implemented on `fix/map-pin-test-drivers-demo-toggle`. No AGENTS.md was found. The new request prohibits deployment and production data mutations, superseding the earlier deployment request.

React 18 / TypeScript / Vite renders a React DOM application. Capacitor 8 wraps Android; this is not an Expo Go project. Mapbox GL displays maps; Mapbox Search geocodes addresses and Directions measures road/pedestrian journeys. Supabase provides Auth, Postgres/PostGIS, Storage, Realtime and scheduled work.

| Area | Sources at starting commit |
| --- | --- |
| Home map / green pickup / saved home | `src/screens/passenger/Tabs.tsx`, `src/components/map/MapView.tsx` and marker components |
| Commute form / matching | `src/screens/passenger/Plan.tsx`, `src/services/liveApi.ts`, `src/domain/matching.ts`, `src/domain/measure.ts`, `supabase/functions/find-matches/{handler,core}.ts` |
| Profile demo tools | `src/screens/shared/Shared.tsx` `DevTools`, inserted by passenger Tabs and driver Driver |
| Runtime backend switch | `src/services/api.ts`, `src/screens/auth/Auth.tsx`, `src/store/app.tsx` |
| Bundled mock data | `src/data/mock.ts`, `src/data/demoLegs.ts`, demo API / routing / tracking services |
| Database fixtures | `supabase/seed.sql`, `supabase/seed-demo-lifts.sql`, generator `scripts/build-demo-seed.mjs` |
| Cleanup | `supabase/remove-demo-lifts.sql`: unguarded deletion of auth users whose profiles have `is_demo=true` |
| Isolated backend | `scripts/local-stack.mjs`, `scripts/local-gateway.mjs`, `supabase/local-e2e/config.toml`, `tests/e2e-local/` |

### Map root cause

The blue “You are here” marker uses a one-shot GPS fix. Another blue saved-home marker uses the commute address. The nearest community pickup is automatically promoted to a green labelled pin even when the rider never selected it. Thus “Salt Rock Main Road” is a pickup, not the phone position. Coordinate order is already correct (`[longitude, latitude]`). There is no metric accuracy circle, movement watcher, or direct camera recenter to the current fix. MapPicker silently swallows geolocation errors and can leave a default selection visible.

### Demo/live root cause

Configured Supabase normally selects liveApi. A per-tab `lifty.source=demo` flag overrides it; missing Supabase configuration also silently selects mockApi. Auth then simulates signup, and Profile exposes the switch. Old localStorage flags are removed by the latest preceding commit but sessionStorage overrides remain. Sample state can look like a real account.

### Data-loss check and zero-driver diagnosis

Hosted checks were SELECT-only and their SQL was displayed before execution. Inventory: 22 profiles, 21 tagged demo (including the original sample passenger), 28 driver legs, 27 active legs with free seats, and 80 verified document rows. The data supports that the 20 seeded drivers are present; it does **not** establish whether an older cleanup was ever executed and followed by reseeding. Source history cannot prove SQL execution. No hosted cleanup or seed was run for this request.

The first aggregate check failed with a column-resolution error while evaluating the approval helper. A follow-up explicitly inspected the current columns and helper definition; `is_demo` is present. Do not infer data loss from that failed query.

The saved morning search had five weekdays, arrival by 08:00 and a 750 m walking limit. A displayed SELECT-only diagnostic traced its coarse server filters: 19 approved available legs in the right direction, one route near the destination, and zero routes near both origin and destination. The candidate count became zero at the origin/corridor check, before road walking/ETA/scoring. The SQL is retained in `docs/readonly-search-diagnostic.sql`; it returns aggregate counts without home coordinates or user IDs. Seed removal is not supported as the cause. The intended address selection still requires confirmation on the user's device; filters were not widened to force results.

Before changes, mock drivers had no usable login identities/phone codes, no server ride lifecycle, no Test driver badges, and no server isolation from normal users. Existing matching applies approval, seats, direction, spatial corridor, pickup-before-dropoff, requested days, pedestrian distance, driver detour and arrival deadline.

## Implemented repairs

### Step 1 — map

Foreground high-accuracy watching updates one blue device dot. Purple saved-address pins and green selected pickup pins remain visually distinct; no community pickup is selected automatically. Accuracy circles use metres when reported accuracy exceeds 50 m. Recenter uses the latest fresh fix. Invalid fixes, cached/future coordinates and 30-second silent watches clear the dot; hiding/leaving the map stops the watch. Permission and insecure-context errors offer manual selection. Empty saved plans do not display an invented zero-coordinate destination or enable search. See `docs/map-location-validation.md` for physical-phone checks.

### Step 2 — backend-only app

Removed the Profile demo/reset tools and client mock API/tracking implementations. Legacy data-source flags are discarded. Authentication, account restoration, driver controls, matching and tracking now use the configured backend. Missing configuration shows a setup screen instead of a sample account. The reset control was removed because it only served the unused runtime demo. Local fixture management is an operator command outside the user interface.

### Step 3 — server test data and lifecycle

Added `20261009124455_test_driver_isolation_and_simulation.sql`, `seed-test-drivers.sql` and guarded local tools. Twenty fictional approved drivers have 40 measured morning/evening route legs and 146 synthetic reviews tied to completed instances and real participant records. Fixture badges come from server labels. Profiles, dependent rows, SECURITY DEFINER endpoints and authorized location publication enforce disabled/local/staging visibility. Simulator controls require service-role execution, enabled test mode and an actual accepted fixture request. Responses and ride transitions go through the existing booking/status/location APIs; there is no client moving-marker mock.

The local coverage suite exercises 750 m walking and arrival by 08:00 in Africa/Johannesburg. Salt Rock–Umhlanga produces strong and partial road matches. Late-departure/full-seat drivers and uncovered areas are negative controls. Coordinate snaps must remain within the road-snap limit; an airport terminal-roof coordinate was corrected to the actual terminal drop-off instead of relaxing that guard.

The road matching handler reads only a server routing token and rejects malformed request bodies. API callers no longer submit the app's Mapbox token as a backend credential.

### Step 4 — usability

Fixed request/accepted deep links to restore the exact server arrangement after reload. Removed fabricated schedules/member details, added escape routes to loading/error screens, added driver-profile/rating retries and eligibility guards, and restored chat/club state when Inbox opens directly. Pickup loading/empty/error states are explicit; walk-limit controls respect the configured cap. Finding results no longer impose a multi-second decorative delay. All flows are tested at 390 px; detailed findings and screenshot evidence are linked below when verification completes.

## Changed-file groups and operator settings

| Group | Main files |
| --- | --- |
| Position, markers and picker | `src/services/foregroundLocation.ts`, `src/hooks/useMapLocation.ts`, `src/lib/mapLocation.ts`, `src/components/map/MapView.tsx`, `MapPicker.tsx`, `src/components/ui/extras.tsx`, passenger `Tabs.tsx` / `Plan.tsx`, `src/styles/global.css` |
| Account/source cleanup | `src/services/api.ts`, `tracking.ts`, `location.ts`, `authErrors.ts`, `liveApi.ts`, `pilotApi.ts`, `src/store/app.tsx`, `src/App.tsx`, auth/driver/shared screens, `src/hooks/useClubs.ts` |
| Actual request/profile/ratings flows | `src/screens/passenger/Flow.tsx`, `src/screens/shared/Shared.tsx`, `src/screens/driver/Driver.tsx`, `PilotDriver.tsx`, `src/components/match/cards.tsx`, `src/domain/types.ts` |
| Matching credential validation | `supabase/functions/find-matches/handler.ts`, `engine/types.ts`, `tests/unit/findMatchesHandler.test.ts` |
| Isolation and fixtures | new migration, `supabase/seed-test-drivers.sql`, `remove-test-drivers-local.sql`, legacy seed/cleanup guards, `scripts/build-test-driver-seed.mjs`, `test-driver-tools.mjs`, `test-driver-simulator.mjs` |
| Safe local tooling | `scripts/sandbox-safety.mjs`, `test-database-target.mjs`, `local-stack.mjs`, `local-gateway.mjs`, `dev-local.mjs`, `generate-local-types.mjs`, `check-secrets.mjs`, `supabase/local-e2e/config.toml`, generated `src/domain/database.types.ts` |
| Verification | map/backend-only/sandbox-target unit tests, browser and local lifecycle tests, rollback SQL isolation/lifecycle suites, coverage script, ESLint config, package scripts/lock and ignored reports |

No user-facing environment toggle was added. Test visibility is an operator-only database mode plus staging tester UUIDs. Browser configuration still uses public Supabase and Mapbox values; routing credentials remain server-side. Fixture write/cleanup confirmation settings are only set by guarded local runners. No secrets were added to versioned files.

Run instructions, staging preparation and safe cleanup are in `docs/local-e2e.md`. Do not copy local cleanup into a hosted SQL editor. Hosted changes require a separate reviewed action; this branch is not deployed. The deployed legacy demo data has therefore not gained these new isolation rules yet.
