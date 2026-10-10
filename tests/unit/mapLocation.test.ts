import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accuracyRing, freshLocation, mapboxPosition, validCoordinate } from '@/lib/mapLocation'
import { distanceM } from '@/lib/geo'
import { foregroundLocationPermission, getForegroundPosition, watchForegroundLocation } from '@/services/foregroundLocation'
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

const here = { lat: -29.5024, lng: 31.2331 }
function position(lat = here.lat, lng = here.lng, accuracy = 120, at = Date.now()) {
  return { timestamp: at, coords: { latitude: lat, longitude: lng, accuracy, heading: null, speed: null } }
}
let success: (p: ReturnType<typeof position>) => void
let failure: (e: { code: number }) => void
let geo: { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn>; getCurrentPosition: ReturnType<typeof vi.fn> }
beforeEach(() => {
  geo = { watchPosition: vi.fn((good, bad) => { success = good; failure = bad; return 7 }), clearWatch: vi.fn(), getCurrentPosition: vi.fn(good => good(position())) }
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { geolocation: geo, permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('map coordinates and current device location', () => {
  it('uses [longitude, latitude] for Mapbox, keeping a Salt Rock coordinate in South Africa', () => {
    expect(mapboxPosition(here)).toEqual([31.2331, -29.5024])
    expect(validCoordinate(here)).toBe(true)
  })
  it('rejects malformed coordinates and stale/future GPS fixes', () => {
    expect(validCoordinate({ lat: NaN, lng: 31 })).toBe(false)
    expect(validCoordinate({ lat: -29, lng: 181 })).toBe(false)
    expect(validCoordinate(null)).toBe(false)
    expect(freshLocation(null)).toBe(false)
    expect(freshLocation({ ...here, at: Date.now() - 31_000 })).toBe(false)
    expect(freshLocation({ ...here, at: Date.now() + 20_000 })).toBe(false)
    expect(freshLocation({ ...here, at: Date.now() })).toBe(true)
    expect(freshLocation({ ...here, at: 1000 }, 31_001)).toBe(false)
  })
  it('draws a closed metre-sized accuracy boundary around the actual point only above 50 m', () => {
    expect(accuracyRing(here, 50)).toEqual([])
    expect(accuracyRing(here, null)).toEqual([])
    const ring = accuracyRing(here, 140)
    expect(ring).toHaveLength(65); expect(ring[64]).toEqual(ring[0])
    for (const p of ring) expect(distanceM(here, p)).toBeCloseTo(140, 3)
  })
  it('updates with movement from a high-accuracy watch with no cached result', async () => {
    const receive = vi.fn(), error = vi.fn()
    const stop = await watchForegroundLocation(receive, error)
    expect(geo.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true, maximumAge: 0 }))
    success(position()); success(position(-29.503, 31.234, 8))
    expect(receive).toHaveBeenCalledTimes(2)
    expect(receive.mock.calls[1][0]).toMatchObject({ lat: -29.503, lng: 31.234, accuracyM: 8 })
    stop(); expect(geo.clearWatch).toHaveBeenCalledWith(7)
    success(position(-29.51, 31.24)); expect(receive).toHaveBeenCalledTimes(2)
  })
  it('never emits a cached position and keeps waiting for a fresh GPS fix', async () => {
    const receive = vi.fn(), error = vi.fn(); await watchForegroundLocation(receive, error)
    success(position(here.lat, here.lng, 100, Date.now() - 60_000))
    expect(receive).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining('fresh GPS'))
    success(position()); expect(receive).toHaveBeenCalledOnce()
  })
  it('explains denied permission and unavailable location without supplying fake coordinates', async () => {
    const receive = vi.fn(), error = vi.fn(); await watchForegroundLocation(receive, error)
    failure({ code: 1 }); expect(error).toHaveBeenCalledWith(expect.stringContaining('set your location manually'))
    expect(receive).not.toHaveBeenCalled()
  })
  it('rejects insecure phone LAN URLs before requesting GPS', async () => {
    vi.stubGlobal('window', { isSecureContext: false })
    await expect(watchForegroundLocation(vi.fn(), vi.fn())).rejects.toThrow('HTTPS or localhost')
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })
  it('returns a fresh actual position for selecting an address without 30-second cache reuse', async () => {
    await expect(getForegroundPosition()).resolves.toMatchObject(here)
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ maximumAge: 0, enableHighAccuracy: true }))
    geo.getCurrentPosition.mockImplementation(good => good(position(here.lat, here.lng, 100, Date.now() - 40_000)))
    await expect(getForegroundPosition()).rejects.toThrow('out of date')
  })
  it('checks existing permission without starting GPS', async () => {
    expect(await foregroundLocationPermission()).toBe('granted')
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })
})
