# Vehicle illustrations

The app must not display a different car because an exact image is unavailable. Actual vehicle photos and driver verification remain separate from generated illustrations.

The optional `vehicle-illustration` Edge Function serves a cache indexed by canonical make, model, **exact model year**, colour, body type, and reviewed reference version. `vw` maps to `volkswagen`; `gray` maps to `grey`. It does not infer a model from a similar name, substitute a different year/body style, or use a random paint. Model year should describe the vehicle generation, rather than first-registration year.

POST with the current Supabase bearer session:

```json
{"vehicle":{"make":"Volkswagen","model":"Polo Vivo","year":2022,"colour":"silver","bodyType":"hatchback"},"generate":false}
```

`generate` defaults to `false`. Every active signed-in user can read an existing model illustration without causing paid provider work. The response is `ready` with a 15-minute signed `imageUrl`, `vehicleKey`, canonical `vehicle`, `source: "generated"`, `label: "AI vehicle illustration"`, and `referenceReviewed: true`. That last field describes the **source reference review**, not approval of the driver's actual vehicle or a guarantee that AI reproduced every trim detail.

Explicit `generate: true` first checks that a driver owns the exact current saved vehicle or onboarding draft. Save the draft before asking for generation. Concurrent requests share one database lease, and a new generation attempt counts against a limit of three per user per Johannesburg calendar day. A cache entry has at most three attempts, with a one-hour backoff after failure. Passive reads and in-flight/cache hits consume no provider quota.

Expected responses: HTTP 202 `processing` with `retryAfterSeconds: 10`; HTTP 404 `unavailable` with `reference-unavailable` or `cache-miss`; HTTP 503 `provider-unconfigured`, `generation-unavailable`, or `image-unavailable`; HTTP 409 `vehicle-changed`; HTTP 429 `rate-limit`. The client should retain the written vehicle details, colour swatch and real-photo option in every unavailable state. Onboarding must remain usable without image generation.

No provider key or approved source references were installed by this change. Generation requires **both** server-only `OPENAI_API_KEY` and `VEHICLE_ILLUSTRATION_GENERATION_ENABLED=true`. Adding a key alone does not enable spending. No secrets belong in `VITE_` variables. The local gateway follows the same opt-in rules.

The local UI includes one explicitly unreviewed example at `public/images/vehicles/volkswagen-polo-vivo-2022-silver.png` (approximately 1.9 MB, the original PNG from the built-in image-generation tool). Its prompt requested a 2022 South African Volkswagen Polo Vivo 1.4 Trendline, silver, five-door hatchback, older 6R body rather than an MQB Polo or 2025 facelift, front three-quarter studio view on white, without an actual registration plate. The asset is selected only for that make/model/year/colour/body tuple and labelled as an AI illustration. It is not a licensed, human-approved runtime source reference, does not populate the backend catalogue, and does not demonstrate automatic generation for other vehicles. Its visual fidelity has not been certified against an individual driver's car.

Before activation, an operator must upload a licensed, accurate model reference to the private `vehicle-illustration-references` bucket and insert a matching row in `lifty_private.vehicle_illustration_references`. Record its source, confirm reuse rights, have a person check the exact make/model/year/body style, record `reviewed_at` and reviewer identity, and only then activate it. References start empty; there is no broad admin UI or public reference-write endpoint. Replacing a reference requires a new review timestamp so its earlier cache is invalidated. Private output files live in `vehicle-illustrations`; browsers cannot write either bucket. Retired generated cache files can be removed by a scoped maintenance task after their signed URLs expire.

Generation edits that reviewed reference's colour with a fixed server prompt. It never performs free-text car generation. AI output remains an illustration and should be checked by the driver; uploaded real vehicle photos are the reliable recognition evidence for passengers. No illustration updates document review or grants driver approval.

Provider integrations must be licensed for the actual use. IMAGIN's default `getImage` can return the closest model, a substitute colour, or a placeholder, and their standard agreement requires serving directly from their CDN. Therefore a guessed IMAGIN URL is deliberately not used as an exact-model fallback. See [IMAGIN image behavior](https://docs.imagin.studio/api-integration/manuals/getimage-api-behavior-and-timing), [IMAGIN usage terms](https://docs.imagin.studio/api-integration/manuals/getting-started), and the [official OpenAI image-edit API](https://developers.openai.com/api/reference/resources/images/methods/edit).

Verify locally with `npx vitest run tests/unit/vehicle-illustration.test.ts` and `node scripts/test-vehicle-illustrations.mjs`. SQL assertions roll back; the concurrency test creates and removes only newly allocated fixture UUIDs, and the script refuses hosted databases. These prove validation, ownership, cache/lease/quota rules, one claim under six concurrent requests, and provider wiring using mocks. They do not prove paid provider delivery or visual fidelity for arbitrary vehicles.

## Preview asset prompt

Generated with the built-in image-generation tool and saved unchanged to `public/images/vehicles/volkswagen-polo-vivo-2022-silver.png`:

> Use case: product-mockup. Asset: a labelled-in-app vehicle-model illustration for a South African commuting app. Make one photorealistic studio catalogue render of a SILVER 2022 Volkswagen Polo Vivo 1.4 Trendline five-door hatchback, South African market, right-hand drive. IMPORTANT model geometry: the second-generation South African Polo Vivo introduced in 2018, based on the older Polo 6R body, NOT the larger newer MQB Polo/GTI and NOT the facelift 2025 Vivo. Compact rounded rectangular halogen headlights, simple narrow grille, standard base-model wheel covers, correct five-door hatchback side profile. Silver metallic body with black tyres, dark windows and no people. Front three-quarter view showing whole car, pointing to image left, on a clean white/light grey studio background with subtle contact shadow. No lettering, no licence plate text or invented registration, no watermarks. This is a representative model illustration, not a photo of any actual driver's vehicle.
