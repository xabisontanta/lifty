import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddressField, PhotoPicker } from '@/components/ui/extras'
import { Avatar, Banner, DayPicker, Segmented, Select, TextField, Toggle, useToast } from '@/components/ui/kit'
import { Icon, type IconName } from '@/components/ui/Icon'
import { CommuteCalendar, type ScheduleValue } from '@/components/ui/CommuteCalendar'
import { formatDays, formatDistance, rand } from '@/lib/format'
import { api, contributionCap, isLive, suggestedContribution, type DocKind, type DriverSetupInput } from '@/services/api'
import { directions } from '@/services/mapbox'
import { hasMapbox } from '@/lib/env'
import { useApp } from '@/store/app'
import { OnboardShell } from './Auth'

const WALK_OPTIONS = [250, 500, 750, 1000]

const times = (from: number, to: number) => {
  const out: { value: string; label: string }[] = []
  for (let m = from * 60; m <= to * 60; m += 15) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    out.push({ value: t, label: t })
  }
  return out
}
const MORNING = times(5, 10)
const EVENING = times(14, 20)

/* ---------- 05 Passenger 1/3: commuting details (design 05) ---------- */
export function PassengerCommute() {
  const nav = useNavigate()
  const { state, update, updatePlan } = useApp()
  const p = state.plan
  const [willWalk, setWillWalk] = useState(p.maxWalkMeters > 0)
  const walk = p.maxWalkMeters || 750
  const valid = !!p.origin.location && !!p.destination.location && p.origin.label.length > 2 && p.destination.label.length > 2

  return (
    <OnboardShell
      step={1}
      total={3}
      title="Your commuting details"
      subtitle="Tell us about the journey you make every week."
      onBack={() => nav(-1)}
      cta="Continue"
      disabled={!valid}
      onNext={() => {
        update({ prefs: { homeAddress: p.origin.label, workAddress: p.destination.label, preferredPickup: p.preferredPickup?.label ?? '' } })
        nav('/onboarding/passenger/2')
      }}
    >
      <div className="stack-4">
        <AddressField label="Home address" value={p.origin.label} onSelect={(origin) => updatePlan({ origin })} hint="Kept private — drivers only ever see your pickup point." />
        <AddressField label="Work / study address" icon="flag" value={p.destination.label} onSelect={(destination) => updatePlan({ destination })} />
        <AddressField label="Preferred pickup point (optional)" icon="target" value={p.preferredPickup?.label ?? ''} near={p.origin.location} placeholder="e.g. a garage or shopping centre" onSelect={(preferredPickup) => updatePlan({ preferredPickup })} />
        <div className="card">
          <div className="row-flex between">
            <div>
              <strong>I’m willing to walk to a nearby pickup point</strong>
              <p className="small muted">Walking a little usually unlocks better matches.</p>
            </div>
            <Toggle label="Willing to walk to a nearby pickup point" checked={willWalk} onChange={(v) => { setWillWalk(v); updatePlan({ maxWalkMeters: v ? walk : 0 }) }} />
          </div>
          {willWalk && (
            <div style={{ marginTop: 14 }}>
              <div className="row-flex between">
                <label id="walk-l" className="small">Up to</label>
                <strong style={{ color: 'var(--teal-700)' }}>{formatDistance(walk)} · ~{Math.round(walk / 70)} min</strong>
              </div>
              <input aria-labelledby="walk-l" className="range" type="range" min={0} max={3} step={1} value={Math.max(0, WALK_OPTIONS.indexOf(walk))} onChange={(e) => updatePlan({ maxWalkMeters: WALK_OPTIONS[Number(e.target.value)] })} aria-valuetext={`${walk} metres`} />
              <div className="row-flex between small muted"><span>250m</span><span>1 km</span></div>
            </div>
          )}
        </div>
        {!hasMapbox && <Banner tone="info">Address search isn’t configured — using the demo route.</Banner>}
      </div>
    </OnboardShell>
  )
}

const shift = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + mins
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/* ---------- 06 Passenger 2/3: travel schedule ---------- */
export function PassengerSchedule() {
  const nav = useNavigate()
  const { state, updatePlan } = useApp()
  const p = state.plan
  const schedule: ScheduleValue = { scheduleMode: p.scheduleMode ?? 'weekly', days: p.days, startDate: p.startDate, endDate: p.endDate, dates: p.dates ?? [], skipHolidays: p.skipHolidays ?? true }
  const ready = schedule.scheduleMode === 'dates' ? schedule.dates.length > 0 : schedule.days.length > 0
  return (
    <OnboardShell step={2} total={3} title="Your travel schedule" subtitle="Travel every week, or pick the exact days you need a lift." onBack={() => nav(-1)} cta="Continue" disabled={!ready} onNext={() => nav('/onboarding/passenger/3')}>
      <div className="stack-5">
        <CommuteCalendar value={schedule} onChange={(patch) => updatePlan(patch)} />
        {!ready && <p className="field-error" role="alert">{schedule.scheduleMode === 'dates' ? 'Tap at least one date.' : 'Pick at least one day.'}</p>}
        <Select label="Preferred arrival time" value={p.arriveBy} onChange={(v) => updatePlan({ arriveBy: v, arriveWindowStart: shift(v, -15) })} options={MORNING} />
        <Banner tone="info" icon="clock">You’ll arrive between <strong>{p.arriveWindowStart}–{p.arriveBy}</strong>. A flexible window helps us find more matches.</Banner>
        <Select label="Return time (leave work)" value={p.returnTime} onChange={(v) => updatePlan({ returnTime: v })} options={EVENING} />
        <p className="small muted">Your trip home is a separate leg — it can be with the same driver or a different one.</p>
      </div>
    </OnboardShell>
  )
}

/* ---------- 07 Passenger 3/3: privacy & consent ---------- */
export function PassengerConsent() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update } = useApp()
  const [saving, setSaving] = useState(false)
  const finish = async () => {
    setSaving(true)
    try {
      await api.setConsent({ location: state.sharingConsent, terms: true })
      await api.savePassengerCommute(state.plan)
      update({ onboarded: true })
      nav('/p/home', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your commute', 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <OnboardShell step={3} total={3} title="Your privacy, your control" subtitle="Here’s how location and your details are used." onBack={() => nav(-1)} cta="Finish & go to Home" loading={saving} onNext={finish}>
      <div className="stack-3">
        <PrivacyPoint icon="eye" title="Your home address stays private" body="Drivers see your pickup point and first name only — never your street address or phone number." />
        <PrivacyPoint icon="navigation" title="Live location is time-limited" body="Sharing only starts 20 minutes before a scheduled pickup, and stops when your commute ends." />
        <PrivacyPoint icon="shield" title="Verified community" body="Drivers are ID-, licence- and vehicle-verified before they can offer seats." />
        <div className="card row-flex between">
          <div>
            <strong>Allow live location during commutes</strong>
            <p className="small muted">You can change this any time in Profile → Privacy.</p>
          </div>
          <Toggle label="Allow live location during commutes" checked={state.sharingConsent} onChange={(v) => update({ sharingConsent: v })} />
        </div>
        <button className="btn-text" onClick={() => nav('/privacy')}>Read the full privacy notice</button>
      </div>
    </OnboardShell>
  )
}

function PrivacyPoint({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="card row-flex" style={{ alignItems: 'flex-start' }}>
      <span className="row-icon"><Icon name={icon} size={20} /></span>
      <div>
        <strong>{title}</strong>
        <p className="small muted">{body}</p>
      </div>
    </div>
  )
}

/* =================== DRIVER ONBOARDING (design 07–09, 4 steps) =================== */

/* 1/4 Vehicle information */
export function DriverVehicle() {
  const nav = useNavigate()
  const { state, updateDriver } = useApp()
  const [v, setV] = useState(state.driver.vehicle)
  const set = (k: keyof typeof v) => (val: string) => setV({ ...v, [k]: k === 'seats' ? Number(val) : val })
  const ok = v.registration.length > 3 && v.make && v.model && v.year && v.colour
  return (
    <OnboardShell step={1} total={4} title="Vehicle information" subtitle="Tell us about the car you use for your commute." onBack={() => nav(-1)} cta="Continue" disabled={!ok} onNext={() => { updateDriver({ vehicle: v, seatsOpen: Math.min(state.driver.seatsOpen || v.seats, v.seats) }); nav('/onboarding/driver/2') }}>
      <div className="stack-4">
        <TextField label="Registration number" value={v.registration} onChange={set('registration')} autoCapitalize="characters" hint="Passengers only see a partial plate, e.g. ND ••• 456." />
        <div className="row-flex"><div className="grow"><TextField label="Make" value={v.make} onChange={set('make')} /></div><div className="grow"><TextField label="Model" value={v.model} onChange={set('model')} /></div></div>
        <div className="row-flex"><div className="grow"><TextField label="Year" value={v.year} onChange={set('year')} inputMode="numeric" /></div><div className="grow"><TextField label="Colour" value={v.colour} onChange={set('colour')} /></div></div>
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>Body type</p>
          <Segmented label="Body type" value={v.bodyType} onChange={(bodyType) => setV({ ...v, bodyType })} options={[{ value: 'sedan', label: 'Sedan' }, { value: 'hatchback', label: 'Hatch' }, { value: 'suv', label: 'SUV' }, { value: 'other', label: 'Other' }]} />
        </div>
        <Select label="Available seats" value={String(v.seats)} onChange={set('seats')} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} seat${n > 1 ? 's' : ''}` }))} />
      </div>
    </OnboardShell>
  )
}

/* 2/4 Your regular commute */
export function DriverCommute() {
  const nav = useNavigate()
  const { state, updateDriver } = useApp()
  const c = state.driver.commute
  const set = (patch: Partial<typeof c>) => updateDriver({ commute: { ...c, ...patch } })
  // live data needs real coordinates (from the address search) to compute the route
  const ready = c.days.length > 0 && (!isLive() || (!!c.originPlace && !!c.destinationPlace))
  return (
    <OnboardShell step={2} total={4} title="Your regular commute" subtitle="Tell us about the journey you already make." onBack={() => nav(-1)} cta="Continue" disabled={!ready} onNext={() => nav('/onboarding/driver/3')}>
      <div className="stack-4">
        <AddressField label="Home address" value={c.originPlace?.label ?? c.origin} onSelect={(p) => set({ originPlace: p, origin: p.label })} onText={(t) => set({ origin: t })} hint="Never shown to passengers — they only see the part of your route near their pickup." />
        <AddressField label="Work address" icon="flag" value={c.destinationPlace?.label ?? c.destination} onSelect={(p) => set({ destinationPlace: p, destination: p.label })} onText={(t) => set({ destination: t })} />
        <div className="row-flex">
          <div className="grow"><Select label="Departure time (to work)" value={c.departure} onChange={(departure) => set({ departure })} options={MORNING} /></div>
          <div className="grow"><Select label="Return time (from work)" value={c.returnTime} onChange={(returnTime) => set({ returnTime })} options={EVENING} /></div>
        </div>
        <div className="stack-2">
          <p className="eyebrow">Days of travel</p>
          <DayPicker value={c.days} onChange={(days) => set({ days })} />
          <p className="small muted">{formatDays(c.days)}</p>
        </div>
        <div className="card row-flex between">
          <div><strong>Also offer the trip home</strong><p className="small muted">Passengers can join your evening leg separately.</p></div>
          <Toggle label="Also offer the trip home" checked={c.offerReturn} onChange={(offerReturn) => set({ offerReturn })} />
        </div>
        <Banner tone="info" icon="route">Lifty will only match passengers whose commute reasonably overlaps yours.</Banner>
      </div>
    </OnboardShell>
  )
}

/* 3/4 Verification documents */
export function DriverVerification() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, updateDriver } = useApp()
  const docs = state.driver.docs
  const items: { key: keyof typeof docs; kind: DocKind; title: string; icon: IconName }[] = [
    { key: 'id', kind: 'id', title: 'South African ID', icon: 'doc' },
    { key: 'licence', kind: 'licence', title: "Driver's licence", icon: 'card' },
    { key: 'registration', kind: 'vehicle_registration', title: 'Vehicle registration', icon: 'car' },
    { key: 'insurance', kind: 'insurance', title: 'Proof of insurance', icon: 'shield' },
  ]
  const all = Object.values(docs).every(Boolean)
  return (
    <OnboardShell step={3} total={4} title="Verification documents" subtitle="Keep Lifty safe and trusted." onBack={() => nav(-1)} cta="Continue" disabled={!all} onNext={() => nav('/onboarding/driver/4')}>
      <div className="stack-3">
        {items.map((it) => (
          <PhotoPicker
            key={it.key}
            label={it.title}
            sub="Upload or take a photo"
            icon={it.icon}
            accept="image/*,application/pdf"
            capture
            done={docs[it.key]}
            onFile={async (f) => {
              await api.uploadDocument(it.kind, f, it.kind === 'vehicle_registration' ? state.driver.vehicle.registration : undefined)
              updateDriver({ docs: { ...state.driver.docs, [it.key]: true } })
              toast(`${it.title} uploaded`, 'success')
            }}
          />
        ))}
        <Banner tone="info" icon="lock">Documents are encrypted and reviewed by Lifty’s team, usually within 24 hours. Passengers only ever see a “Verified” badge — never your documents.</Banner>
      </div>
    </OnboardShell>
  )
}

/* 4/4 Photos, detour & contribution */
export function DriverSchedule() {
  const nav = useNavigate()
  const toast = useToast()
  const { state, update, updateDriver } = useApp()
  const d = state.driver
  const c = d.commute
  const [route, setRoute] = useState<{ coordinates: [number, number][]; distanceM: number; durationS: number } | null>(null)
  const [routeErr, setRouteErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!c.originPlace || !c.destinationPlace) return
    directions([c.originPlace.location, c.destinationPlace.location], 'driving')
      .then(setRoute)
      .catch((e) => setRouteErr(e instanceof Error ? e.message : 'Could not calculate your route'))
  }, [c.originPlace, c.destinationPlace])

  const distanceM = route?.distanceM ?? 35000
  const suggested = suggestedContribution(distanceM, c.days.length, d.seatsOpen || d.vehicle.seats)
  const cap = contributionCap(distanceM, c.days.length, d.seatsOpen || d.vehicle.seats)
  const over = d.monthlyContribution > cap

  // start from the fair cost-sharing amount rather than an arbitrary default
  useEffect(() => {
    if (d.monthlyContribution === 0 || d.monthlyContribution > cap) updateDriver({ monthlyContribution: suggested })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap])

  const finish = async () => {
    setSaving(true)
    try {
      if (c.originPlace && c.destinationPlace && route) {
        const legs: DriverSetupInput['legs'] = [{ direction: 'to_work', origin: c.originPlace, destination: c.destinationPlace, departure: c.departure, days: c.days, route }]
        if (c.offerReturn) {
          const back = await directions([c.destinationPlace.location, c.originPlace.location], 'driving')
          legs.push({ direction: 'to_home', origin: c.destinationPlace, destination: c.originPlace, departure: c.returnTime, days: c.days, route: back })
        }
        await api.saveDriverSetup({ vehicle: d.vehicle, legs, seats: d.seatsOpen || d.vehicle.seats, maxDeviationMin: c.maxDeviationMin, monthlyContribution: d.monthlyContribution })
      } else {
        await api.saveDriverSetup({ vehicle: d.vehicle, legs: [], seats: d.seatsOpen, maxDeviationMin: c.maxDeviationMin, monthlyContribution: d.monthlyContribution })
      }
      update({ onboarded: true })
      nav('/d/home', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your commute', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <OnboardShell step={4} total={4} title="Photos, detour & contribution" subtitle="Help passengers recognise you, and set fair cost-sharing." onBack={() => nav(-1)} cta="Finish set-up" loading={saving} disabled={c.days.length === 0 || over} onNext={finish}>
      <div className="stack-5">
        <div className="row-flex">
          {state.avatarUrl ? <Avatar first={state.user?.firstName ?? 'D'} hue={24} size={64} src={state.avatarUrl} /> : null}
          <div className="grow">
            <PhotoPicker label="Profile photo" sub="Clear face, no sunglasses" done={!!state.avatarUrl} icon="user" capture onFile={async (f) => update({ avatarUrl: await api.uploadPhoto('avatar', f) })} />
          </div>
        </div>
        <div>
          <PhotoPicker label="Photo of your car" sub="Front three-quarter view, plate visible" done={!!d.vehicle.photoUrl} icon="car" capture onFile={async (f) => updateDriver({ vehicle: { ...d.vehicle, photoUrl: await api.uploadPhoto('vehicle', f) } })} />
          {d.vehicle.photoUrl && <img src={d.vehicle.photoUrl} alt="Your car" className="doc-preview" style={{ marginTop: 8 }} />}
          <p className="small muted" style={{ marginTop: 6 }}>Passengers use this photo to find you at pickup.</p>
        </div>
        <div>
          <div className="row-flex between" style={{ marginBottom: 8 }}>
            <label id="dev-l" style={{ fontSize: 14, fontWeight: 500 }}>Maximum detour for a pickup</label>
            <strong style={{ color: 'var(--teal-700)' }}>{c.maxDeviationMin} min</strong>
          </div>
          <input aria-labelledby="dev-l" className="range" type="range" min={2} max={15} value={c.maxDeviationMin} onChange={(e) => updateDriver({ commute: { ...c, maxDeviationMin: Number(e.target.value) } })} />
          <p className="small muted">Passengers needing a bigger detour are never matched to you.</p>
        </div>
        <div>
          <TextField label="Monthly contribution per passenger (R)" value={String(d.monthlyContribution)} onChange={(v) => updateDriver({ monthlyContribution: Number(v.replace(/\D/g, '')) || 0 })} inputMode="numeric" error={over ? `Lift clubs share costs — keep it at or below ${rand(cap)} for this route.` : undefined} hint={`Fair share for ${route ? formatDistance(distanceM) : 'your route'}: about ${rand(suggested)} a month (fuel + wear, split by seats).`} />
          <button type="button" className="btn-text" onClick={() => updateDriver({ monthlyContribution: suggested })}>Use suggested {rand(suggested)}</button>
        </div>
        {routeErr && <Banner tone="warning">{routeErr}. You can still finish; we’ll retry when you open My Route.</Banner>}
      </div>
    </OnboardShell>
  )
}
