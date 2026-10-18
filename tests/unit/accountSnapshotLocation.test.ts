import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api'

vi.mock('@/services/liveApi', () => ({ hueFor: () => 200 }))
vi.mock('@/services/supabase', () => ({ sb: vi.fn(), publicFileUrl: () => undefined }))
import { mapAccount } from '@/services/pilotApi'

const point = (lng = 31.23, lat = -29.52) => ({ type: 'Point', coordinates: [lng, lat] })
const snapshot = () => ({
  profile: { id: 'location-fixture', role: 'passenger', first_name: 'Map', last_initial: 'Q', created_at: '2026-10-10T00:00:00Z' },
  private: {},
  commutes: [{ direction: 'to_work', origin_label: 'Home', destination_label: 'Work', originPoint: point(), destinationPoint: point(31.06, -29.72), days: [0], arrive_by: '08:00:00', max_walk_m: 750 }],
  legs: [],
})

describe('account snapshot locations', () => {
  it('retains actual longitude/latitude, including legitimate zero coordinates', () => {
    const account = snapshot()
    account.commutes[0].originPoint = point(0, 0)
    expect(mapAccount(account).commutes[0].origin.location).toEqual({ lng: 0, lat: 0 })
    expect(mapAccount(account).commutes[0].destination.location).toEqual({ lng: 31.06, lat: -29.72 })
  })

  it.each([undefined, null, {}, { coordinates: [31.23] }, { coordinates: ['31.23', '-29.52'] }, { coordinates: [null, null] }, point(181, -29), point(31, 91), point(NaN, -29), { type: 'LineString', coordinates: [31, -29] }])('rejects malformed passenger geometry instead of inventing a location: %j', geometry => {
    const account = snapshot()
    account.commutes[0].originPoint = geometry as any
    expect(() => mapAccount(account)).toThrow(ApiError)
    expect(() => mapAccount(account)).toThrow('saved commute location could not be loaded')
  })

  it('validates both evening commute endpoints', () => {
    const account = snapshot()
    account.commutes[0].direction = 'to_home'
    account.commutes[0].destinationPoint = null as any
    expect(() => mapAccount(account)).toThrow(ApiError)
  })

  it('rejects malformed driver-leg geometry', () => {
    const account = { ...snapshot(), vehicle: { seats_total: 4 }, legs: [{ direction: 'to_work', origin_label: 'Home', destination_label: 'Work', originPoint: point(), destinationPoint: null, departure_time: '07:00:00', days: [0], routeGeometry: { coordinates: [] }, route_distance_m: 1, route_duration_s: 1 }] }
    expect(() => mapAccount(account)).toThrow(ApiError)
  })

  it('permits a new account with no saved places', () => {
    expect(mapAccount({ ...snapshot(), commutes: [] }).commutes).toEqual([])
  })
})

describe('driver setup snapshot', () => {
  const leg = (direction: 'to_work' | 'to_home', overrides: Record<string, unknown> = {}) => ({
    direction, origin_label: 'Home', destination_label: 'Work', originPoint: point(), destinationPoint: point(31.06, -29.72),
    departure_time: direction === 'to_work' ? '06:30:00' : '17:00:00', days: [0, 1, 2, 3, 4],
    routeGeometry: { coordinates: [[31.23, -29.52], [31.06, -29.72]] }, route_distance_m: 30000, route_duration_s: 1800,
    seats_open: 1, max_deviation_min: 7, monthly_contribution: 250, pickup_policy: 'door_to_door', ...overrides,
  })
  const driverSnapshot = (legs: ReturnType<typeof leg>[]) => ({ ...snapshot(), commutes: [], vehicle: { seats_total: 4 }, memberCount: 2, legs })

  it('uses morning settings even when the backend returns the evening leg first', () => {
    const legs = [leg('to_home', { seats_open: 3, max_deviation_min: 20, monthly_contribution: 800, pickup_policy: 'meeting_point' }), leg('to_work')]
    const setup = mapAccount(driverSnapshot(legs)).driverSetup!
    expect(setup).toMatchObject({ seats: 3, maxDeviationMin: 7, monthlyContribution: 250, pickupPolicy: 'door_to_door' })
    expect(setup.legs.map(item => item.direction)).toEqual(['to_work', 'to_home'])
    expect(legs[0].direction).toBe('to_home')
  })

  it('retains paused evening offers in the snapshot so accepted trips stay accessible', () => {
    const setup = mapAccount(driverSnapshot([leg('to_work'), leg('to_home', { requests_paused: true })])).driverSetup!
    expect(setup.legs).toHaveLength(2)
    expect(setup.legs.find(item => item.direction === 'to_home')?.requestsPaused).toBe(true)
    expect(setup.legs.find(item => item.direction === 'to_work')?.requestsPaused).toBe(false)
  })

  it('does not add the morning member count to an evening-only leg', () => {
    const setup = mapAccount(driverSnapshot([leg('to_home', { seats_open: 3 })])).driverSetup!
    expect(setup.seats).toBe(4)
  })
})
