-- Deprecated. This old cleanup filename must never delete shared or production data.
-- Review supabase/remove-test-drivers-local.sql and use the fixed local runner:
-- node scripts/test-driver-tools.mjs cleanup --confirm-lifty-e2e
DO $$ BEGIN RAISE EXCEPTION 'remove-demo-lifts.sql is disabled. Use the confirmed local test-driver cleanup runner.'; END $$;
