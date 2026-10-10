import { Component, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { LatLng, Place, Vehicle } from '@/domain/types'
import { vehicleImage } from '@/data/mock'
import { env, hasMapbox } from '@/lib/env'
import { reversePlace, searchPlaces, type PlaceSuggestion } from '@/services/mapbox'
import { getCurrentPosition } from '@/services/location'
import { validCoordinate } from '@/lib/mapLocation'
import { MapPicker } from '@/components/map/MapPicker'
import { openNavigation } from '@/services/navigation'
import { reportError } from '@/services/monitoring'
import { Icon, type IconName } from './Icon'
import { Avatar, BottomSheet, SecondaryButton, useToast } from './kit'

/* ---------- Address autocomplete (Mapbox, South Africa) ---------- */

const NO_PLACES: Place[] = []

export function AddressField({ label, value, onSelect, onText, icon = 'pin', hint, near, placeholder, places = NO_PLACES, locationActions = true }: { label: string; value: string; onSelect: (p: Place) => void; onText?: (t: string) => void; icon?: IconName; hint?: string; near?: LatLng; placeholder?: string; /** Lifty pickup points etc., matched by name */ places?: Place[]; /** show "Use my current location" + "Choose on map" */ locationActions?: boolean }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const [locating, setLocating] = useState(false)
  const [picking, setPicking] = useState(false)
  const [dirty, setDirty] = useState(false)
  const picked = useRef(false)

  useEffect(() => {
    setText(value)
    setDirty(false)
  }, [value])

  useEffect(() => {
    if (!open || picked.current || text.trim().length < 3) {
      setItems((prev) => (prev.length ? [] : prev))
      return
    }
    const q = text.trim().toLowerCase()
    const local: PlaceSuggestion[] = places
      .filter((p) => p.label.toLowerCase().includes(q) || p.area.toLowerCase().includes(q))
      .slice(0, 3)
      .map((p) => ({ ...p, id: `local:${p.label}:${p.location.lat}` }))
    if (!hasMapbox) {
      setItems(local)
      return
    }
    setLoading(true)
    let stale = false // a newer keystroke supersedes this request
    const t = setTimeout(() => {
      searchPlaces(text, near)
        .then((r) => {
          if (stale) return
          setItems([...local, ...r])
          setErr(null)
        })
        .catch((e) => {
          if (stale) return
          setItems(local)
          setErr(e instanceof Error ? e.message : 'Search failed')
        })
        .finally(() => !stale && setLoading(false))
    }, 280)
    return () => {
      stale = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `near` is compared by value
  }, [text, open, near?.lat, near?.lng, places])

  const commit = (p: Place, source: NonNullable<Place['source']> = 'manual') => {
    if (!validCoordinate(p.location)) { setErr('This address has no valid map position. Choose another address or enter coordinates.'); return }
    picked.current = true
    setText(p.label)
    setOpen(false)
    setDirty(false)
    setErr(null)
    onSelect({ label: p.label, area: p.area, location: p.location, placeId: p.placeId, source: p.source ?? source })
  }
  const choose = (p: PlaceSuggestion) => commit({ label: p.label, area: p.area, location: p.location, placeId: p.id.startsWith('local:') ? undefined : p.id }, p.id.startsWith('local:') ? 'saved_location' : 'autocomplete')

  const fillFromMyLocation = async () => {
    setLocating(true)
    setErr(null)
    try {
      const fix = await getCurrentPosition()
      const at = { lat: fix.lat, lng: fix.lng }
      const a = await reversePlace(at)
      commit({ label: a.label, area: a.area, location: at }, 'current_location')
      if (fix.accuracyM != null && fix.accuracyM > 50) setErr(`Your location is accurate to about ${Math.round(fix.accuracyM)} m. Check this spot on the map before continuing.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Location unavailable')
    } finally {
      setLocating(false)
    }
  }

  const frame = typeof document !== 'undefined' ? document.querySelector('.app-frame') : null

  return (
    <div className="field address-field">
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        <Icon name={icon} size={20} className="field-icon" />
        <input
          id={id}
          value={text}
          placeholder={placeholder ?? 'Start typing an address…'}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          onChange={(e) => {
            picked.current = false
            setText(e.target.value)
            setDirty(e.target.value !== value)
            onText?.(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(items.length - 1, a + 1))
            if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
            if (e.key === 'Enter' && active >= 0 && items[active]) {
              e.preventDefault()
              choose(items[active])
            }
          }}
        />
        {loading && <span className="spinner dark" style={{ width: 16, height: 16 }} aria-hidden />}
      </div>
      {open && items.length > 0 && (
        <ul id={`${id}-list`} className="suggestions" role="listbox">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)} className={i === active ? 'active' : ''}>
                <Icon name="pin" size={16} />
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.area}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {dirty && !open && !err && <p className="field-error" role="alert">Pick an address from the list, use your location, or choose it on the map — otherwise we can’t place it on the map.</p>}
      {(err || hint) && <p className={err ? 'field-error' : 'field-hint'}>{err ?? hint}</p>}
      {!hasMapbox && !err && <p className="field-hint">Street address search is unavailable. Use your current location or enter coordinates manually.</p>}
      {locationActions && (
        <div className="addr-actions">
          <button type="button" onClick={() => void fillFromMyLocation()} disabled={locating}>
            {locating ? <span className="spinner dark" style={{ width: 16, height: 16 }} /> : <Icon name="target" size={18} />}
            {locating ? 'Finding you…' : 'Use my current location'}
          </button>
          <button type="button" onClick={() => setPicking(true)}>
            <Icon name="pin" size={18} /> {hasMapbox ? 'Choose on map' : 'Enter coordinates'}
          </button>
        </div>
      )}
      {picking && frame && createPortal(
        <MapPicker title={label} start={near ?? { lat: -29.5389, lng: 31.2117 }} onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); commit(p, 'map_pin') }} />,
        frame,
      )}
    </div>
  )
}

/* ---------- Private calling: numbers are never shown ---------- */

export function CallButton({ name, chatId, className = 'action' }: { name: string; chatId: string; className?: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={`Call ${name}`}>
        {className.includes('icon-btn') ? (
          <Icon name="phone" size={20} />
        ) : (
          <>
            <span className="a-ic">
              <Icon name="phone" />
            </span>
            Call
          </>
        )}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`Call ${name}`}>
        <div className="stack-3">
          <p className="muted">Lifty keeps both phone numbers private. {env.proxyCallNumber ? 'Your call is connected through a Lifty number.' : 'Use chat to reach them — they get a notification right away.'}</p>
          {env.proxyCallNumber ? (
            <a className="btn btn-primary btn-block" href={`tel:${env.proxyCallNumber}`}>
              <Icon name="phone" size={20} /> Call privately
            </a>
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => nav(`/chat/${chatId}`, { state: { name } })}>
              <Icon name="message" size={20} /> Message {name}
            </button>
          )}
          <SecondaryButton icon="alert" onClick={() => (window.location.href = 'tel:10111')}>Emergency (10111)</SecondaryButton>
        </div>
      </BottomSheet>
    </>
  )
}

/* ---------- Navigation hand-off ---------- */

export function NavigateButton({ destination, waypoint, mode = 'driving', label = 'Navigate', block }: { destination: LatLng; waypoint?: LatLng; mode?: 'driving' | 'walking'; label?: string; block?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`btn btn-secondary btn-sm ${block ? 'btn-block' : ''}`} onClick={() => setOpen(true)}>
        <Icon name="navigation" size={18} /> <span>{label}</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={mode === 'walking' ? 'Walking directions' : 'Open navigation'}>
        <div className="stack-3">
          <p className="muted small">{mode === 'walking' ? 'Get step-by-step walking directions to your pickup point.' : 'Turn-by-turn directions open in your navigation app. Lifty keeps sharing your live position with your lift club.'}</p>
          <SecondaryButton onClick={() => { openNavigation('google', { destination, waypoint, mode }); setOpen(false) }}>Google Maps</SecondaryButton>
          {mode === 'driving' && <SecondaryButton onClick={() => { openNavigation('waze', { destination, waypoint }); setOpen(false) }}>Waze{waypoint ? ' (to pickup first)' : ''}</SecondaryButton>}
        </div>
      </BottomSheet>
    </>
  )
}

/* ---------- Vehicle photo card (design 19) ---------- */

export function VehiclePhotoCard({ vehicle, seatsAvailable, compact }: { vehicle: Vehicle; seatsAvailable?: number; compact?: boolean }) {
  const isOwnPhoto = !!vehicle.photoUrl
  return (
    <div className={`vehicle-card ${compact ? 'compact' : ''}`}>
      <img src={vehicleImage(vehicle)} alt={`${vehicle.colour} ${vehicle.make} ${vehicle.model}`} loading="lazy" />
      <div className="grow">
        <strong>{vehicle.make} {vehicle.model}</strong>
        <p className="small muted">{vehicle.colour}{vehicle.year ? ` · ${vehicle.year}` : ''}</p>
        <p className="small muted">{vehicle.registrationSummary}{seatsAvailable != null ? ` · ${seatsAvailable} seat${seatsAvailable === 1 ? '' : 's'} available` : ''}</p>
        {!isOwnPhoto && !compact && <p className="tiny muted">Illustrative photo — check the plate and colour at pickup.</p>}
      </div>
    </div>
  )
}

/* ---------- Avatar stack (design system match card) ---------- */

export function AvatarStack({ people, max = 3 }: { people: { firstName: string; avatarHue: number; avatarUrl?: string }[]; max?: number }) {
  if (people.length === 0) return <span className="small muted">Be the first to join</span>
  return (
    <span className="avatar-stack" aria-label={`${people.length} member${people.length === 1 ? '' : 's'} already in this lift club`}>
      {people.slice(0, max).map((p, i) => (
        <span key={i} className="avatar-stack-item">
          <Avatar first={p.firstName} hue={p.avatarHue} size={30} src={p.avatarUrl} />
        </span>
      ))}
      {people.length > max && <span className="avatar-more">+{people.length - max}</span>}
    </span>
  )
}

/* ---------- Confetti (design 15 Request Sent) ---------- */

export function Confetti() {
  const colors = ['#00b386', '#f59e0b', '#3b82f6', '#22c55e', '#0f2d4a']
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 53) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 6) * 0.12}s`, transform: `rotate(${i * 37}deg)` }} />
      ))}
    </div>
  )
}

/* ---------- 3-minute grace countdown after the driver arrives ---------- */

export const GRACE_MS = 3 * 60 * 1000
export function useGrace(arrivedAt: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!arrivedAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [arrivedAt])
  if (!arrivedAt) return { active: false, remainingMs: GRACE_MS, expired: false, label: '3:00' }
  const remainingMs = Math.max(0, arrivedAt + GRACE_MS - now)
  const s = Math.ceil(remainingMs / 1000)
  return { active: remainingMs > 0, remainingMs, expired: remainingMs === 0, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
}

export function GraceBar({ arrivedAt, who }: { arrivedAt: number | null; who: 'driver' | 'passenger' }) {
  const g = useGrace(arrivedAt)
  if (!arrivedAt) return null
  return (
    <div className={`grace ${g.expired ? 'expired' : ''}`} role="timer" aria-live="polite">
      <div className="grace-fill" style={{ width: `${(g.remainingMs / GRACE_MS) * 100}%` }} />
      <span>
        <Icon name="clock" size={16} />{' '}
        {g.expired
          ? who === 'driver' ? 'Grace period over — you can continue without them' : 'Your driver may have to leave now'
          : who === 'driver' ? `Waiting at pickup · ${g.label} left` : `Your driver is waiting · ${g.label} left`}
      </span>
    </div>
  )
}

/* ---------- Photo / document picker ---------- */

export function PhotoPicker({ label, sub, done, onFile, accept = 'image/*', icon = 'upload', capture }: { label: string; sub: string; done?: boolean; onFile: (f: File) => Promise<void> | void; accept?: string; icon?: IconName; capture?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <>
      <button type="button" className={`upload-row ${done ? 'done' : ''}`} onClick={() => ref.current?.click()} aria-label={`${label}: ${done ? 'uploaded' : sub}`} disabled={busy}>
        <span className="row-icon">{busy ? <span className="spinner dark" style={{ width: 18, height: 18 }} /> : <Icon name={done ? 'check' : icon} size={20} />}</span>
        <span className="grow">
          <strong>{label}</strong>
          <span className="muted small" style={{ display: 'block' }}>{done ? 'Uploaded — in review' : sub}</span>
        </span>
        {!done && <Icon name="upload" size={20} className="row-chev" />}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        capture={capture ? 'environment' : undefined}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > 10 * 1024 * 1024) {
            toast('That file is over 10 MB. Try a smaller photo.', 'error')
            return
          }
          setBusy(true)
          try {
            await onFile(f)
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Upload failed', 'error')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

/* ---------- Error boundary: never a white screen ---------- */

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    reportError(error, { where: 'ErrorBoundary' })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" role="alert" style={{ paddingTop: 80 }}>
        <span className="empty-icon red">
          <Icon name="alert" size={30} />
        </span>
        <h2>Something went wrong</h2>
        <p>We’ve logged the problem. Your lift club details are safe.</p>
        <button className="btn btn-primary" onClick={() => { this.setState({ error: null }); window.location.assign('/') }}>Back to Lifty</button>
      </div>
    )
  }
}
