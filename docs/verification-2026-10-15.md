# Lifty continuation verification — 15–16 October 2026

## What was already finished

The checkout was clean when this continuation resumed. Claude had already committed and pushed the implementation to `fix/map-pin-test-drivers-demo-toggle` in the private repository `https://github.com/xabisontanta/lifty`:

- `da20532`: backend-only runtime, foreground map location and tracking recovery.
- `17de54c`: labelled server test drivers, simulator, isolation and guarded local tooling.
- `c58155a`: make the pilot SQL test passenger a normal-shaped account so its assertions exercise real account visibility.

GitHub's branch head was verified directly as `c58155a4c4cc6401abcf840ba728c7057d2e5075`. Working implementations were preserved. This continuation adds verification evidence and corrects operator documentation; it does not repeat the feature implementation.

## Current verification

| Check | Latest result (15–16 October) |
| --- | --- |
| TypeScript | Passed |
| ESLint | Passed |
| Unit tests | 196 passed across 15 files |
| Production build | Passed; existing bundle-size and mixed-import warnings remain |
| Source credential scan | Passed; ignored environment files excluded |
| Map browser journeys at 390 px | 9 passed in 56.8 seconds |
| Account/settings/ratings browser scenarios | 24 passed in 1.5 minutes, using an intercepted backend |
| Fresh local manual-driver browser journey | 1 passed in 3.3 minutes; real local OTP, road quote, HTTP 204 acceptance, both accounts restored after reload and database membership confirmed |
| Original pilot database suite | 59 passed, 0 failed; rolled back |
| Final-seat race | Two concurrent lock contenders; exactly one acceptance, one active member, zero open seats; three generated accounts cleaned |
| Test-driver isolation | 25 passed, 0 failed; rolled back |
| Test-driver lifecycle | 31 passed, 0 failed; rolled back |
| Test-driver safety/cleanup | 23 passed, 0 failed; rolled back |
| Fresh schema replay | All 19 canonical migrations; 20 drivers, 40 measured legs, 146 synthetic reviews; the same 25/31/23 suites passed |

The exact committed migration was replayed in the dedicated disposable local database on port 58322. The normal browser sandbox on 57322 and unrelated projects were left intact. No hosted SQL, migration, seed, cleanup or deployment was performed.

The older full browser lifecycle artifact from 10 October failed on manual driver acceptance because the server returned HTTP 500 / SQLSTATE 57014 (`canceling statement due to statement timeout`). It predates the latest implementation commits and is not evidence of a missed click or broken navigation. A fresh normal-authenticated browser journey passed on 16 October: the acceptance RPC returned HTTP 204, with RPC plus navigation taking 2,439 ms. Both driver and passenger then reloaded into the accepted state, and the database contained exactly one active membership for that request. The reserved fixture accounts and driver setting were restored afterward. The older long end-to-end run must still not be described as passing.

The first browser reruns exposed test dependencies on the external font CDN and on waiting for every page resource to load. The tests now intercept fonts, await visible account state and use DOM-ready navigation where appropriate. The sign-in assertions and real local Auth/matching/acceptance requests remain intact; no application authentication code was changed.

## Usability findings

| Severity | Finding and disposition | Evidence |
| --- | --- | --- |
| Blocker, fixed | A disabled backend could fall back to fake signup or a locally selected demo account. Runtime data is backend-only; missing configuration is explicit. | `src/services/api.ts`, `src/screens/auth/Auth.tsx`, backend-only unit tests |
| Blocker, fixed | Local role/onboarding/sample state could survive account changes. Authenticated server account state now drives routing. | `src/store/app.tsx`, `src/App.tsx`, session browser tests |
| Blocker, fixed | Uploaded documents could appear approved and incomplete driver routes could finish setup. UI now uses server verification and validates saved routes. | `src/screens/auth/Onboarding.tsx`, `src/screens/driver/Driver.tsx` |
| Major, fixed | Wrong/stale map locations, automatic pickup selection, stale GPS and blank street-map loading. One fresh device dot, distinct saved/pickup markers, accuracy, direct recenter, expiry and bounded fallbacks. | Map regression suite; [map screenshot](review/map/correct-pin-390.png) |
| Major, fixed | Accepted/request reloads could restore the wrong cached arrangement; direct Inbox reload could miss clubs. | `src/screens/passenger/Flow.tsx`, [accepted](review/local-390/07-accepted.png), [Inbox](review/local-390/09-inbox-restored.png) |
| Major, fixed | Rating failures and loading/errors could trap the user; summary status could require repeated refreshes. Errors/retries/back navigation and server refresh now handle these states. | `Flow.tsx`, [rating](review/local-390/16-rating.png) |
| Major, fixed | Driver settings had local-only paths; displayed drop-off time could be invented. Settings persist through validated APIs and agreed times come from the server. | `src/screens/driver/PilotDriver.tsx`, `src/services/liveApi.ts` |
| Major, fixed | Public driver history used arrangement count as a proxy for completed trips and could imply 100% reliability without history. Separate server trip metrics and explicit unknown history are implemented. | `get_driver_trip_stats`, `Flow.tsx`, profile browser assertion |
| Minor, fixed | Decorative search delay, evening empty-state editing morning time, walking-cap no-ops and missing test badges. | `Flow.tsx`, `Plan.tsx`, [search](review/local-390/03-road-matches.png) |
| Minor, open | Own-account phone numbers are unformatted; accepted-screen Test driver badge fills the row. | [Profile](review/local-390/10-profile.png), [accepted](review/local-390/07-accepted.png) |
| Minor, open | The production bundle still emits size warnings. | Build output; lazy Mapbox bundle |
| Major at scale, open | Accepting one request synchronously reconciles dates across all clubs and generates contributions twice while holding the request/leg locks. Authenticated RPCs have an 8-second statement limit. The old timeout alone does not prove this was its cause; measure and scope this work before a larger rollout. | `respond_to_request`, `reconcile_commutes`; read-only function/role review |

## Screenshots and practical limits

The retained screenshots are from 390 px local-backend browser journeys with fixed local OTP and fictional drivers. They are not proof of real SMS, physical GPS accuracy, background Android tracking or closed-app push. The map regression screenshots inject synthetic GPS; the low-data street layout is explicitly illustrative.

- [Correct marker and accuracy](review/map/correct-pin-390.png)
- [Search with labelled test drivers](review/local-390/03-road-matches.png)
- [Public driver profile](review/local-390/04-public-driver-profile.png)
- [Accepted arrangement](review/local-390/07-accepted.png)
- [Authorized simulated driver position](review/local-390/12-driver-live-position.png)
- [Rating a completed trip](review/local-390/16-rating.png)
- [Profile without demo controls](review/local-390/10-profile.png)
- [Manual driver pickup list](review/local-390/20-driver-pickup-list.png)
- [Fresh manual acceptance after driver reload](review/local-390/manual-accept-persisted-390.png)
- [Fresh accepted state after passenger reload](review/local-390/manual-accept-passenger-390.png)

The public-profile and review captures were refreshed against the current local backend. They show five completed trips and five actual synthetic reviews for Sipho, matching `get_driver_trip_stats`; the old arrangement-count proxy is no longer displayed.

See [local testing and staging preparation](local-e2e.md) for fixed targets, simulator controls, non-production seed markers, safe cleanup and replay commands. Test notifications stay in the app and are deliberately excluded from real FCM delivery.

The hosted project has not received this branch's isolation migration. Its earlier demo records therefore remain a separate reviewed release task. The Vercel app has not been updated by this continuation. This React/Vite + Capacitor project cannot run in Expo Go; native Android testing requires the Capacitor build. Real SMS delivery, Android locked-screen GPS and closed-app push still require provider/device verification before pilot readiness.
