create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;

create or replace function public.suggested_contribution(p_distance_m int, p_days int, p_seats int)
returns int language sql immutable set search_path = '' as $$
  select (round(((p_distance_m / 1000.0) * 2.5 * greatest(p_days, 1) * 4.33) / greatest(p_seats + 1, 2) / 10) * 10)::int;
$$;

create or replace function public.contribution_cap(p_distance_m int, p_days int, p_seats int)
returns int language sql immutable set search_path = '' as $$
  select (ceil(public.suggested_contribution(p_distance_m, p_days, p_seats) * 1.5 / 10) * 10)::int;
$$;

create or replace function public.upsert_driver_leg(
  p_direction public.leg_direction,
  p_origin_label text, p_origin_lng float8, p_origin_lat float8,
  p_destination_label text, p_destination_lng float8, p_destination_lat float8,
  p_route jsonb, p_distance_m int, p_duration_s int,
  p_departure time, p_days smallint[], p_seats int, p_max_deviation int, p_contribution int
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_cap int;
  v_members int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'driver') then
    raise exception 'Only drivers can publish a commute';
  end if;
  v_cap := contribution_cap(p_distance_m, coalesce(array_length(p_days, 1), 0), p_seats);
  if p_contribution > v_cap then
    raise exception 'Contribution is above the cost-sharing limit of R% per month', v_cap;
  end if;
  select count(*) into v_members from club_members m join driver_legs l on l.id = m.leg_id
    where l.driver_id = auth.uid() and l.direction = p_direction and m.active;

  insert into driver_legs (driver_id, direction, origin_label, origin, destination_label, destination, route,
                           route_distance_m, route_duration_s, departure_time, days, seats_open, max_deviation_min, monthly_contribution)
  values (auth.uid(), p_direction, p_origin_label, st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography,
          p_destination_label, st_setsrid(st_makepoint(p_destination_lng, p_destination_lat), 4326)::geography,
          st_setsrid(st_geomfromgeojson(p_route::text), 4326)::geography,
          p_distance_m, p_duration_s, p_departure, p_days, greatest(p_seats - v_members, 0), p_max_deviation, p_contribution)
  on conflict (driver_id, direction) do update set
    origin_label = excluded.origin_label, origin = excluded.origin,
    destination_label = excluded.destination_label, destination = excluded.destination,
    route = excluded.route, route_distance_m = excluded.route_distance_m, route_duration_s = excluded.route_duration_s,
    departure_time = excluded.departure_time, days = excluded.days, seats_open = excluded.seats_open,
    max_deviation_min = excluded.max_deviation_min, monthly_contribution = excluded.monthly_contribution, active = true
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.find_matches(p_commute uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c passenger_commutes;
begin
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  if not found then
    raise exception 'Commute not found';
  end if;

  return query
  select x.m from (
  with legs as (
    select l.*, l.route::geometry as g
    from driver_legs l
    where l.active and l.direction = c.direction and l.seats_open > 0 and l.driver_id <> c.passenger_id
      and l.days && c.days
      and st_dwithin(l.route, c.destination, 1500)
      and st_dwithin(l.route, c.origin, c.max_walk_m + 1200)
      and not exists (select 1 from club_members m where m.leg_id = l.id and m.passenger_id = c.passenger_id and m.active)
  ),
  candidates as (
    select l.id as leg_id, pp.name as label, pp.location as pt
    from legs l
    join pickup_points pp on st_dwithin(pp.location, c.origin, c.max_walk_m) and st_dwithin(pp.location, l.route, 800)
    union all
    select l.id, 'On ' || split_part(l.destination_label, ',', 1) || ' route', st_closestpoint(l.g, c.origin::geometry)::geography
    from legs l where c.max_walk_m > 0 and st_dwithin(l.route, c.origin, c.max_walk_m)
    union all
    select l.id, 'Your street', c.origin from legs l where c.max_walk_m = 0
  ),
  scored as (
    select k.leg_id, k.label, k.pt,
           round(st_distance(k.pt, c.origin) * 1.25)::int as walk_m,
           st_distance(k.pt, l.route) as off_m,
           st_linelocatepoint(l.g, k.pt::geometry) as fa,
           st_linelocatepoint(l.g, st_closestpoint(l.g, c.destination::geometry)) as fb
    from candidates k join legs l on l.id = k.leg_id
  ),
  best as (
    select distinct on (s.leg_id) s.* from scored s
    where s.fb > s.fa
    order by s.leg_id, s.walk_m + 3 * s.off_m
  ),
  metrics as (
    select b.*, l.driver_id, l.g, l.departure_time, l.route_duration_s, l.route_distance_m, l.days as leg_days,
           l.seats_open, l.max_deviation_min, l.monthly_contribution, l.destination_label as leg_destination,
           ceil(b.walk_m / 70.0)::int as walk_min,
           (ceil((2 * b.off_m * 1.3) / 500.0) + case when b.off_m > 30 then 1 else 0 end)::int as dev_min,
           least(100, round(100 * (b.fb - b.fa) * l.route_distance_m / nullif(st_distance(c.origin, c.destination) * 1.3, 0)))::int as overlap,
           cardinality(array(select unnest(l.days) intersect select unnest(c.days))) as shared_days
    from best b join legs l on l.id = b.leg_id
  ),
  timed as (
    select m.*,
           m.departure_time + make_interval(secs => m.fa * m.route_duration_s + m.dev_min * 30) as pickup_time,
           m.departure_time + make_interval(secs => m.fb * m.route_duration_s + m.dev_min * 60) as arrival_time
    from metrics m
    where m.dev_min <= m.max_deviation_min
  ),
  ok as (
    select t.* from timed t
    where (c.direction = 'to_work'
             and t.arrival_time <= c.arrive_by
             and t.arrival_time >= c.arrive_by - make_interval(mins => c.window_min + 45))
       or (c.direction = 'to_home'
             and t.pickup_time >= c.arrive_by
             and t.pickup_time <= c.arrive_by + make_interval(mins => 45))
  )
  select jsonb_build_object(
    'id', o.leg_id,
    'legId', o.leg_id,
    'commuteId', c.id,
    'direction', c.direction,
    'driver', jsonb_build_object(
      'id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
      'rating', p.rating, 'ratingCount', p.rating_count, 'reliability', p.reliability,
      'completedArrangements', p.completed_arrangements, 'memberSince', p.created_at::date, 'about', p.about,
      'identityStatus', coalesce(p.identity_status::text, 'pending')),
    'vehicle', jsonb_build_object(
      'make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
      'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path,
      'status', v.status),
    'origin', jsonb_build_object('label', c.origin_label, 'lng', st_x(c.origin::geometry), 'lat', st_y(c.origin::geometry)),
    'pickup', jsonb_build_object('label', o.label, 'lng', st_x(o.pt::geometry), 'lat', st_y(o.pt::geometry)),
    'destination', jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
    'geometry', jsonb_build_object(
      'path', st_asgeojson(st_linesubstring(o.g, greatest(0, o.fa - 2500.0 / o.route_distance_m), o.fb), 6)::jsonb,
      'deviation', st_asgeojson(st_makeline(array[
          st_lineinterpolatepoint(o.g, greatest(0, o.fa - 300.0 / o.route_distance_m)),
          o.pt::geometry,
          st_lineinterpolatepoint(o.g, least(1, o.fa + 300.0 / o.route_distance_m))]), 6)::jsonb,
      'walking', st_asgeojson(st_makeline(c.origin::geometry, o.pt::geometry), 6)::jsonb),
    'routeOverlap', o.overlap,
    'walkingDistanceM', o.walk_m,
    'walkingMinutes', o.walk_min,
    'driverDeviationMinutes', o.dev_min,
    'additionalDistanceKm', round((2 * o.off_m * 1.3 / 1000)::numeric, 1),
    'departureTime', to_char(o.departure_time, 'HH24:MI'),
    'pickupEta', to_char(o.pickup_time, 'HH24:MI'),
    'arrivalEta', to_char(o.arrival_time, 'HH24:MI'),
    'days', to_jsonb(o.leg_days),
    'availableSeats', o.seats_open,
    'monthlyContribution', o.monthly_contribution,
    'currentCommuteMinutes', round(o.route_duration_s / 60.0),
    'members', coalesce((select jsonb_agg(jsonb_build_object('firstName', mp.first_name, 'avatarPath', mp.avatar_path))
                         from club_members cm join profiles mp on mp.id = cm.passenger_id
                         where cm.leg_id = o.leg_id and cm.active), '[]'::jsonb),
    'compatibility', round(o.overlap * 0.45
                          + greatest(0, 100 - o.walk_m::numeric / greatest(c.max_walk_m, 250) * 60) * 0.2
                          + greatest(0, 100 - o.dev_min * 9) * 0.2
                          + (o.shared_days::numeric / greatest(cardinality(c.days), 1)) * 100 * 0.15)
  ) as m
  from ok o
  join profiles p on p.id = o.driver_id
  join vehicles v on v.driver_id = o.driver_id
  ) x
  order by (x.m ->> 'compatibility')::numeric desc
  limit 20;
end $$;

create or replace function public.get_match(p_commute uuid, p_leg uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select m from public.find_matches(p_commute) m where m ->> 'legId' = p_leg::text limit 1;
$$;
