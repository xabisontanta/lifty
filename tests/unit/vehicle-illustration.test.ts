import { describe, expect, it, vi } from 'vitest'
import { handle, normaliseVehicle, openAiProvider, type Claim, type Dependencies } from '../../supabase/functions/vehicle-illustration/handler'

const vehicle = { make: 'Volkswagen', model: 'Polo Vivo', year: 2022, colour: 'Silver', bodyType: 'hatchback' }
const key = 'a'.repeat(64), lease = '00000000-0000-4000-8000-000000000001', path = `${key}/${lease}.webp`
function harness(claim: Claim, enabled = true) {
  const rpc = vi.fn(async (name: string) => ({ data: name === 'claim_vehicle_illustration' ? claim : true, error: null }))
  const provider = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' }))
  const deps: Dependencies = { db: { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'driver-uuid' } } })) }, rpc },
    provider: enabled ? provider : null, downloadReference: vi.fn(async () => ({ bytes: new Uint8Array([4, 5]), contentType: 'image/png' })),
    upload: vi.fn(async () => {}), remove: vi.fn(async () => {}), signedUrl: vi.fn(async () => 'https://local.invalid/signed.webp') }
  return { deps, provider, rpc }
}
const request = (body: unknown = { vehicle }, token = true) => new Request('http://local.invalid/vehicle-illustration', {
  method: 'POST', headers: token ? { Authorization: 'Bearer local-token' } : {}, body: JSON.stringify(body),
})
describe('exact vehicle image contract', () => {
  it('canonicalises only safe aliases and whitespace', () => {
    expect(normaliseVehicle({ ...vehicle, make: '  VW ', model: 'Polo   Vivo', colour: 'gray' })).toEqual({ ...vehicle, make: 'volkswagen', model: 'polo vivo', colour: 'grey' })
  })
  it.each([{ ...vehicle, year: '2022' }, { ...vehicle, year: 2022.5 }, { ...vehicle, colour: 'random' }, { ...vehicle, bodyType: 'van' }, { ...vehicle, prompt: 'draw a BMW' }, { ...vehicle, model: '' }])('rejects invalid metadata: %o', value => expect(normaliseVehicle(value)).toBeNull())
  it('rejects unauthenticated requests before storage, DB and provider work', async () => {
    const h = harness({ status: 'claimed' })
    expect((await handle(request({ vehicle }, false), h.deps)).status).toBe(401)
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled()
  })
  it('does not let body user ID, prompt or credentials influence authorization', async () => {
    const h = harness({ status: 'ready', storagePath: path })
    expect((await handle(request({ vehicle, userId: 'other-person' }), h.deps)).status).toBe(400)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('defaults to a passive cache read which can never generate', async () => {
    const h = harness({ status: 'ready', vehicleKey: key, storagePath: path })
    const response = await handle(request(), h.deps)
    expect(response.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledWith('claim_vehicle_illustration', expect.objectContaining({ p_user: 'driver-uuid', p_generate: false }))
    expect(h.provider).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ source: 'generated', referenceReviewed: true, label: 'AI vehicle illustration', vehicleKey: key })
  })
  it.each([['reference-unavailable', 404], ['provider-unconfigured', 503], ['cache-miss', 404]])('returns %s without a substitute image', async (code, status) => {
    const h = harness({ status: 'unavailable', code: code as string }, false)
    const response = await handle(request({ vehicle, generate: true }), h.deps)
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ status: 'unavailable', code })
    expect(h.deps.downloadReference).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled()
  })
  it('blocks a changed or unrelated vehicle before paid provider work', async () => {
    const h = harness({ status: 'not-owned' })
    expect((await handle(request({ vehicle, generate: true }), h.deps)).status).toBe(409)
    expect(h.provider).not.toHaveBeenCalled()
  })
  it('returns the deduplicated in-flight state without a second provider call', async () => {
    const h = harness({ status: 'processing' })
    const response = await handle(request({ vehicle, generate: true }), h.deps)
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ status: 'processing', retryAfterSeconds: 10 })
    expect(h.provider).not.toHaveBeenCalled()
  })
  it('enforces the durable quota response without generating', async () => {
    const h = harness({ status: 'rate-limit' })
    expect((await handle(request({ vehicle, generate: true }), h.deps)).status).toBe(429)
    expect(h.provider).not.toHaveBeenCalled()
  })
  it('uses the reviewed reference and saves a lease-specific file before marking it ready', async () => {
    const h = harness({ status: 'claimed', vehicleKey: key, lease, referencePath: 'reviewed/polo-2022.png' })
    const response = await handle(request({ vehicle, generate: true }), h.deps)
    expect(response.status).toBe(200)
    expect(h.deps.downloadReference).toHaveBeenCalledWith('reviewed/polo-2022.png')
    expect(h.provider).toHaveBeenCalledWith(normaliseVehicle(vehicle), expect.objectContaining({ contentType: 'image/png' }), 'driver-uuid')
    expect(h.deps.upload).toHaveBeenCalledWith(path, expect.objectContaining({ contentType: 'image/webp' }))
    expect(h.rpc).toHaveBeenLastCalledWith('finish_vehicle_illustration', { p_key: key, p_lease: lease, p_storage_path: path })
  })
  it('removes the orphan and never publishes after a lease is lost', async () => {
    const h = harness({ status: 'claimed', vehicleKey: key, lease, referencePath: 'ref.png' })
    h.rpc.mockImplementation(async name => ({ data: name === 'claim_vehicle_illustration' ? { status: 'claimed', vehicleKey: key, lease, referencePath: 'ref.png' } : false, error: null }))
    expect((await handle(request({ vehicle, generate: true }), h.deps)).status).toBe(503)
    expect(h.deps.remove).toHaveBeenCalledWith(path)
    expect(h.deps.signedUrl).not.toHaveBeenCalled()
  })
  it('retains committed output when URL signing temporarily fails', async () => {
    const h = harness({ status: 'claimed', vehicleKey: key, lease, referencePath: 'ref.png' })
    h.deps.signedUrl = vi.fn(async () => { throw new Error('storage signing offline') })
    expect((await handle(request({ vehicle, generate: true }), h.deps)).status).toBe(503)
    expect(h.deps.remove).not.toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledTimes(2)
  })
  it('does not expose provider error bodies or secrets in responses', async () => {
    const h = harness({ status: 'claimed', vehicleKey: key, lease, referencePath: 'ref.png' })
    h.deps.provider = async () => { throw new Error('secret-token private-reference-path') }
    const response = await handle(request({ vehicle, generate: true }), h.deps)
    expect(await response.text()).toBe('{"status":"unavailable","code":"generation-unavailable"}')
  })
  it('sends a fixed reference-edit prompt, hashed safety ID and server credential only to the official endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { status: 200 }))
    const result = await openAiProvider('server-only-test-key', fetcher as typeof fetch)(normaliseVehicle(vehicle)!, { bytes: new Uint8Array([4, 5]), contentType: 'image/png' }, 'driver-uuid')
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]))
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    const payload = JSON.parse(options.body as string)
    expect(payload.images).toEqual([{ image_url: 'data:image/png;base64,BAU=' }])
    expect(payload.prompt).toContain('2022 volkswagen polo vivo')
    expect(payload.prompt).toContain('paint to silver')
    expect(payload.safety_identifier).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(payload)).not.toContain('driver-uuid')
  })
})
