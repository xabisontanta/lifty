-- Reviewed read-only diagnostic for the current non-demo saved search.
-- No auth identifiers or home coordinates are returned. No rows are changed.
with c as (
  select c.* from public.passenger_commutes c
  join public.profiles p on p.id=c.passenger_id where not p.is_demo
), available as (
  select c.id as commute_id, c.origin as passenger_origin,
    c.destination as passenger_destination, c.max_walk_m, c.days as passenger_days,
    l.id as leg_id, l.driver_id, l.route, l.days as driver_days
  from c cross join public.driver_legs l
  where public.driver_approved(l.driver_id) and l.active and l.seats_open>0
    and l.direction=c.direction and l.driver_id<>c.passenger_id
), destination as (
  select * from available where extensions.st_dwithin(route,passenger_destination,1500)
), origin as (
  select * from destination where extensions.st_dwithin(route,passenger_origin,max_walk_m+1200)
), weekdays as (
  select * from origin where driver_days && passenger_days
), pickup as (
  select * from weekdays w where
    extensions.st_dwithin(w.route,w.passenger_origin,w.max_walk_m)
    or exists(select 1 from public.pickup_points p
      where extensions.st_dwithin(p.location,w.passenger_origin,w.max_walk_m)
      and extensions.st_dwithin(p.location,w.route,800))
)
select jsonb_build_object(
  'saved_searches',(select count(*) from c),
  'approved_available_direction',(select count(*) from available),
  'destination_near_route',(select count(*) from destination),
  'origin_near_route',(select count(*) from origin),
  'weekday_overlap',(select count(*) from weekdays),
  'nearby_pickup_or_route',(select count(*) from pickup)
);
