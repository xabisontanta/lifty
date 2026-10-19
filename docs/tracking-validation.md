# Phone review and Android validation

## Review in a browser

- Open `https://lifty-ten.vercel.app/` on the phone. The generated QR image is `public/review-qr.png`; `/review.html` provides a same-origin desktop phone frame and the QR link.
- Scan using the phone camera or a QR reader. This is a browser link, not an Expo Go bundle: the project uses React/Vite and Capacitor native plugins.
- Android Chrome: browser menu → Add to Home Screen. iPhone Safari: Share → Add to Home Screen. There is a web manifest and app icons; there is no service worker or offline caching of accounts, API responses, routes, or locations.
- Browsers only provide location reliably while the page is open. A browser or Home Screen review does not establish locked-screen Android location or push delivery.
- The frame uses the current site's own session. It never embeds a separate origin or moves authentication tokens into QR links. Anyone who scans must use their own account.

To regenerate QR and icons when the public URL changes:

```powershell
node scripts/generate-review-assets.mjs https://lifty-ten.vercel.app/
```

The script accepts a public HTTPS URL without credentials, query parameters, or fragments. Its pinned QR dependency generates a real PNG with a four-module quiet zone.

## Android configuration completed

- App ID `za.co.lifty.app`, target/compile SDK 36, minimum SDK 24.
- Foreground location service and notification permissions are present. The background-geolocation service is private to the application; account caches are excluded from Android backups.
- The plugin's documented `android.useLegacyBridge` setting is enabled. `CapacitorHttp.enabled` forwards fetch/XHR through native transport to avoid background WebView HTTP throttling.
- Push and foreground-service notifications use a monochrome notification icon.
- GPS is gated by consent and the commute window; the tracking feed immediately removes watchers on consent changes, completion, cancellation, account changes, and expiry while JavaScript runs. The server independently rejects publication outside the authorized window.

Configuration references: [background-geolocation installation](https://github.com/capacitor-community/background-geolocation#android), [Capacitor configuration](https://capacitorjs.com/docs/config), [native HTTP](https://capacitorjs.com/docs/apis/http), [Android push setup](https://capacitorjs.com/docs/apis/push-notifications#android).

## Outstanding native gates

The 19 October 2026 check still found no `java` or `adb` in PATH or standard Android toolchain installation. Native compilation, installation, and device behavior are not verified by web builds or unit tests.

The user-approved Firebase project `lifty-ca454` was created on the no-cost Spark plan on 19 October 2026. Billing was not linked; Analytics, Gemini and Developer Program enrolment were left off during creation. Android app `za.co.lifty.app` is registered as **Lifty Android pilot**, and the console confirms FCM HTTP v1 enabled. Its downloaded `android/app/google-services.json` was validated against the project/package and installed locally; it remains ignored by Git. No private server key was created, no worker was deployed or activated, and no device delivery was tested. See [push activation](push-delivery-activation.md) before installing delivery credentials.

The installed background-geolocation 1.2.26 plugin documents Capacitor through version 7; this application uses Capacitor 8. Its peer dependency allows the version, but native compilation and device compatibility still need verification.

The plugin offers no native deadline option. If Android suspends JavaScript while the phone is stationary, a JavaScript expiry timer cannot prove the native GPS watcher stops at the exact deadline. The server stops accepting locations after the window, and the client stops on its next execution/fix. Before pilot release, verify watcher shutdown while locked and stationary; if it fails, implement a native deadline watchdog or replace the watcher with a plugin that supports a native request duration. Do not count server rejection as proof that the device stopped GPS.

Required configuration:

1. Install Android Studio with SDK 36 and the JDK version required by Capacitor 8 (JDK 21); set SDK/JDK paths.
2. On another checkout, download the existing app's client `google-services.json` from project `lifty-ca454` into `android/app/` (already installed in this checkout). Server delivery separately requires a narrowly scoped Firebase service account in the server secret store and explicit activation; the client file does not enable the worker.
3. Build and sync using `npm run build` then `npx cap sync android`. Compile with `.\gradlew.bat assembleDebug` from the Android directory. Use the authorized test device without opening a visible helper window.

## Physical device acceptance checklist

Use a test driver and two test passengers on an authorized, active commute. Record Android version/device, app build, server job revision, times, and actual observed results.

- Deny foreground location and notifications independently: show useful errors, do not start an invisible background watcher, and allow retry from settings.
- Start with consent off: no GPS indicator, foreground service, or location publications. Enable consent during the commute: start exactly one watcher.
- Lock the phone for over six minutes while moving: verify server-timestamped updates reach only the intended driver/passenger pair; auth headers and session refresh still work with native HTTP.
- Stop moving and stay locked through expiry: verify the foreground notification and GPS indicator disappear at the deadline, with no later publication. This is a release gate for the native deadline limitation above.
- Revoke consent, end sharing, complete/cancel the trip, sign out, and change accounts: verify no native watcher remains and no stale rider position leaks to the next account.
- Two passengers update concurrently: the driver sees independently named markers and pickup states; neither passenger receives the other's location.
- Retry failed arrival, collection, and no-show actions: show server errors without a success state; each passenger's three-minute grace starts from their own server arrival timestamp.
- Screen-locked background push and closed-app notification: verify FCM delivers a visible notification, tapping it opens the intended authenticated route, and no token is retained against the previous account after sign-out.
- Test network loss/recovery, device clock skew, permission revocation, battery saver, app killed/restarted, and one morning plus one evening commute. Check the driver route and destination labels on the evening leg.

Store observed device evidence separately from automated test results. Tests with fake timers do not establish Android background behavior.
