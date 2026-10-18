import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriverSetupInput } from '@/services/api'
import { env } from '@/lib/env'

const harness = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn(), from: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn() }))
vi.mock('@/services/supabase', () => ({
  currentUserId: 'driver-owner', publicFileUrl: () => undefined,
  sb: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'driver-owner' } } }) }, rpc: harness.rpc, from: harness.from }),
}))
vi.mock('@/services/pilotApi', () => ({ pilotMethods: {}, pilotRpc: vi.fn() }))
import { liveApi } from '@/services/liveApi'

const place = { label: 'Fixture place', area: 'Fixture area', location: { lng: 31.23, lat: -29.52 } }
const setup = (offerReturn: boolean): DriverSetupInput => ({
  vehicle: { registration: 'ND TEST123', make: 'Toyota', model: 'Corolla', year: '2024', colour: 'Blue', seats: 4, bodyType: 'sedan' },
  legs: (offerReturn ? ['to_work', 'to_home'] as const : ['to_work'] as const).map(direction => ({
    direction, origin: place, destination: place, departure: direction === 'to_work' ? '06:30' : '17:00', days: [0, 1, 2, 3, 4],
    route: { coordinates: [[31.23, -29.52], [31.06, -29.72]], distanceM: 30000, durationS: 1800 },
  })), seats: 4, maxDeviationMin: 8, pickupPolicy: 'flexible', monthlyContribution: 300,
})

beforeEach(() => {
  harness.rpc.mockReset().mockImplementation(async (name, args) => ({ data: name === 'upsert_driver_leg' ? args.p_direction === 'to_home' ? 'evening-leg' : 'morning-leg' : null, error: null }))
  harness.upsert.mockReset().mockResolvedValue({ error: null })
  harness.maybeSingle.mockReset().mockResolvedValue({ data: { id: 'evening-leg' }, error: null })
  const query = { eq: harness.eq, maybeSingle: harness.maybeSingle }
  harness.eq.mockReset().mockReturnValue(query)
  harness.from.mockReset().mockImplementation(table => table === 'vehicles' ? { upsert: harness.upsert } : { select: () => query })
})

describe('saving driver return offers', () => {
  it('pauses only new evening requests when the return offer is turned off', async () => {
    await liveApi.saveDriverSetup(setup(false))
    expect(harness.rpc).toHaveBeenCalledWith('set_driver_requests_paused', { p_leg: 'evening-leg', p_paused: true })
    expect(harness.eq.mock.calls).toEqual([['driver_id', 'driver-owner'], ['direction', 'to_home']])
    expect(harness.rpc.mock.calls.filter(([name]) => name === 'upsert_driver_leg')).toHaveLength(1)
    expect(harness.from.mock.calls.map(([table]) => table)).toEqual(['driver_legs'])
  })

  it('does not create a return leg when a fresh driver offers only the morning', async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: null })
    await liveApi.saveDriverSetup(setup(false))
    expect(harness.rpc.mock.calls.some(([name]) => name === 'set_driver_requests_paused')).toBe(false)
  })

  it('reopens the evening offer only after its publication succeeds', async () => {
    await liveApi.saveDriverSetup(setup(true))
    expect(harness.rpc.mock.calls.map(([name]) => name)).toEqual(['save_driver_vehicle', 'upsert_driver_leg', 'upsert_driver_leg', 'set_driver_requests_paused'])
    expect(harness.rpc).toHaveBeenLastCalledWith('set_driver_requests_paused', { p_leg: 'evening-leg', p_paused: false })
    expect(harness.maybeSingle).not.toHaveBeenCalled()
  })

  it('reports a failed pause instead of claiming the return offer was saved', async () => {
    harness.rpc.mockImplementation(async (name) => name === 'set_driver_requests_paused'
      ? { data: null, error: { message: 'Connection lost' } } : { data: 'morning-leg', error: null })
    await expect(liveApi.saveDriverSetup(setup(false))).rejects.toThrow('Connection lost')
  })

  it('never reopens requests after a rejected route edit', async () => {
    harness.rpc.mockImplementation(async (_name, args) => args.p_direction === 'to_home'
      ? { data: null, error: { message: 'This route has active agreements' } } : { data: 'morning-leg', error: null })
    await expect(liveApi.saveDriverSetup(setup(true))).rejects.toThrow('active agreements')
    expect(harness.rpc.mock.calls.some(([name]) => name === 'set_driver_requests_paused')).toBe(false)
  })

  it('saves a vehicle through the validated RPC and converts its owned photo URL to a storage path', async () => {
    const input = setup(true)
    input.vehicle.photoUrl = `${env.supabaseUrl}/storage/v1/object/public/vehicle-photos/driver-owner/vehicle-123.png`
    await liveApi.saveDriverSetup(input)
    expect(harness.rpc).toHaveBeenCalledWith('save_driver_vehicle', { p_vehicle: {
      make: 'Toyota', model: 'Corolla', year: 2024, colour: 'Blue', bodyType: 'sedan',
      registrationSummary: 'ND ••• 123', seats: 4, photoPath: 'driver-owner/vehicle-123.png',
    } })
    expect(harness.upsert).not.toHaveBeenCalled()
  })

  it('rejects a foreign car photo and a failed vehicle save before publishing routes', async () => {
    const input = setup(true)
    input.vehicle.photoUrl = 'https://unrelated.invalid/car.jpg'
    await expect(liveApi.saveDriverSetup(input)).rejects.toThrow('your own car photo')
    expect(harness.rpc).not.toHaveBeenCalled()
    harness.rpc.mockResolvedValue({ data: null, error: { message: 'Vehicle details invalid' } })
    await expect(liveApi.saveDriverSetup(setup(true))).rejects.toThrow('Vehicle details invalid')
    expect(harness.rpc.mock.calls.map(([name]) => name)).toEqual(['save_driver_vehicle'])
  })
})
