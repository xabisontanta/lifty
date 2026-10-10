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
