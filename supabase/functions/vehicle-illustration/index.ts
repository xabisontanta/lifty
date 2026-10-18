import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { handle, openAiProvider } from './handler.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
// Both are required so installing a key alone never silently activates paid image requests.
const key = Deno.env.get('VEHICLE_ILLUSTRATION_GENERATION_ENABLED') === 'true' ? Deno.env.get('OPENAI_API_KEY') : null
const output = db.storage.from('vehicle-illustrations')
Deno.serve(req => handle(req, {
  db, provider: key ? openAiProvider(key) : null,
  async downloadReference(path) {
    const result = await db.storage.from('vehicle-illustration-references').download(path)
    if (result.error || !result.data) throw new Error('Reference unavailable')
    return { bytes: new Uint8Array(await result.data.arrayBuffer()), contentType: result.data.type }
  },
  async upload(path, image) {
    const result = await output.upload(path, image.bytes, { contentType: image.contentType, upsert: false })
    if (result.error) throw new Error('Image upload unavailable')
  },
  async signedUrl(path) {
    const result = await output.createSignedUrl(path, 900)
    if (result.error || !result.data?.signedUrl) throw new Error('Image unavailable')
    return result.data.signedUrl
  },
  async remove(path) { await output.remove([path]) },
  log: message => console.error(message),
}))
