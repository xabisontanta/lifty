# Map location fix and phone verification

The former green “Salt Rock Main Road” pin was the first community pickup returned by Supabase. It was automatically promoted to a selected pickup, even when the rider had not selected it. The blue “You are here” marker was a separate device location; a second blue “Home” marker used the saved commute address. Coordinates were already in the correct Mapbox order, `[longitude, latitude]`.

The device marker previously used a single GPS lookup with up to 30 seconds of cache reuse. It never followed movement, displayed a decorative fixed-size pulse instead of measured accuracy, and its button refitted home, destination and pickup points together. The application now watches fresh high-accuracy foreground fixes, draws one current-location dot, and moves the camera directly to that position when requested. The circle appears when reported accuracy exceeds 50 metres and uses the reported metre radius. Invalid, stale and future-dated fixes are rejected. Leaving the map stops this watch; it does not publish location or start commute background sharing.

If the watch stops supplying fixes, the dot expires after 30 seconds and the rider sees a request to find their location again or set it manually. Hiding the page stops the foreground watch and clears the dot. Returning resumes only when location permission is already granted; the previous position stays hidden until a fresh fix arrives. Recentring checks freshness again.

Saved home/work use purple labelled pins; community pickups use green dots. Only an explicitly selected pickup gets a green labelled pin. Teardrop pin offsets account for the two pixels below the glyph tip; location dots use centre anchors. A rejected or unavailable GPS permission produces a persistent message and no invented device position.

The address picker no longer silently enables saving its default map centre when street maps are unavailable. The rider must choose a spot, obtain a genuine device fix, or enter valid coordinates and a label. It displays failures rather than swallowing permission errors. A stalled picker map opens the manual coordinate form within eight seconds; its fields remain empty until the rider supplies a real position.

Blank commute places cannot render saved pins or start matching. Malformed server geometry produces a clear account-loading error rather than fabricated zero coordinates; genuine `(0, 0)` coordinates remain valid. Street-map loading has an eight-second deadline and falls back after a network/style failure. Its fallback is labelled as an illustrative layout, while device and saved markers retain their actual coordinates. Passenger tracking places this notice below its status card so the bottom sheet cannot cover it.

## Automated evidence

`tests/unit/mapLocation.test.ts` covers coordinate order, fresh/invalid fixes, metre-sized accuracy geometry, movement updates, cleanup, cache rejection, denied permission and insecure-origin rejection. `tests/unit/accountSnapshotLocation.test.ts` checks both passenger and driver snapshot geometry, valid zero coordinates, and new accounts without places. `npx playwright test -c playwright.map.config.ts` runs nine map regression journeys on a 390-pixel screen at `http://127.0.0.1:5177`, including stale-fix expiry, hide/resume, blank-place gating, provider timeout, network failure and stalled address selection. Its mocked Supabase responses, dummy Mapbox token and injected GPS positions do not change any hosted data.

The screenshots in `docs/review/map/` show synthetic positions on the low-data schematic renderer. They prove marker UI and coordinate handling, and do not prove physical GPS accuracy, Android background behaviour, Mapbox tile availability or SMS delivery. The separate local-backend ride tests cover real application flows against local Supabase.

## Verify on a real phone

1. Use an HTTPS development or staging URL. `localhost` and `127.0.0.1` are secure contexts on the device hosting the browser. A phone opening `http://192.168…` on the computer's LAN is not; use an HTTPS development proxy/tunnel. This branch was not deployed.
2. Enable precise location for the browser/Lifty, allow the site's location permission, and stand outside. Open Home. The blue dot should appear at the phone's reported position. Green dots are meeting points and purple pins are saved addresses.
3. Walk 50–100 metres. The single blue dot should update; tap the target button to recenter on its latest position. Pan away and tap again to confirm the camera returns to the phone rather than the saved home.
4. Disable precise location or test indoors. If the provider reports accuracy over 50 metres, check that an accuracy circle and its distance label appear. Desktop Wi-Fi/IP fixes may be hundreds of metres off; the app cannot make the sensor more accurate.
5. Deny location, reload, and verify the message persists and no current-location dot appears. Open Plan Your Commute, change the start, and enter/select the correct spot manually.
6. Hide the browser/app and return. The previous dot must not return before a fresh fix; permission already granted resumes the watch. A watch that supplies no further fixes must hide its old dot after 30 seconds. Sign out or leave Home to stop the watch. Commute sharing uses its own membership/consent/window checks and is verified separately.
7. Disconnect mobile data before loading the street map. Within eight seconds it should display an illustrative layout and keep genuine location markers. Address selection should still offer valid manual coordinates.
