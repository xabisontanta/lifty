# Driver notification follow-up — 18 October 2026

The user's local driver preview stays on build `5d1fce2` while they review onboarding. This notification follow-up is prepared separately on the same feature branch; the preview server and its bundle were not rebuilt, and no preview account data or hosted services were changed. The already-verified disposable replay database on port 58322 was removed to free local test resources; the browser's backend on port 57322 was retained.

## Implemented

- Notification permission and completed device registration have separate UI states. Android registration becomes ready only after the authenticated destination save succeeds; browser settings describe alerts while the app is open.
- Native registration errors and missing callbacks are visible. Registration has a 20-second deadline; a stalled destination save aborts after 12 seconds. Reconnection or foregrounding retries incomplete registration/persistence without reinstalling listeners or resubmitting a saved token.
- Token rotation serialises destination saves. A registration epoch and current-account guard prevent disposed callbacks from reporting readiness or acting on old notification links. Account-cache cleanup aborts in-flight destination requests.
- Logout captures the current destination before clearing it, attempts its owner-scoped server deletion while authenticated, cancels registration callbacks, removes cached/delivered notifications and asks the native SDK to unregister. Logout still completes when backend or native cleanup fails.
- Native cleanup waits at most eight seconds. Failed, offline or unresolved cleanup keeps a persistent retry marker. Subsequent registration waits for pending cleanup instead of racing it; expired sessions and account changes also trigger cleanup.

## Verification boundaries

The automated native-service tests use mocked Capacitor APIs and fake timers. They cover token persistence failures, connection recovery, account changes, rotation, registration errors, silent/hung SDK calls, bounded cleanup and late callbacks. API integration tests cover owner/token deletion, local-only sign-out, request deadlines and aborting an old account's in-flight destination save. The browser regression checks the permission wording without claiming native FCM delivery.

Current branch checks: 282 unit tests across 24 files passed, including 20 notification lifecycle checks and five push-account integration checks. All 55 browser scenarios passed with two workers in 2.9 minutes. TypeScript and ESLint passed. No real-backend browser suite was rerun while the user was reviewing its reserved accounts.

These tests do not prove physical delivery or remote token revocation. Capacitor's Android `unregister()` implementation resolves before Firebase's asynchronous deletion task finishes. Retrying a stored cleanup marker is a client safeguard; it is not proof that Firebase or the backend acknowledged revocation, especially during offline logout. Test that behavior on an actual device before enabling FCM for the pilot. See the [Capacitor push documentation](https://capacitorjs.com/docs/apis/push-notifications).

## Remaining Android gates

- `android/app/google-services.json` is absent. Device registration and closed-app receipt require the authorized Firebase project and server delivery credentials.
- No Java/ADB commands, Android SDK/JDK environment configuration, or standard Android Studio/JDK/SDK installations were found during the 18 October check. Native compilation and installation remain unverified.
- Run `cap sync android` before compiling so the generated native assets include the source legacy-bridge and native-HTTP configuration. The current generated assets are not evidence of a synced build.
- The installed location plugin has no native deadline. A JavaScript timer and server rejection do not prove stationary, locked-screen GPS shutdown. The existing [physical-device checklist](tracking-validation.md) remains required, including expiry, withdrawal, completion, logout, account changes and closed-app push.
- User preview feedback and the outstanding release gates remain prerequisites to merging. No merge or production activation is part of this follow-up.
