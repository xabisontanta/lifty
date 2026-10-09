// find-matches — Supabase Edge Function entry point. All logic lives in handler.ts (unit-tested; also served by the
// local sandbox); this file only wires in the Deno runtime: the service-role client and the optional Mapbox secret.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { handle } from './handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

Deno.serve((req) => handle(req, { db, mapboxSecret: Deno.env.get('MAPBOX_TOKEN') ?? null, log: (m) => console.error(m) }))
