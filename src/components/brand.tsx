export function LogoMark({ size = 40, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19d3a6" />
          <stop offset="1" stopColor="#00805f" />
        </linearGradient>
      </defs>
      <path d="M24 3C14.6 3 7.5 10 7.5 19c0 11.5 13.8 23.6 15.7 25.2a1.3 1.3 0 0 0 1.6 0C26.7 42.6 40.5 30.500 40.5 19 40.500 10 33.400 3 24 3Z" fill="url(#lm)" />
      <circle cx="24" cy="19" r="7" fill={light ? '#0f2d4a' : '#fff'} opacity={light ? 0.92 : 1} />
      <path d="M15 24c4 4.500 10 6 18 1" fill="none" stroke={light ? '#fff' : '#0f2d4a'} strokeWidth="0" />
    </svg>
  )
}

export function Logo({ light = false, size = 40 }: { light?: boolean; size?: number }) {
  return (
    <span className="logo" style={{ color: light ? '#fff' : 'var(--navy)', fontSize: size * 0.68 }} aria-label="Lifty">
      <LogoMark size={size} light={false} />
      Lifty
    </span>
  )
}

/** Skyline + road illustration for the welcome hero (no external image dependency). */
export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 400 520" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1f35" />
          <stop offset="0.65" stopColor="#12485f" />
          <stop offset="1" stopColor="#1b7a7a" />
        </linearGradient>
        <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd9a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="400" height="520" fill="url(#sky)" />
      <circle cx="300" cy="250" r="90" fill="url(#sun)" opacity="0.55" />
      <g fill="#0b2a42" opacity="0.7">
        <rect x="10" y="260" width="34" height="140" /><rect x="52" y="220" width="28" height="180" /><rect x="88" y="280" width="40" height="120" />
        <rect x="136" y="190" width="30" height="210" /><rect x="176" y="250" width="36" height="150" /><rect x="222" y="170" width="26" height="230" />
        <rect x="256" y="240" width="42" height="160" /><rect x="306" y="200" width="30" height="200" /><rect x="344" y="270" width="46" height="130" />
      </g>
      <g fill="#ffe8b8" opacity="0.5">
        {Array.from({ length: 34 }, (_, i) => (
          <rect key={i} x={20 + ((i * 47) % 360)} y={225 + ((i * 29) % 150)} width="3" height="5" />
        ))}
      </g>
      <path d="M-20 520 L170 400 L230 400 L430 520Z" fill="#0c1b2b" />
      <path d="M200 400 L196 520 M200 400 L236 520" stroke="#fff" strokeOpacity=".5" strokeWidth="2.200" strokeDasharray="14 12" />
      <g transform="translate(150 410)">
        <ellipse cx="50" cy="52" rx="62" ry="8" fill="#000" opacity=".35" />
        <path d="M6 44c0-10 4-16 14-20l18-10c8-4 22-4 34 0l16 8c12 3 20 8 20 22v8H6Z" fill="#cfd8e3" />
        <path d="M28 24l12-8c8-3 20-3 28 0l12 8Z" fill="#6f8aa6" />
        <circle cx="28" cy="52" r="9" fill="#10202f" /><circle cx="86" cy="52" r="9" fill="#10202f" />
        <circle cx="28" cy="52" r="4" fill="#9fb0c2" /><circle cx="86" cy="52" r="4" fill="#9fb0c2" />
        <rect x="106" y="38" width="8" height="5" rx="2" fill="#ffe08a" />
      </g>
    </svg>
  )
}
