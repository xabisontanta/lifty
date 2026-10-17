# Driver pilot review — 17 October 2026

Branch: `codex/driver-reliable-pilot`. Review locally before any merge to main. No hosted database migration, provider change, paid preview backend or production deployment is part of this review.

## Implemented

- Server-backed onboarding drafts restore the setup step, vehicle, actual mapped commute and owned car photo. Upload progress, rejection reasons and expiry information come from the account snapshot, never from a draft approval flag.
- New licence/insurance uploads require an expiry date before review. All four latest documents require human approval; an ID approval alone does not produce the full driver badge. Existing approved documents without recorded expiry remain explicitly identifiable as legacy records.
- Expired, replaced or rejected approvals hold new pickups and notify affected clubs. Agreements and history remain saved. A driver can safely finish a held journey for passengers already collected; unresolved pickups are recorded as absence rather than no-show. Recovery is notified after human reapproval.
- Request inboxes refresh through authorised Realtime events, foreground/reconnect catch-up and bounded polling. Withdrawn requests retain their own status. Decisions keep exact request/leg identity and meaningful server errors.
- Morning/evening controls use stable route IDs and consistent sorting. Pausing new requests persists and can be reopened after reload; existing agreements continue. Dashboard contributions use agreed membership amounts rather than new advertised prices.
- Each rider has separate arrival, collection, no-show, pending and error state. An in-flight action cannot switch to another passenger. External navigation targets the selected pickup. Sharing labels accurately describe shared details.
- Group chat uses stable message UUIDs, visible retry state, per-club ordered message sequences, read cursors, history pagination and reconnect catch-up. Durable message notifications exclude the sender and hide message bodies from lock-screen previews.
- Acceptance reconciles the changed leg instead of every club while holding a seat lock. A conservative sum of overlapping pickup detours prevents exceeding the driver's limit; this is not a road-optimised multi-stop itinerary.
- Private drafts/read cursors are included in export and cascade with account deletion. New hold state is private and follows the existing test-data and notification-delivery boundaries.

## Validation

| Check | Result |
|---|---|
| TypeScript, ESLint, production build | Passed; existing bundle-size warning remains |
| Unit checks | 221 passed across 19 files |
| Full browser regression | 50 passed in 2.1 minutes; mocked backend and synthetic GPS where applicable |
| Real local driver/two-passenger browser journey | Passed in 4.8 minutes, 5.8 minutes including build |
| Original database / fixture isolation / lifecycle / safety | 59 / 25 / 31 / 23 passed, rolled back |
| New driver / approval-hold database checks | 79 / 36 passed, rolled back |
| Real two-client message concurrency | 13 assertions passed; generated accounts removed |
| Final-seat race | Exactly one acceptance, one active membership, zero open seats |
| Fresh database replay | All 21 migrations, seed and five fixture/driver/hold suites passed on disposable port 58322 |
| Source credential scan | Passed; ignored environment files excluded |

The real browser journey uses fixed local OTP and actual road quotes, manual acceptance, group messages, pause/reopen after reload, two independent pickup transitions and completed server records. It does not mock business API responses. Its map styles are deliberately unavailable to exercise manual coordinate entry; it does not prove physical GPS or provider delivery.

An initial integrated run exposed route-order-dependent settings selection and a two-member cleanup capacity violation. Both were fixed and the journey reran successfully. One full browser run then encountered a sign-in document-load timeout; waiting for DOM readiness while retaining all authentication assertions fixed that harness dependency, and the complete 50-test rerun passed.

![Two independently collected passengers](review/driver-pilot/two-passenger-pickups.png)

## Local review

Start the existing sandbox and gateway, then run `npm run preview:driver`. This builds the normal app with the fixed local backend and serves http://127.0.0.1:5180/signin.

Choose **Sign in**, use local test driver **0820000101**, and enter local code **123456**. These identities and codes exist only in the isolated sandbox and send no SMS. The app has no demo sign-in bypass. Drivers/fixtures stay labelled as test data.

`npm run preview:driver:prepare` prepares two fake passengers through normal local OTP, road matching and request APIs. It leaves their requests pending for the manual driver to review. It preserves existing pending/accepted requests rather than resetting them. Passenger sign-ins are **0820000001** and **0820000003**, with the same local-only code **123456**. Use separate browser profiles for simultaneous roles.

Review Home, My Route, Requests, Messages, Verification documents, Settings, Contributions and History. An empty request inbox is a valid persisted state; the test passenger can submit a compatible request from another browser session. See [local setup](local-e2e.md) for the Salt Rock Main Road → Umhlanga Ridge example and guarded trip controls.

Tests use reserved local passenger numbers and clean them transactionally; do not run the browser lifecycle suite while manually reviewing those same accounts. Keep the gateway and preview processes running while using the local link.

## Remaining release gates

- Physical Android locked-screen GPS and closed-app FCM receipt require device/provider proof. Browser and synthetic-GPS tests do not establish these.
- Real SMS delivery remains distinct from fixed-code local Auth testing.
- A human reviewer must check driver documents and operate the safety process. The UI does not establish insurance or transport-law clearance.
- The hosted project must be reconciled before applying migrations. These changes have been applied only to isolated local databases.
- The existing large Mapbox/application bundle warning remains; the build succeeds. Full road-based multi-stop optimisation is not included; the current detour guard is conservative.
- Main remains unchanged pending the user's preview review and outstanding release checks.
