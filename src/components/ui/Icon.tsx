import type { SVGProps } from 'react'

const P: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a3 3 0 000-6h-4a3 3 0 010-6h6',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5',
  inbox: 'M21 15a2 2 0 01-2 2H8l-5 4V6a2 2 0 012-2h14a2 2 0 012 2z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 3.5a4 4 0 010 7.5M22 21a7 7 0 00-4-6.3',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8zM10.5 20a2 2 0 003 0',
  pin: 'M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  car: 'M5 17h14M3 13l2-6a2 2 0 012-1.4h10A2 2 0 0119 7l2 6v4a1 1 0 01-1 1h-1.5M3 13v4a1 1 0 001 1h1.5M3 13h18M7.5 17a1.5 1.5 0 100 .01M16.5 17a1.5 1.5 0 100 .01',
  walk: 'M13 4.5a1.5 1.5 0 100-.01M9 21l2-7 3 2v5M11 14l-1-4 4-1 2 3 3 1M8 12l1-3',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  shieldCheck: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5L16 9.5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  message: 'M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  alert: 'M12 3l10 18H2zM12 10v5M12 18.2v.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12M17 13.5h.01',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17v.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  refresh: 'M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015-2.7M19 12.5a10 10 0 00-3-2.2M12 20v.01',
  navigation: 'M12 3l7 17-7-4-7 4z',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12v.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  home2: 'M4 11l8-7 8 7v9H4z',
  gauge: 'M4 18a9 9 0 1116 0M12 18l4-6',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  leaf: 'M5 19C5 10 10 4 20 4c0 10-6 15-15 15zM5 19c3-5 6-8 10-10',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  heart: 'M12 21s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 6-8 11-8 11z',
  seat: 'M7 4v9h9l2 7M7 13l-2 7M12 4h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
}

export type IconName = keyof typeof P

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  filled?: boolean
  label?: string
}

export function Icon({ name, size = 22, filled = false, label, strokeWidth = 1.9, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  )
}
