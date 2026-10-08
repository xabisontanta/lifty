import type { LatLng, Place } from '@/domain/types'
import type { DriverLeg } from '@/services/matchingService'
import { simulatedRouter } from '@/services/demoRouter'
import { DRIVERS, MAIN_ROUTE, PICKUP_SHELL, WORK } from './mock'

/**
 * DEMO FIXTURES — inputs only (who drives where, when, with how many seats).
 * Every metric shown to the user (overlap, walk, deviation, arrival, score) is DERIVED from these
 * by the matching engine through the simulated router; none is written here.
 */

const shift = (route: LatLng[], dLat: number, dLng: number): LatLng[] => route.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }))
const place = (label: string, area: string, p: LatLng): Place => ({ label, area, location: p, source: 'saved_location' })

const START = place('Ballito', 'Ballito, KwaDukuza', MAIN_ROUTE[0])
const KEVIN_ROUTE = shift(MAIN_ROUTE, 0.012, 0.016)
const THANDO_ROUTE = shift(MAIN_ROUTE, 0, 0.0012) // a parallel street ~115 m from Sipho's road
const THANDO_START = place('Ballito', 'Ballito, KwaDukuza', THANDO_ROUTE[0])

export const DEMO_PICKUP_POINTS: Place[] = [
  PICKUP_SHELL,
  place('Engen Forecourt', 'Ballito', { lat: -29.5412, lng: 31.2098 }),
  place('Lifestyle Centre taxi rank', 'Ballito', { lat: -29.5352, lng: 31.2148 }),
  place('Ridge Road', 'Umhlanga Ridge', { lat: -29.7283, lng: 31.0768 }),
  place('Gateway entrance', 'Umhlanga Ridge', { lat: -29.7262, lng: 31.0735 }),
].map((p) => ({ ...p, source: 'saved_location' as const }))

const members = (n: { firstName: string; avatarHue: number }[]) => n

const morning: DriverLeg[] = [
  { id: 'm-sipho', driver: DRIVERS[0], direction: 'to_work', originPlace: START, destinationPlace: WORK, route: MAIN_ROUTE, days: [0, 1, 2, 3, 4], departureTime: '06:30', seatsOpen: 2, maxDeviationMin: 8, monthlyContribution: 1100, active: true, acceptingPassengers: true, members: members([{ firstName: 'Lindiwe', avatarHue: 300 }]) },
  { id: 'm-thando', driver: DRIVERS[1], direction: 'to_work', originPlace: THANDO_START, destinationPlace: WORK, route: THANDO_ROUTE, days: [0, 1, 2, 3, 4], departureTime: '06:20', seatsOpen: 1, maxDeviationMin: 6, monthlyContribution: 1050, active: true, acceptingPassengers: true, members: members([{ firstName: 'Bheki', avatarHue: 40 }, { firstName: 'Karen', avatarHue: 200 }]) },
  { id: 'm-kevin', driver: DRIVERS[2], direction: 'to_work', originPlace: place('Sheffield Beach', 'KwaDukuza', KEVIN_ROUTE[0]), destinationPlace: WORK, route: KEVIN_ROUTE, days: [0, 1, 2, 3], departureTime: '06:40', seatsOpen: 2, maxDeviationMin: 10, monthlyContribution: 950, active: true, acceptingPassengers: true, members: [] },
]

const evening: DriverLeg[] = [
  { ...morning[0], id: 'm-sipho-home', direction: 'to_home', originPlace: WORK, destinationPlace: START, route: [...MAIN_ROUTE].reverse(), departureTime: '17:00' },
  { ...morning[1], id: 'm-thando-home', direction: 'to_home', originPlace: WORK, destinationPlace: THANDO_START, route: [...THANDO_ROUTE].reverse(), departureTime: '17:15' },
]

export const DEMO_LEGS: DriverLeg[] = [...morning, ...evening]

/** Demo routing: the simulated provider driving along the drivers' stored roads. */
export const demoRouter = () => simulatedRouter({ roads: DEMO_LEGS.map((l) => l.route) })
