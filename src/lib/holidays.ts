/**
 * South African public holidays (Public Holidays Act — a holiday on a Sunday moves to Monday).
 * Shown on the commute calendar and skipped by default, since most commuters don't travel.
 */
const FIXED: [string, string][] = [
  ['01-01', 'New Year’s Day'],
  ['03-21', 'Human Rights Day'],
  ['04-27', 'Freedom Day'],
  ['05-01', 'Workers’ Day'],
  ['06-16', 'Youth Day'],
  ['08-09', 'National Women’s Day'],
  ['09-24', 'Heritage Day'],
  ['12-16', 'Day of Reconciliation'],
  ['12-25', 'Christmas Day'],
  ['12-26', 'Day of Goodwill'],
]

// Good Friday + Family Day (Easter Monday) — Gregorian Easter (anonymous algorithm)
function easter(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const cache = new Map<number, Map<string, string>>()

export function holidaysFor(year: number): Map<string, string> {
  const hit = cache.get(year)
  if (hit) return hit
  const out = new Map<string, string>()
  for (const [md, name] of FIXED) {
    const d = new Date(`${year}-${md}T00:00:00Z`)
    out.set(iso(d), name)
    if (d.getUTCDay() === 0) {
      const mon = new Date(d.getTime() + 86400000)
      out.set(iso(mon), `${name} (observed)`)
    }
  }
  const e = easter(year)
  out.set(iso(new Date(e.getTime() - 2 * 86400000)), 'Good Friday')
  out.set(iso(new Date(e.getTime() + 86400000)), 'Family Day')
  cache.set(year, out)
  return out
}

export function holidayName(isoDate: string): string | undefined {
  return holidaysFor(Number(isoDate.slice(0, 4))).get(isoDate)
}
