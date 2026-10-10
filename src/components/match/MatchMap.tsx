import type { ReactNode } from 'react'
import type { DriverLocation, LatLng, RouteGeometry } from '@/domain/types'
import {
  DestinationMarker,
  DeviationChip,
  DeviationRoute,
  DriverMarker,
  MapLegend,
  MapView,
  PassengerMarker,
  PickupMarker,
  RouteLine,
  WalkingPath,
  LocationDot,
} from '@/components/map/MapView'

interface Props {
  geometry: RouteGeometry
  pickup: LatLng
  destination: LatLng
  pickupLabel?: string
  destinationLabel?: string
  passenger?: LatLng | null
  driver?: DriverLocation | LatLng | null
  height?: number | string
  dark?: boolean
  /** 'overview' fits whole commute; 'pickup' zooms to the meeting area; 'ride' follows the driver */
  focus?: 'overview' | 'pickup' | 'ride'
  showDeviation?: boolean
  showWalking?: boolean
  showRoute?: boolean
  deviationText?: string
  legend?: boolean
  stale?: boolean
  overlay?: ReactNode
  padding?: number | { top: number; right: number; bottom: number; left: number }
  label?: string
  animate?: boolean
  /** small whole-route overview in the corner (for zoomed-in static views) */
  inset?: boolean
  passengerLabel?: string
  fallbackNoticeTop?: number
}

export function MatchMap({
  geometry,
  pickup,
  destination,
  pickupLabel = 'Pickup',
  destinationLabel,
  passenger,
  driver,
  height = 280,
  dark,
  focus = 'overview',
  showDeviation = true,
  showWalking = true,
  showRoute = true,
  deviationText,
  legend,
  stale,
  overlay,
  padding,
  label,
  animate = true,
  inset,
  passengerLabel,
  fallbackNoticeTop,
}: Props) {
  const local: LatLng[] = [pickup, ...geometry.walking, ...geometry.deviation]
  if (passenger) local.push(passenger)
  if (driver) local.push(driver)

  let fit: LatLng[]
  if (focus === 'overview') fit = [...geometry.path.slice(0, 1), ...local, destination]
  else if (focus === 'ride') fit = [pickup, destination, ...(driver ? [driver] : [])]
  else fit = local

  const drv = driver && 'heading' in driver ? driver : driver ? { ...driver, heading: 200, speed: 0, updatedAt: 0 } : null

  return (
    <div className="map-wrap">
      <MapView fit={fit} height={height} dark={dark} padding={padding ?? (focus === 'pickup' ? 54 : 48)} fallbackNoticeTop={fallbackNoticeTop} label={label ?? 'Map showing the driver route, walking path and pickup point'} overlay={<>{overlay}{inset && <div className="map-inset" aria-hidden><MapView schematic fit={[...geometry.path.slice(0, 1), destination]} height="100%" padding={18} label="Whole route overview"><RouteLine path={geometry.path} animate={false} /><LocationDot at={pickup} color="var(--teal)" /><LocationDot at={destination} color="var(--error)" /></MapView></div>}</>}>
        {showRoute && <RouteLine path={geometry.path} animate={animate} />}
        {showDeviation && <DeviationRoute path={geometry.deviation} animate={animate} />}
        {showWalking && <WalkingPath path={geometry.walking} animate={animate} />}
        {focus !== 'ride' && <PickupMarker at={pickup} label={pickupLabel} />}
        {(focus === 'overview' || focus === 'ride') && <DestinationMarker at={destination} label={destinationLabel ?? 'Destination'} />}
        {showDeviation && deviationText && focus !== 'ride' && <DeviationChip path={geometry.deviation} text={deviationText} />}
        {passenger && <PassengerMarker at={passenger} label={passengerLabel ?? (focus === 'pickup' ? 'You' : undefined)} />}
        {drv && <DriverMarker at={drv} heading={drv.heading} stale={stale} />}
      </MapView>
      {legend && (
        <MapLegend
          items={[
            { color: 'var(--map-blue)', label: "Driver's normal route" },
            { color: 'var(--warning)', label: 'Pickup deviation' },
            { color: 'var(--navy)', label: 'Your walk', dotted: true },
          ]}
        />
      )}
    </div>
  )
}
