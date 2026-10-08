import { useMemo, useState } from 'react'
import { WEEKDAYS } from '@/domain/types'
import { holidayName } from '@/lib/holidays'
import { isCommuteDay as domainIsCommuteDay, scheduleSummary as domainSummary, weekdaysOfDates as domainWeekdays, weekdayOf as domainWeekdayOf, type CommuteSchedule } from '@/domain/schedule'
import { Icon } from './Icon'
import { DayPicker, Segmented, Toggle } from './kit'

export type ScheduleValue = CommuteSchedule

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayIso = () => {
  const t = new Date()
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate())
}
export const weekdayOf = domainWeekdayOf
const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })

export const isCommuteDay = domainIsCommuteDay
export const weekdaysOfDates = domainWeekdays
export const scheduleSummary = (v: ScheduleValue) => domainSummary(v, todayIso())

const endPresets = (start: string): { label: string; value: string | undefined }[] => {
  const plus = (months: number) => {
    const d = new Date(`${start}T12:00:00`)
    d.setMonth(d.getMonth() + months)
    return d.toISOString().slice(0, 10)
  }
  const y = Number(start.slice(0, 4))
  return [
    { label: 'No end date', value: undefined },
    { label: '3 months', value: plus(3) },
    { label: '6 months', value: plus(6) },
    { label: `Until 31 Dec`, value: `${y}-12-31` },
  ]
}

export function CommuteCalendar({ value, onChange }: { value: ScheduleValue; onChange: (patch: Partial<ScheduleValue>) => void }) {
  const today = todayIso()
  const first = value.scheduleMode === 'dates' ? value.dates.find((d) => d >= today) ?? today : value.startDate > today ? value.startDate : today
  const [cursor, setCursor] = useState(() => ({ y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) - 1 }))
  const [tapSets, setTapSets] = useState<'start' | 'end'>('start')

  const cells = useMemo(() => {
    const startDow = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7
    const daysIn = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const out: (string | null)[] = Array(startDow).fill(null)
    for (let d = 1; d <= daysIn; d++) out.push(isoOf(cursor.y, cursor.m, d))
    while (out.length % 7) out.push(null)
    return out
  }, [cursor])

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
  const inMonth = cells.filter((c): c is string => !!c && c >= today)
  const countThisMonth = inMonth.filter((d) => isCommuteDay(value, d)).length

  const tap = (iso: string) => {
    if (iso < today) return
    if (value.scheduleMode === 'dates') {
      const dates = value.dates.includes(iso) ? value.dates.filter((d) => d !== iso) : [...value.dates, iso].sort()
      onChange({ dates, days: weekdaysOfDates(dates) })
      return
    }
    if (tapSets === 'start') {
      onChange({ startDate: iso, endDate: value.endDate && value.endDate < iso ? undefined : value.endDate })
    } else {
      onChange({ endDate: iso < value.startDate ? value.startDate : iso })
    }
  }

  const move = (delta: number) => setCursor(({ y, m }) => {
    const d = new Date(y, m + delta, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const nowY = new Date().getFullYear()
  const nowM = new Date().getMonth()
  const atStart = cursor.y === nowY && cursor.m === nowM

  return (
    <div className="stack-4">
      <Segmented
        label="How often"
        value={value.scheduleMode}
        onChange={(scheduleMode) => onChange(scheduleMode === 'dates' ? { scheduleMode, days: weekdaysOfDates(value.dates) } : { scheduleMode, days: value.days.length ? value.days : [0, 1, 2, 3, 4] })}
        options={[{ value: 'weekly', label: 'Weekly' }, { value: 'dates', label: 'Specific dates' }, { value: 'recurring', label: 'Ongoing' }]}
      />

      {value.scheduleMode !== 'dates' ? (
        <>
          <div className="stack-2">
            <p className="eyebrow">Days I travel</p>
            <DayPicker value={value.days} onChange={(days) => onChange({ days })} />
          </div>
          {value.scheduleMode === 'recurring' && (
            <div className="stack-2">
              <p className="eyebrow">How long?</p>
              <div className="chips" role="radiogroup" aria-label="How long">
                {endPresets(value.startDate).map((p) => (
                  <button key={p.label} type="button" role="radio" aria-checked={value.endDate === p.value} className={`chip ${value.endDate === p.value ? 'on' : ''}`} onClick={() => onChange({ endDate: p.value })}>{p.label}</button>
                ))}
              </div>
              <p className="small muted">Starting {pretty(value.startDate)}. Tap a date below to change the start, or pick a custom end date.</p>
            </div>
          )}
          <div className="row-flex between">
            <span className="small muted">Tap the calendar to set</span>
            <div className="chips">
              <button type="button" className={`chip ${tapSets === 'start' ? 'on' : ''}`} aria-pressed={tapSets === 'start'} onClick={() => setTapSets('start')}>Start date</button>
              <button type="button" className={`chip ${tapSets === 'end' ? 'on' : ''}`} aria-pressed={tapSets === 'end'} onClick={() => setTapSets('end')}>End date</button>
            </div>
          </div>
        </>
      ) : (
        <p className="small muted">Tap each day you need a lift. You only contribute for the days you pick.</p>
      )}

      <div className="cal" role="grid" aria-label={`Commute calendar, ${monthLabel}`}>
        <div className="cal-head">
          <button type="button" className="icon-btn" aria-label="Previous month" disabled={atStart} onClick={() => move(-1)}><Icon name="back" size={20} /></button>
          <strong>{monthLabel}</strong>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => move(1)}><Icon name="chevron" size={20} /></button>
        </div>
        <div className="cal-grid" role="row">
          {WEEKDAYS.map((d) => <span key={d} className="cal-dow" role="columnheader">{d.charAt(0)}</span>)}
          {cells.map((iso, i) => {
            if (!iso) return <span key={`e${i}`} />
            const past = iso < today
            const hol = holidayName(iso)
            const on = !past && isCommuteDay(value, iso)
            const isStart = value.scheduleMode !== 'dates' && iso === value.startDate
            const isEnd = value.scheduleMode !== 'dates' && iso === value.endDate
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                aria-selected={on}
                aria-label={`${pretty(iso)}${hol ? `, ${hol}` : ''}${on ? ', commuting' : ''}${past ? ', past' : ''}`}
                title={hol}
                disabled={past}
                className={`cal-day ${on ? 'on' : ''} ${hol ? 'hol' : ''} ${iso === today ? 'today' : ''} ${isStart ? 'start' : ''} ${isEnd ? 'end' : ''}`}
                onClick={() => tap(iso)}
              >
                {Number(iso.slice(8))}
              </button>
            )
          })}
        </div>
        <div className="cal-legend small muted">
          <span><i className="cal-key on" /> Commuting</span>
          <span><i className="cal-key hol" /> Public holiday</span>
          {value.scheduleMode !== 'dates' && <span><i className="cal-key start" /> Start / end</span>}
        </div>
      </div>

      <div className="row-flex between">
        <div>
          <strong>Skip public holidays</strong>
          <p className="small muted">No pickups on South African public holidays.</p>
        </div>
        <Toggle label="Skip public holidays" checked={value.skipHolidays} onChange={(skipHolidays) => onChange({ skipHolidays })} />
      </div>

      <div className="banner banner-info" role="status">
        <Icon name="calendar" size={20} />
        <div className="banner-text">
          <strong>{scheduleSummary(value)}</strong>
          {countThisMonth} commuting day{countThisMonth === 1 ? '' : 's'} in {monthLabel.split(' ')[0]}
          {value.scheduleMode !== 'dates' && value.endDate && (
            <> · <button type="button" className="btn-text" style={{ minHeight: 0, padding: 0 }} onClick={() => onChange({ endDate: undefined })}>Remove end date</button></>
          )}
        </div>
      </div>
    </div>
  )
}
