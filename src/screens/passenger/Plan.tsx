import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DestinationMarker, MapView, PassengerMarker, PickupMarker } from '@/components/map/MapView'
import { CommuteCalendar, scheduleSummary, type ScheduleValue } from '@/components/ui/CommuteCalendar'
import { AddressField } from '@/components/ui/extras'
import { Icon } from '@/components/ui/Icon'
import { Banner, BottomSheet, Card, LiftyButton, ProfileRow, ScreenBody, Segmented, Select } from '@/components/ui/kit'
import type { Place } from '@/domain/types'
import { distanceM } from '@/lib/geo'
import { addMinutes, formatDistance, walkLabel } from '@/lib/format'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { useApp } from '@/store/app'

const WALK_M_PER_MIN = 70
type Sheet = 'from' | 'to' | 'days' | 'time' | 'pickup' | null

const timeOptions = (fromH: number, toH: number) => {
  const out: { value: string; label: string }[] = []
  for (let m = fromH * 60; m <= toH * 60; m += 15) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    out.push({ value: t, label: t })
  }
  return out
}

/* ---------- 11 Plan your commute (design 11) — every row edits its own thing ---------- */
export function PlanCommute() {
  const nav = useNavigate()
  const { state, updatePlan } = useApp()
  const p = state.plan
  const [sheet, setSheet] = useState<Sheet>(null)
  const toHome = p.direction === 'to_home'
  // the morning trip goes home → work; the evening trip is the reverse
  const from = toHome ? p.destination : p.origin
  const to = toHome ? p.origin : p.destination
  const setFrom = (pl: Place) => updatePlan(toHome ? { destination: pl } : { origin: pl, preferredPickup: undefined })
  const setTo = (pl: Place) => updatePlan(toHome ? { origin: pl } : { destination: pl })

  const { data: points } = useAsync(() => api.listPickupPoints(from.location), [from.location.lat, from.location.lng])
  const nearby = useMemo(
    () => (points ?? [])
      .map((pt) => ({ ...pt, d: Math.round(distanceM(from.location, pt.location) * 1.25) }))
      .filter((pt) => pt.d <= 1500)
      .sort((a, b) => a.d - b.d),
    [points, from.location],
  )
  // only show a pickup that's actually near the user's start point
  const pickup = p.preferredPickup && distanceM(p.preferredPickup.location, from.location) <= 1500 ? p.preferredPickup : nearby.find((n) => n.d <= p.maxWalkMeters)
  const walkMin = Math.round(p.maxWalkMeters / WALK_M_PER_MIN)

  const schedule: ScheduleValue = { scheduleMode: p.scheduleMode ?? 'weekly', days: p.days, startDate: p.startDate, endDate: p.endDate, dates: p.dates ?? [], skipHolidays: p.skipHolidays ?? true }
  const scheduleReady = schedule.scheduleMode === 'dates' ? schedule.dates.length > 0 : schedule.days.length > 0
  const windowMin = (() => {
    const [h, m] = p.arriveBy.split(':').map(Number)
    const [hs, ms] = p.arriveWindowStart.split(':').map(Number)
    return h * 60 + m - (hs * 60 + ms)
  })()
  const inClub = toHome ? !!state.returnClub : !!state.club

  return (
    <>
      <ScreenBody>
        <div className="title-block">
          <h1>Plan Your Commute</h1>
          <p>Find lift clubs that match your route.</p>
        </div>
        <Segmented label="Which trip" value={p.direction} onChange={(direction) => updatePlan({ direction })} options={[{ value: 'to_work', label: 'To work · morning' }, { value: 'to_home', label: 'Home · evening' }]} />

        <Card style={{ marginTop: 12, padding: 6 }}>
          <button type="button" className="row" onClick={() => setSheet('from')} aria-label={`Change start: ${from.label}`}>
            <span className="pt" style={{ width: 14, height: 14, borderRadius: '50%', border: '3px solid var(--map-blue)', flex: 'none' }} />
            <span className="row-text"><span className="eyebrow">From</span><span className="row-title">{from.label}</span><span className="row-sub">{toHome ? from.area : `${from.area ? from.area + ' · ' : ''}kept private`}</span></span>
            <Icon name="edit" size={18} className="row-chev" />
          </button>
          <span className="route-link" style={{ marginLeft: 22 }} />
          <button type="button" className="row" onClick={() => setSheet('to')} aria-label={`Change destination: ${to.label}`}>
            <span className="pt" style={{ width: 14, height: 14, borderRadius: '50%', border: '3px solid var(--error)', flex: 'none' }} />
            <span className="row-text"><span className="eyebrow">To</span><span className="row-title">{to.label}</span><span className="row-sub">{to.area}</span></span>
            <Icon name="edit" size={18} className="row-chev" />
          </button>
        </Card>

        <div className="list" style={{ marginTop: 12 }}>
          <ProfileRow icon="calendar" title="Travel days" subtitle={scheduleSummary(schedule)} onClick={() => setSheet('days')} />
          <ProfileRow icon="clock" title={toHome ? 'Leave work after' : 'Arrival time'} subtitle={toHome ? p.returnTime : `Before ${p.arriveBy}${windowMin > 0 ? ` (from ${p.arriveWindowStart})` : ''}`} onClick={() => setSheet('time')} />
          <ProfileRow icon="walk" title="Pickup preference" subtitle={p.maxWalkMeters ? `${pickup ? pickup.label : 'Nearby pickup'} · ${walkLabel(p.maxWalkMeters).toLowerCase()} (~${walkMin} min)` : 'Pickup at my address only'} onClick={() => setSheet('pickup')} />
        </div>

        <div className="map-frame" style={{ marginTop: 12 }}>
          <MapView fit={[from.location, ...(pickup ? [pickup.location] : []), to.location]} height={220} padding={44} label="Preview of your commute" locate locateNoFit>
            <PassengerMarker at={from.location} label={toHome ? 'Work' : 'Home'} />
            {pickup && <PickupMarker at={pickup.location} label={pickup.label} />}
            <DestinationMarker at={to.location} label={to.label} />
          </MapView>
        </div>
        <p className="small muted" style={{ margin: '8px 4px 0' }}>
          <Icon name="target" size={14} /> Tap the locate button to see where you are now.
        </p>
      </ScreenBody>
      <div className="screen-footer" style={{ paddingBottom: 12 }}>
        <LiftyButton icon="search" onClick={() => nav('/p/finding')} disabled={!scheduleReady}>Find Lift Clubs</LiftyButton>
      </div>

      {/* From / To */}
      <BottomSheet open={sheet === 'from' || sheet === 'to'} onClose={() => setSheet(null)} title={sheet === 'from' ? (toHome ? 'Where do you leave from?' : 'Your home address') : toHome ? 'Your home address' : 'Where do you work or study?'}>
        <div className="stack-3">
          {inClub && <Banner tone="warning">Changing this can change your pickup point. Your current lift club stays as it is until you request a new match.</Banner>}
          <AddressField
            key={sheet ?? 'none'}
            label={sheet === 'from' ? 'From' : 'To'}
            icon={sheet === 'from' ? 'pin' : 'flag'}
            value={(sheet === 'from' ? from : to).label}
            near={(sheet === 'from' ? from : to).location}
            places={points ?? []}
            hint={(sheet === 'from' && !toHome) || (sheet === 'to' && toHome) ? 'Kept private — drivers only see your pickup point.' : undefined}
            onSelect={(pl) => {
              if (sheet === 'from') setFrom(pl)
              else setTo(pl)
              setSheet(null)
            }}
          />
        </div>
      </BottomSheet>

      {/* Travel days — calendar */}
      <BottomSheet open={sheet === 'days'} onClose={() => setSheet(null)} title="Travel days">
        <div className="stack-3">
          <CommuteCalendar value={schedule} onChange={(patch) => updatePlan(patch)} />
          <LiftyButton disabled={!scheduleReady} onClick={() => setSheet(null)}>Done</LiftyButton>
        </div>
      </BottomSheet>

      {/* Time */}
      <BottomSheet open={sheet === 'time'} onClose={() => setSheet(null)} title={toHome ? 'When do you leave work?' : 'When do you need to arrive?'}>
        <div className="stack-4">
          {toHome ? (
            <Select label="Leave work after" value={p.returnTime} onChange={(v) => updatePlan({ returnTime: v })} options={timeOptions(14, 20)} />
          ) : (
            <>
              <Select label="Arrive before" value={p.arriveBy} onChange={(v) => updatePlan({ arriveBy: v, arriveWindowStart: addMinutes(v, -Math.max(windowMin, 15)) })} options={timeOptions(6, 10)} />
              <div>
                <p className="eyebrow" style={{ marginBottom: 8 }}>How early can you arrive?</p>
                <Segmented label="Arrival flexibility" value={Math.max(windowMin, 15)} onChange={(w) => updatePlan({ arriveWindowStart: addMinutes(p.arriveBy, -w) })} options={[{ value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 45, label: '45 min' }]} />
                <p className="small muted" style={{ marginTop: 6 }}>Arriving between {p.arriveWindowStart} and {p.arriveBy}. More flexibility = more matches.</p>
              </div>
            </>
          )}
          <LiftyButton onClick={() => setSheet(null)}>Done</LiftyButton>
        </div>
      </BottomSheet>

      {/* Pickup preference */}
      <BottomSheet open={sheet === 'pickup'} onClose={() => setSheet(null)} title="Pickup preference">
        <div className="stack-4">
          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>How far will you walk to a pickup point?</p>
            <Segmented label="Walking distance" value={p.maxWalkMeters} onChange={(v) => updatePlan({ maxWalkMeters: v })} options={[{ value: 0, label: 'None' }, { value: 250, label: '250m' }, { value: 500, label: '500m' }, { value: 750, label: '750m' }, { value: 1000, label: '1km' }]} />
            <p className="small muted" style={{ marginTop: 6 }}>{p.maxWalkMeters ? `Up to ${formatDistance(p.maxWalkMeters)} · about ${walkMin} min on foot. Walking a little usually unlocks better matches.` : 'Drivers must come to your address — expect fewer matches.'}</p>
          </div>
          {p.maxWalkMeters > 0 && (
            <div>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Preferred pickup point (optional)</p>
              <div className="list" role="radiogroup" aria-label="Preferred pickup point">
                <button type="button" role="radio" aria-checked={!p.preferredPickup} className="row" onClick={() => updatePlan({ preferredPickup: undefined })}>
                  <span className="row-icon"><Icon name="route" size={18} /></span>
                  <span className="row-text"><span className="row-title">Best spot on the driver’s route</span><span className="row-sub">We pick the closest safe point for each match</span></span>
                  {!p.preferredPickup && <Icon name="check" size={20} />}
                </button>
                {nearby.length === 0 && <p className="small muted" style={{ padding: 12 }}>No community pickup points near {from.label} yet.</p>}
                {nearby.slice(0, 6).map((pt) => {
                  const on = p.preferredPickup?.label === pt.label
                  const tooFar = pt.d > p.maxWalkMeters
                  return (
                    <button key={pt.label + pt.location.lat} type="button" role="radio" aria-checked={on} className="row" onClick={() => updatePlan({ preferredPickup: pt, maxWalkMeters: tooFar ? Math.min(1000, Math.ceil(pt.d / 250) * 250) : p.maxWalkMeters })}>
                      <span className="row-icon"><Icon name="pin" size={18} /></span>
                      <span className="row-text"><span className="row-title">{pt.label}</span><span className="row-sub">{pt.area} · {formatDistance(pt.d)} walk (~{Math.round(pt.d / WALK_M_PER_MIN)} min){tooFar ? ' · beyond your walking limit' : ''}</span></span>
                      {on && <Icon name="check" size={20} />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <LiftyButton onClick={() => setSheet(null)}>Done</LiftyButton>
        </div>
      </BottomSheet>
    </>
  )
}
