import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, hasSupabase } from '@/lib/env'

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(env.supabaseUrl!, env.supabaseKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null

export function sb(): SupabaseClient {
  if (!supabase) throw new Error('Lifty backend is not configured')
  return supabase
}

/** Public URL for files in public buckets (avatars, vehicle photos). */
export function publicFileUrl(bucket: 'avatars' | 'vehicle-photos', path?: string | null): string | undefined {
  if (!path || !supabase) return undefined
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('/')) return path
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

/** Current user id, kept in sync with the auth session (used by realtime feeds). */
export let currentUserId: string | null = null
if (supabase) {
  void supabase.auth.getSession().then(({ data }) => (currentUserId = data.session?.user.id ?? null))
  supabase.auth.onAuthStateChange((_e, session) => (currentUserId = session?.user.id ?? null))
}
