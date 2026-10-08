import { measure as measureWith, type RoutingInput, type Router } from '@/domain/measure'
import { directions } from './mapbox'

/** The app's router: Mapbox Directions from the browser. The pure measuring logic lives in domain/measure. */
export const mapboxRouter: Router = {
  drive: (p) => directions(p, 'driving'),
  walk: (p) => directions(p, 'walking'),
}

export const measure = (input: RoutingInput, router: Router = mapboxRouter) => measureWith(input, router)
export type { Measured, Router, RoutingInput, RouteResult } from '@/domain/measure'
