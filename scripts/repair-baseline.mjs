import { readFileSync, writeFileSync } from 'node:fs'
const p='src/components/match/cards.tsx'
let s=readFileSync(p,'utf8')
s=s.replace("import { AvatarStack } from '@/components/ui/extras'\nimport { AvatarStack } from '@/components/ui/extras'", "import { AvatarStack } from '@/components/ui/extras'")
s=s.replace('aria-label={}>', 'aria-label={`View ${d.firstName} lift club`}>')
s=s.replace('value={} sub={formatDistance(match.walkingDistanceM)}', 'value={walkLabel(match.walkingMinutes)} sub={formatDistance(match.walkingDistanceM)}')
s=s.replace('value={} tone="amber"', 'value={`${match.driverDeviationMinutes} min`} tone="amber"')
const start=s.indexOf('aria-label={\x1b')
const end=s.indexOf('<span>View Match</span>',start)
if(start>=0 && end>start) s=s.slice(0,start)+'aria-label={`View ${d.firstName} match`}>\n        '+s.slice(end)
writeFileSync(p,s)
