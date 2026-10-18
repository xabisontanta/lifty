import { useEffect, useState } from 'react'
import type { Vehicle } from '@/domain/types'
import { fetchVehicleIllustration, vehicleExample, vehicleIdentityKey, type IllustrationResult } from '@/services/vehicleIllustration'
import { Icon } from './Icon'

const colours: Record<string, string> = { silver: '#b8bdc3', grey: '#777c83', gray: '#777c83', white: '#f5f5f5', black: '#24272b', blue: '#2f65b2', red: '#b83e3e', green: '#407b53', brown: '#886648', beige: '#c6b28d', yellow: '#e5c443', orange: '#d97938', purple: '#875caa', gold: '#bfa359' }

export function VehicleVisual({ vehicle, generate = false }: { vehicle: Vehicle; generate?: boolean }) {
  const key = vehicleIdentityKey(vehicle)
  const [loaded, setLoaded] = useState<{ key: string; result: IllustrationResult } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const { make, model, year, colour, bodyType, photoUrl } = vehicle
  useEffect(() => {
    if (photoUrl || !key || vehicleExample({ make, model, year, colour, bodyType })) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let polls = 0
    const load = async () => {
      if (generate && polls === 0) setLoaded({ key, result: { status: 'processing', retryAfterSeconds: 10 } })
      const result = await fetchVehicleIllustration({ make, model, year, colour, bodyType }, generate && polls === 0, controller.signal)
      if (controller.signal.aborted) return
      setLoaded({ key, result })
      if (result.status === 'processing') {
        if (++polls <= 18) timer = setTimeout(load, result.retryAfterSeconds * 1000)
        else setLoaded({ key, result: { status: 'unavailable', code: 'generation-timeout' } })
      }
    }
    // Let the account-scoped onboarding draft save before the server checks ownership.
    timer = setTimeout(load, generate ? 1500 : 0)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [key, make, model, year, colour, bodyType, photoUrl, generate])

  const result = loaded?.key === key ? loaded.result : vehicleExample(vehicle)
  const image = photoUrl || (result?.status === 'ready' ? result.imageUrl : null)
  const description = `${colour} ${year || ''} ${make} ${model}`.trim()
  const caption = photoUrl ? 'Driver’s car photo' : result?.status === 'ready' ? result.label : result?.status === 'processing' ? 'Preparing model illustration…' : 'No exact model illustration available yet'
  return <div className="vehicle-visual">
    {image && broken !== image
      ? <img src={image} alt={`${description} — ${photoUrl ? 'driver’s car photo' : 'AI model illustration'}`} loading="lazy" onError={() => setBroken(image)} />
      : <div className="vehicle-image-empty"><Icon name="car" size={32} /><span className="tiny muted">{result?.status === 'processing' ? 'Preparing illustration…' : 'Car photo needed'}</span></div>}
    <span className="tiny muted vehicle-visual-caption">{image && broken === image ? 'Car image unavailable' : caption}</span>
    <span className="tiny vehicle-colour"><span className="vehicle-colour-swatch" style={{ backgroundColor: colours[colour.trim().toLowerCase()] ?? '#d0d5da' }} aria-hidden />{colour || 'Choose a colour'}</span>
  </div>
}
