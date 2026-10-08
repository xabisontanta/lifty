export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  mapboxToken: import.meta.env.VITE_MAPBOX_TOKEN as string | undefined,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  proxyCallNumber: import.meta.env.VITE_PROXY_CALL_NUMBER as string | undefined,
}

export const hasSupabase = !!(env.supabaseUrl && env.supabaseKey)
export const hasMapbox = !!env.mapboxToken
