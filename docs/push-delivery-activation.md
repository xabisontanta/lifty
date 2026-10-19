# Android push delivery activation

Creating a Firebase project, registering `za.co.lifty.app`, or installing server credentials does not enable this worker's outbound push delivery.

The `pilot-worker` requires both server settings:

- `FCM_SERVICE_ACCOUNT_JSON`: a JSON object with nonempty string `project_id`, `client_email` and `private_key` values, stored only in Edge Function secrets.
- `PILOT_PUSH_DELIVERY_ENABLED=true`: exactly lowercase `true`. Missing, false or other values keep delivery off.

Its authorized response distinguishes `pushConfigured` (credential fields are present and correctly typed) from `pushDeliveryEnabled` (credentials plus explicit activation). Neither proves that Firebase accepted the credentials or a device received a message. Database worker health's existing `push_configured` value reflects effective delivery readiness because the worker passes that value to `claim_pilot_work`.

While disabled, the worker still claims and processes account/file cleanup. It passes `p_push_ready=false` when claiming work and also rejects unexpected push jobs before provider authentication or sending. Existing database guards still exclude test fixtures, suspended accounts and deleted destinations.

Activation can release eligible queued notifications for real users; there is no recipient allowlist or cutoff excluding old queued notifications. Review the target, backlog and physical-device validation before enabling delivery. Keep the local preview's worker cron disabled: its invocation function still targets the hosted Supabase URL.

This activation flag and updated worker have not been deployed. No server secrets were installed, cron jobs enabled or messages sent by this change. An older deployed worker would not enforce the new flag; install credentials only after verifying the guarded worker is deployed to the intended target.

Supabase documents [server secret configuration](https://supabase.com/docs/guides/functions/secrets). The cron endpoint also needs its dedicated worker-token authorization and the appropriate [per-function JWT configuration](https://supabase.com/docs/guides/functions/function-configuration); Firebase setup does not replace either.

## Verification, 19 October 2026

All 301 unit tests across 25 files passed, including 19 worker request checks for default-off claims and dispatch, malformed configuration, explicit activation, worker/destination authorization and cleanup while push is disabled. TypeScript, ESLint and the production build passed. Provider calls in these tests are mocked; native compilation and physical delivery remain unverified. No browser/backend journey was rerun because this follow-up changes only the worker and its configuration documentation; the user's frozen driver preview and accounts were retained.
