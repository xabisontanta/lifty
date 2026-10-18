import { beforeEach, expect, test, vi } from 'vitest'
import { fetchVehicleIllustration, vehicleExample, vehicleIdentityKey, type VehicleIdentity } from '@/services/vehicleIllustration'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/services/supabase', () => ({ sb: () => ({ functions: { invoke } }) }))
const polo: VehicleIdentity = { make: 'Volkswagen', model: 'Polo Vivo', year: 2022, colour: 'Silver', bodyType: 'hatchback' }
beforeEach(() => invoke.mockReset())

test('normalises supported aliases without confusing distinct models, years or paints', () => {
  expect(vehicleIdentityKey({ ...polo, make: ' VW ', model: ' Polo   Vivo ', colour: ' SILVER ' })).toBe(vehicleIdentityKey(polo))
  expect(vehicleIdentityKey({ ...polo, colour: 'gray' })).toBe(vehicleIdentityKey({ ...polo, colour: 'grey' }))
  for (const change of [{ model: 'Polo' }, { year: 2023 }, { colour: 'Blue' }, { bodyType: 'sedan' as const }]) {
    expect(vehicleIdentityKey({ ...polo, ...change })).not.toBe(vehicleIdentityKey(polo))
    expect(vehicleExample({ ...polo, ...change })).toBeNull()
  }
})
test('incomplete and invalid-year details never trigger generation', async () => {
  for (const change of [{ model: '' }, { make: ' ' }, { year: NaN }, { year: 0 }, { year: 9999 }, { year: 2022.5 }, { colour: '' }]) {
    expect(vehicleIdentityKey({ ...polo, ...change })).toBeNull()
    expect(await fetchVehicleIllustration({ ...polo, ...change }, true)).toEqual({ status: 'unavailable', code: 'incomplete-vehicle' })
  }
  expect(invoke).not.toHaveBeenCalled()
})
test('the exact preview example is labelled AI illustration and never claimed reviewed', async () => {
  const image = await fetchVehicleIllustration(polo)
  expect(image).toMatchObject({ status: 'ready', source: 'example', referenceReviewed: false })
  expect(invoke).not.toHaveBeenCalled()
})
test('passenger card lookup is passive; only owner setup opts into generation', async () => {
  invoke.mockResolvedValue({ data: { status: 'unavailable', code: 'reference-unavailable' }, error: null })
  const unknown = { ...polo, model: 'Corolla', make: 'Toyota' }
  await fetchVehicleIllustration(unknown)
  expect(invoke).toHaveBeenLastCalledWith('vehicle-illustration', expect.objectContaining({ body: { vehicle: unknown, generate: false } }))
  await fetchVehicleIllustration(unknown, true)
  expect(invoke).toHaveBeenLastCalledWith('vehicle-illustration', expect.objectContaining({ body: { vehicle: unknown, generate: true } }))
})
test('missing provider, unknown reference and HTTP failure never produce an arbitrary image', async () => {
  const other = { ...polo, colour: 'Blue' }
  invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ status: 'unavailable', code: 'provider-unconfigured' }), { status: 503 }) } })
  expect(await fetchVehicleIllustration(other, true)).toEqual({ status: 'unavailable', code: 'provider-unconfigured' })
  invoke.mockRejectedValue(new Error('offline'))
  expect(await fetchVehicleIllustration(other)).toEqual({ status: 'unavailable', code: 'unavailable' })
  invoke.mockResolvedValue({ data: { status: 'ready', imageUrl: 'javascript:alert(1)' } })
  expect(await fetchVehicleIllustration(other)).toEqual({ status: 'unavailable', code: 'unavailable' })
})
