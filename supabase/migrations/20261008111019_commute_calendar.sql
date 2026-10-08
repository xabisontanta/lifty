alter table public.passenger_commutes
  add column if not exists start_date date not null default current_date,
  add column if not exists end_date date,
  add column if not exists specific_dates date[];

create or replace function public.per_day_contribution(p_monthly int, p_days_per_week int)
returns int language sql immutable set search_path = '' as $$
  select ceil(p_monthly / (greatest(p_days_per_week, 1) * 4.33))::int;
$$;

create or replace function public.commute_booked_on(c public.passenger_commutes, p_date date)
returns boolean language sql stable set search_path = '' as $$
  select case
    when c.specific_dates is not null and cardinality(c.specific_dates) > 0 then p_date = any (c.specific_dates)
    else p_date >= c.start_date and (c.end_date is null or p_date <= c.end_date)
  end;
$$;

create or replace function public.find_matches(p_commute uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c passenger_commutes;
  v_dated boolean;
begin
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  if not found then
    raise exception 'Commute not found';
  end if;
  v_dated := c.specific_dates is not null and cardinality(c.specific_dates) > 0;

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
      and (not v_dated or exists (select 1 from unnest(c.specific_dates) d where d >= current_date and (extract(isodow from d)::int - 1) = any (l.days)))
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
           cardinality(array(select unnest(l.days) intersect select unnest(c.days))) as shared_days,
           (select count(*) from unnest(coalesce(c.specific_dates, '{}'::date[])) d
             where d >= current_date and (extract(isodow from d)::int - 1) = any (l.days)
               and date_trunc('month', d) = date_trunc('month', (select min(x) from unnest(c.specific_dates) x where x >= current_date)))::int as booked_days
    from best b join legs l on l.id = b.leg_id
  ),
  timed as (
    select m.*,
           m.departure_time + make_interval(secs => m.fa * m.route_duration_s + m.dev_min * 30) as pickup_time,
           m.departure_time + make_interval(secs => m.fb * m.route_duration_s + m.dev_min * 60) as arrival_time,
           per_day_contribution(m.monthly_contribution, cardinality(m.leg_days)) as per_day
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
    'pricing', case when v_dated then 'per_day' else 'monthly' end,
    'perDayContribution', o.per_day,
    'bookedDays', o.booked_days,
    'monthlyContribution', case when v_dated then o.per_day * o.booked_days else o.monthly_contribution end,
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

create or replace function public.request_to_join(p_commute uuid, p_leg uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  m jsonb;
  c passenger_commutes;
  v_id uuid;
  v_driver uuid;
  v_start date;
begin
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  m := get_match(p_commute, p_leg);
  if m is null or c.id is null then
    raise exception 'This lift club is no longer a match for your commute';
  end if;
  v_start := greatest(current_date + 1,
                      case when c.specific_dates is not null and cardinality(c.specific_dates) > 0
                           then (select min(d) from unnest(c.specific_dates) d where d > current_date)
                           else c.start_date end);
  insert into join_requests (passenger_id, leg_id, commute_id, pickup_label, pickup, walking_m, walking_min,
                             deviation_min, route_overlap, pickup_time, monthly_contribution, start_date)
  values (auth.uid(), p_leg, p_commute, m -> 'pickup' ->> 'label',
          st_setsrid(st_makepoint((m -> 'pickup' ->> 'lng')::float8, (m -> 'pickup' ->> 'lat')::float8), 4326)::geography,
          (m ->> 'walkingDistanceM')::int, (m ->> 'walkingMinutes')::int, (m ->> 'driverDeviationMinutes')::int,
          (m ->> 'routeOverlap')::int, (m ->> 'pickupEta')::time, (m ->> 'monthlyContribution')::int, coalesce(v_start, current_date + 1))
  returning id into v_id;
  select driver_id into v_driver from driver_legs where id = p_leg;
  perform notify(v_driver, 'request', 'New lift club request',
                 (select first_name from profiles where id = auth.uid()) || ' would like to join your commute.', '/d/request/' || v_id);
  return v_id;
end $$;

create or replace function public.generate_commute_instances(p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into commute_instances (leg_id, service_date, departs_at, sharing_starts_at, sharing_ends_at)
  select l.id, p_date,
         (p_date + l.departure_time) at time zone 'Africa/Johannesburg',
         ((p_date + l.departure_time) at time zone 'Africa/Johannesburg') - interval '20 minutes',
         ((p_date + l.departure_time) at time zone 'Africa/Johannesburg') + make_interval(secs => l.route_duration_s) + interval '60 minutes'
  from driver_legs l
  where l.active
    and (extract(isodow from p_date)::int - 1) = any (l.days)
    and exists (select 1 from club_members m where m.leg_id = l.id and m.active and not m.paused and m.start_date <= p_date)
    and not exists (select 1 from schedule_exceptions e
                    where e.user_id = l.driver_id and (e.leg_id is null or e.leg_id = l.id)
                      and (e.date = p_date or e.kind = 'pause'))
  on conflict (leg_id, service_date) do nothing;
  get diagnostics n = row_count;

  insert into instance_riders (instance_id, passenger_id, status)
  select i.id, m.passenger_id,
         case when exists (select 1 from schedule_exceptions e
                           where e.user_id = m.passenger_id and (e.leg_id is null or e.leg_id = i.leg_id)
                             and (e.date = p_date or e.kind = 'pause'))
                   or exists (select 1 from join_requests r join passenger_commutes pc on pc.id = r.commute_id
                              where r.id = m.request_id and not commute_booked_on(pc, p_date))
              then 'absent'::rider_status else 'expected'::rider_status end
  from commute_instances i
  join club_members m on m.leg_id = i.leg_id and m.active and not m.paused and m.start_date <= p_date
  where i.service_date = p_date
  on conflict do nothing;
  return n;
end $$;

create or replace function public.list_incoming_requests()
returns setof jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', r.id,
    'status', case r.status when 'accepted' then 'accepted' when 'pending' then 'pending' else 'declined' end,
    'passenger', jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                                    'avatarPath', p.avatar_path, 'rating', p.rating, 'ratingCount', p.rating_count,
                                    'reliability', p.reliability, 'verified', coalesce(p.identity_status = 'verified', false)),
    'pickup', jsonb_build_object('label', r.pickup_label, 'lng', st_x(r.pickup::geometry), 'lat', st_y(r.pickup::geometry)),
    'destination', jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
    'walkingFlexibilityM', c.max_walk_m,
    'days', to_jsonb(c.days),
    'specificDates', to_jsonb(coalesce(c.specific_dates, '{}'::date[])),
    'startDate', r.start_date,
    'arriveBy', to_char(c.arrive_by, 'HH24:MI'),
    'routeOverlap', r.route_overlap,
    'currentCommuteMinutes', round(l.route_duration_s / 60.0),
    'deviationMinutes', r.deviation_min,
    'additionalDistanceKm', round((r.deviation_min * 0.5)::numeric, 1),
    'monthlyContribution', r.monthly_contribution,
    'geometry', jsonb_build_object(
      'path', st_asgeojson(l.route::geometry, 6)::jsonb,
      'deviation', st_asgeojson(st_makeline(array[
          st_lineinterpolatepoint(l.route::geometry, greatest(0, st_linelocatepoint(l.route::geometry, r.pickup::geometry) - 300.0 / l.route_distance_m)),
          r.pickup::geometry,
          st_lineinterpolatepoint(l.route::geometry, least(1, st_linelocatepoint(l.route::geometry, r.pickup::geometry) + 300.0 / l.route_distance_m))]), 6)::jsonb,
      'walking', '{"type":"LineString","coordinates":[]}'::jsonb)
  )
  from join_requests r
  join driver_legs l on l.id = r.leg_id and l.driver_id = auth.uid()
  join profiles p on p.id = r.passenger_id
  join passenger_commutes c on c.id = r.commute_id
  where r.status <> 'cancelled'
  order by r.created_at desc;
$$;

revoke execute on function public.per_day_contribution(int, int) from public, anon;
revoke execute on function public.commute_booked_on(public.passenger_commutes, date) from public, anon;
grant execute on function public.per_day_contribution(int, int), public.commute_booked_on(public.passenger_commutes, date) to authenticated;
revoke execute on function public.generate_commute_instances(date) from public, anon, authenticated;
