import type { LatLng } from '@/domain/types'

/**
 * Lifty shows routes and live positions, but turn-by-turn navigation is handed
 * to the apps drivers already trust (Google Maps / Waze) via deep links.
 */

export type NavApp = 'google' | 'waze'

export function navigationUrl(app: NavApp, opts: { destination: LatLng; waypoint?: LatLng; mode?: 'driving' | 'walking' }): string {
  const { destination, waypoint, mode = 'driving' } = opts
  const d = `${destination.lat},${destination.lng}`
  if (app === 'waze') {
    // Waze has no multi-stop deep link: go to the pickup first if there is one.
    const target = waypoint ?? destination
    return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`
  }
  const wp = waypoint ? `&waypoints=${waypoint.lat},${waypoint.lng}` : ''
  return `https://www.google.com/maps/dir/?api=1&destination=${d}${wp}&travelmode=${mode}`
}

export function openNavigation(app: NavApp, opts: Parameters<typeof navigationUrl>[1]) {
  window.open(navigationUrl(app, opts), '_blank', 'noopener')
}
