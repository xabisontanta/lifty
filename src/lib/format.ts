import { WEEKDAYS, type Weekday } from '@/domain/types'

export const rand = (n: number) =>
  `R${Math.round(n).toLocaleString('en-ZA').replace(/\u00a0/g, ',').replace(/\s/g, ',')}`

export function formatDays(days: Weekday[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 0) return 'No days'
  if (sorted.length === 7) return 'Every day'
  let contiguous = true
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) contiguous = false
  if (contiguous && sorted.length > 2) return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`
  return sorted.map((d) => WEEKDAYS[d]).join(', ')
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)}m`
}

export function walkLabel(m: number): string {
  if (m <= 0) return 'No walking'
  return `Up to ${m >= 1000 ? `${m / 1000}km` : `${m}m`}`
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return `${m} min ago`
}

export function initials(first: string, last = ''): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + mins
  const hh = Math.floor(((t % 1440) + 1440) % 1440 / 60)
  const mm = ((t % 60) + 60) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function isoDate(offsetDays = 0, now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}
