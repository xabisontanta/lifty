import type { Vehicle } from '@/domain/types'
import { sb } from './supabase'

export type VehicleIdentity = Pick<Vehicle, 'make' | 'model' | 'year' | 'colour' | 'bodyType'>
export type IllustrationResult =
  | { status: 'ready'; imageUrl: string; label: string; source: 'generated' | 'example'; referenceReviewed?: boolean }
  | { status: 'processing'; retryAfterSeconds: number }
  | { status: 'unavailable'; code: string }

const text = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
export function vehicleIdentityKey(vehicle: VehicleIdentity): string | null {
  const make = text(vehicle.make) === 'vw' ? 'volkswagen' : text(vehicle.make)
  const colour = text(vehicle.colour) === 'gray' ? 'grey' : text(vehicle.colour)
  const model = text(vehicle.model)
  if (!make || !model || !colour || !Number.isInteger(vehicle.year) || vehicle.year < 1886 || vehicle.year > new Date().getFullYear() + 1) return null
  return JSON.stringify([make, model, vehicle.year, colour, vehicle.bodyType])
}

/** One explicitly scoped preview example. Never substitute it for another year, model or colour. */
export function vehicleExample(vehicle: VehicleIdentity): IllustrationResult | null {
  const key = vehicleIdentityKey(vehicle)
  const example = vehicleIdentityKey({ make: 'Volkswagen', model: 'Polo Vivo', year: 2022, colour: 'Silver', bodyType: 'hatchback' })
  return key && key === example
    ? { status: 'ready', imageUrl: '/images/vehicles/volkswagen-polo-vivo-2022-silver.png', label: 'AI model illustration · details may vary', source: 'example', referenceReviewed: false }
    : null
}

/** Passive reads never start a paid generation. Only the owner's setup can request generation. */
export async function fetchVehicleIllustration(vehicle: VehicleIdentity, generate = false, signal?: AbortSignal): Promise<IllustrationResult> {
  if (!vehicleIdentityKey(vehicle)) return { status: 'unavailable', code: 'incomplete-vehicle' }
  const example = vehicleExample(vehicle)
  if (example) return example
  try {
    let response: any
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) return { status: 'unavailable', code: 'aborted' }
      const { data, error } = await sb().functions.invoke('vehicle-illustration', { body: { vehicle, generate }, signal })
      response = data
      if (error?.context instanceof Response) response = await error.context.json().catch(() => null)
      // The debounced draft may still be saving. A rejected ownership check does
      // not claim a job or incur provider work, so retry this one case briefly.
      if (!generate || response?.code !== 'vehicle-changed' || attempt === 2) break
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, 3000)
        signal?.addEventListener('abort', done, { once: true })
        if (signal?.aborted) done()
      })
    }
    if (response?.status === 'ready' && response.referenceReviewed === true && response.vehicle
      && vehicleIdentityKey(response.vehicle) === vehicleIdentityKey(vehicle)
      && typeof response.imageUrl === 'string' && /^https?:\/\//.test(response.imageUrl)) {
      return { status: 'ready', imageUrl: response.imageUrl, label: 'AI model illustration · details may vary', source: 'generated', referenceReviewed: true }
    }
    if (response?.status === 'processing') return { status: 'processing', retryAfterSeconds: Math.max(5, Math.min(30, Number(response.retryAfterSeconds) || 10)) }
    return { status: 'unavailable', code: typeof response?.code === 'string' ? response.code : 'unavailable' }
  } catch {
    return { status: 'unavailable', code: 'unavailable' }
  }
}
