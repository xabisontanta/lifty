/** Exact, reviewed-reference illustrations. A free-text request never chooses a car image. */
export interface VehicleSpec { make: string; model: string; year: number; colour: string; bodyType: string }
export const colours = ['white', 'silver', 'grey', 'black', 'blue', 'red', 'green', 'brown', 'beige', 'yellow', 'orange', 'purple', 'gold']
const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
export function normaliseVehicle(value: unknown): VehicleSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['make', 'model', 'year', 'colour', 'bodyType'].includes(k))) return null
  if (typeof v.make !== 'string' || typeof v.model !== 'string' || typeof v.colour !== 'string' || typeof v.bodyType !== 'string') return null
  let make = clean(v.make), colour = clean(v.colour)
  if (make === 'vw') make = 'volkswagen'
  if (colour === 'gray') colour = 'grey'
  const model = clean(v.model), bodyType = clean(v.bodyType)
  if (!/^[\p{L}\p{N} .+'()-]{1,80}$/u.test(make) || !/^[\p{L}\p{N} .+'()-]{1,100}$/u.test(model)) return null
  if (!Number.isInteger(v.year) || (v.year as number) < 1980 || (v.year as number) > 2100 || !colours.includes(colour)) return null
  if (!['sedan', 'hatchback', 'suv', 'other'].includes(bodyType)) return null
  return { make, model, year: v.year as number, colour, bodyType }
}

export interface Claim {
  status: 'ready' | 'claimed' | 'processing' | 'unavailable' | 'rate-limit' | 'not-owned' | 'account-unavailable'
  code?: string
  vehicleKey?: string
  storagePath?: string
  lease?: string
  referencePath?: string
}
export interface IllustrationDb {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string } | null } }> }
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}
export interface ImageFile { bytes: Uint8Array; contentType: string }
export interface Dependencies {
  db: IllustrationDb
  /** Null disables paid generation. Cached reads still work. */
  provider: ((vehicle: VehicleSpec, reference: ImageFile, userId: string) => Promise<ImageFile>) | null
  downloadReference(path: string): Promise<ImageFile>
  upload(path: string, file: ImageFile): Promise<void>
  signedUrl(path: string): Promise<string>
  remove(path: string): Promise<void>
  log?: (message: string) => void
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const unavailable = (code: string, status: number) => json({ status: 'unavailable', code }, status)

export async function handle(req: Request, deps: Dependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return unavailable('method-not-allowed', 405)
  const jwt = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  let user: { id: string } | null
  try { user = jwt ? (await deps.db.auth.getUser(jwt)).data.user : null } catch { return unavailable('auth', 401) }
  if (!user) return unavailable('auth', 401)
  let body: Record<string, unknown>
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return unavailable('invalid-request', 400)
    const text = await req.text()
    if (text.length > 4096) return unavailable('invalid-request', 400)
    body = JSON.parse(text)
  } catch { return unavailable('invalid-request', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['vehicle', 'generate'].includes(k))
    || (body.generate !== undefined && typeof body.generate !== 'boolean')) return unavailable('invalid-request', 400)
  const vehicle = normaliseVehicle(body.vehicle)
  if (!vehicle) return unavailable('invalid-vehicle', 400)
  const generate = body.generate === true
  let claim: Claim
  try {
    const result = await deps.db.rpc('claim_vehicle_illustration', { p_user: user.id, p_vehicle: vehicle, p_generate: generate, p_provider_enabled: Boolean(deps.provider) })
    if (result.error || !result.data) throw new Error('Illustration claim unavailable')
    claim = result.data as Claim
  } catch { return unavailable('service-unavailable', 503) }
  if (claim.status === 'account-unavailable') return unavailable('auth', 403)
  if (claim.status === 'not-owned') return unavailable('vehicle-changed', 409)
  if (claim.status === 'rate-limit') return unavailable('rate-limit', 429)
  if (claim.status === 'processing') return json({ status: 'processing', retryAfterSeconds: 10 }, 202)
  if (claim.status === 'unavailable') return unavailable(claim.code ?? 'cache-miss', claim.code === 'provider-unconfigured' ? 503 : 404)
  const ready = async (path: string) => json({ status: 'ready', imageUrl: await deps.signedUrl(path), vehicleKey: claim.vehicleKey, vehicle,
    label: 'AI vehicle illustration', source: 'generated', referenceReviewed: true })
  if (claim.status === 'ready' && claim.storagePath) {
    try { return await ready(claim.storagePath) } catch { return unavailable('image-unavailable', 503) }
  }
  if (claim.status !== 'claimed' || !claim.referencePath || !claim.vehicleKey || !claim.lease || !deps.provider || !generate) return unavailable('service-unavailable', 503)
  const outputPath = `${claim.vehicleKey}/${claim.lease}.webp`
  let uploaded = false
  let committed = false
  try {
    const reference = await deps.downloadReference(claim.referencePath)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.contentType) || reference.bytes.length > 8 * 1024 * 1024) throw new Error('Invalid catalogue reference')
    const image = await deps.provider(vehicle, reference, user.id)
    if (image.contentType !== 'image/webp' || image.bytes.length === 0 || image.bytes.length > 8 * 1024 * 1024) throw new Error('Invalid generated image')
    await deps.upload(outputPath, image)
    uploaded = true
    const saved = await deps.db.rpc('finish_vehicle_illustration', { p_key: claim.vehicleKey, p_lease: claim.lease, p_storage_path: outputPath })
    if (saved.error || saved.data !== true) throw new Error('Illustration lease expired')
    committed = true
    return await ready(outputPath)
  } catch {
    // No personal details, provider response bodies, tokens or reference paths in logs.
    deps.log?.('Vehicle illustration generation did not complete')
    // A signed-URL outage must not delete a successfully committed shared cache.
    if (committed) return unavailable('image-unavailable', 503)
    if (uploaded) await deps.remove(outputPath).catch(() => {})
    await deps.db.rpc('finish_vehicle_illustration', { p_key: claim.vehicleKey, p_lease: claim.lease, p_storage_path: null }).then(() => {}, () => {})
    return unavailable('generation-unavailable', 503)
  }
}

/** Uses only a reviewed model reference; no text-only generation or guessed model fallback. */
export function openAiProvider(key: string, fetchImpl: typeof fetch = fetch): NonNullable<Dependencies['provider']> {
  return async (vehicle, reference, userId) => {
    const base64 = (bytes: Uint8Array) => {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(binary)
    }
    const identity = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)))
    const safetyIdentifier = [...identity].map(v => v.toString(16).padStart(2, '0')).join('')
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: 'gpt-image-2-2026-04-21', images: [{ image_url: `data:${reference.contentType};base64,${base64(reference.bytes)}` }],
        prompt: `Create a clean studio vehicle illustration on a plain pale background using this reviewed reference for the South African ${vehicle.year} ${vehicle.make} ${vehicle.model}, ${vehicle.bodyType}. Preserve the exact reference model generation, silhouette, lights, grille, bumpers and body shape. Only change exterior paint to ${vehicle.colour}. Do not substitute a similar car, invent a different trim, add people, or include a registration number. Do not add text. This is an illustration, not evidence of the driver's actual vehicle.`,
        n: 1, size: '1536x1024', quality: 'medium', output_format: 'webp', output_compression: 85, background: 'opaque', safety_identifier: safetyIdentifier }),
    })
    if (!response.ok) throw new Error('Image provider unavailable')
    const data = await response.json() as { data?: { b64_json?: string }[] }
    const encoded = data.data?.[0]?.b64_json
    if (!encoded || encoded.length > 12 * 1024 * 1024) throw new Error('Invalid image provider response')
    return { bytes: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), contentType: 'image/webp' }
  }
}
