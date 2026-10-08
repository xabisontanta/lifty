-- RPCs. Every write that affects another person goes through a function that re-validates it.

-- ---------- internal: notifications ----------
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;

-- ---------- cost-sharing: lift clubs share running costs, they are not a fare business ----------
-- ~7.5 L/100 km × ~R25/L fuel + wear ≈ R2.50/km per trip; split between driver and seats.
create or replace function public.suggested_contribution(p_distance_m int, p_days int, p_seats int)
returns int language sql immutable set search_path = '' as $$
  select (round(((p_distance_m / 1000.0) * 2.5 * greatest(p_days, 1) * 4.33) / greatest(p_seats + 1, 2) / 10) * 10)::int;
$$;

create or replace function public.contribution_cap(p_distance_m int, p_days int, p_seats int)
returns int language sql immutable set search_path = '' as $$
  select (ceil(public.suggested_contribution(p_distance_m, p_days, p_seats) * 1.5 / 10) * 10)::int;
$$;

-- ---------- driver publishes the commute they already make ----------
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

-- ---------- matching (PostGIS) ----------
-- Ranks by commute compatibility (overlap, walk, deviation, schedule) — never by "nearest driver".
-- Routes are trimmed so the driver's home is never revealed.
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

-- ---------- requests ----------
create or replace function public.request_to_join(p_commute uuid, p_leg uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  m jsonb;
  v_id uuid;
  v_driver uuid;
begin
  m := get_match(p_commute, p_leg);
  if m is null then
    raise exception 'This lift club is no longer a match for your commute';
  end if;
  insert into join_requests (passenger_id, leg_id, commute_id, pickup_label, pickup, walking_m, walking_min,
                             deviation_min, route_overlap, pickup_time, monthly_contribution)
  values (auth.uid(), p_leg, p_commute, m -> 'pickup' ->> 'label',
          st_setsrid(st_makepoint((m -> 'pickup' ->> 'lng')::float8, (m -> 'pickup' ->> 'lat')::float8), 4326)::geography,
          (m ->> 'walkingDistanceM')::int, (m ->> 'walkingMinutes')::int, (m ->> 'driverDeviationMinutes')::int,
          (m ->> 'routeOverlap')::int, (m ->> 'pickupEta')::time, (m ->> 'monthlyContribution')::int)
  returning id into v_id;
  select driver_id into v_driver from driver_legs where id = p_leg;
  perform notify(v_driver, 'request', 'New lift club request',
                 (select first_name from profiles where id = auth.uid()) || ' would like to join your commute.', '/d/request/' || v_id);
  return v_id;
end $$;

create or replace function public.cancel_join_request(p_request uuid)
returns void language sql security definer set search_path = public as $$
  update join_requests set status = 'cancelled', responded_at = now()
  where id = p_request and passenger_id = auth.uid() and status = 'pending';
$$;

create or replace function public.respond_to_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r join_requests;
  l driver_legs;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request is no longer open';
  end if;
  select * into l from driver_legs where id = r.leg_id for update;
  if l.driver_id <> auth.uid() then
    raise exception 'Not your lift club';
  end if;

  if p_accept then
    if l.seats_open <= 0 then
      raise exception 'You have no open seats';
    end if;
    insert into club_members (leg_id, passenger_id, request_id, pickup_label, pickup, pickup_time, monthly_contribution, start_date)
    values (r.leg_id, r.passenger_id, r.id, r.pickup_label, r.pickup, r.pickup_time, r.monthly_contribution, r.start_date)
    on conflict (leg_id, passenger_id) do update set active = true, paused = false, pickup_label = excluded.pickup_label,
      pickup = excluded.pickup, pickup_time = excluded.pickup_time, monthly_contribution = excluded.monthly_contribution;
    update driver_legs set seats_open = seats_open - 1 where id = l.id;
    insert into contributions (leg_id, passenger_id, period, amount, status)
    values (l.id, r.passenger_id, date_trunc('month', r.start_date)::date, r.monthly_contribution, 'upcoming')
    on conflict do nothing;
    update join_requests set status = 'accepted', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'accepted', 'You’re in!',
                   (select first_name from profiles where id = l.driver_id) || ' accepted your request to join the lift club.', '/p/accepted');
  else
    update join_requests set status = 'declined', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'declined', 'Not a fit this time',
                   'That lift club can’t take you right now. We’ll keep looking for other matches.', '/p/find');
  end if;
end $$;

create or replace function public.remove_member(p_leg uuid, p_passenger uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_leg_driver(p_leg) then
    raise exception 'Not your lift club';
  end if;
  update club_members set active = false where leg_id = p_leg and passenger_id = p_passenger and active;
  if found then
    update driver_legs set seats_open = seats_open + 1 where id = p_leg;
    perform notify(p_passenger, 'removed', 'Lift club update', 'Your driver has ended this arrangement.', '/p/find');
  end if;
end $$;

-- incoming requests for the driver: pickup + deviation only (never the passenger's home)
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

-- ---------- clubs overview for the signed-in user ----------
create or replace function public.get_my_clubs()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'asPassenger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'paused', m.paused, 'startDate', m.start_date,
        'pickup', jsonb_build_object('label', m.pickup_label, 'lng', st_x(m.pickup::geometry), 'lat', st_y(m.pickup::geometry)),
        'pickupTime', to_char(m.pickup_time, 'HH24:MI'),
        'destination', jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry)),
        'days', to_jsonb(l.days), 'monthlyContribution', m.monthly_contribution,
        'paymentStatus', coalesce((select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = m.passenger_id order by ct.period desc limit 1), 'upcoming'),
        'driver', jsonb_build_object('id', dp.id, 'firstName', dp.first_name, 'lastInitial', dp.last_initial, 'avatarPath', dp.avatar_path,
                                     'rating', dp.rating, 'ratingCount', dp.rating_count, 'identityStatus', coalesce(dp.identity_status::text, 'pending')),
        'vehicle', jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
                                      'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path),
        'seatsTaken', (select count(*) from club_members x where x.leg_id = l.id and x.active),
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial, 'avatarPath', xp.avatar_path))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from club_members m
      join driver_legs l on l.id = m.leg_id
      join profiles dp on dp.id = l.driver_id
      join vehicles v on v.driver_id = l.driver_id
      where m.passenger_id = auth.uid() and m.active), '[]'::jsonb),
    'asDriver', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'originLabel', l.origin_label, 'destinationLabel', l.destination_label,
        'departureTime', to_char(l.departure_time, 'HH24:MI'), 'days', to_jsonb(l.days), 'seatsOpen', l.seats_open,
        'maxDeviationMin', l.max_deviation_min, 'monthlyContribution', l.monthly_contribution,
        'routeDistanceM', l.route_distance_m, 'routeDurationS', l.route_duration_s,
        'route', st_asgeojson(l.route::geometry, 6)::jsonb,
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial,
                                                        'avatarPath', xp.avatar_path, 'pickupLabel', x.pickup_label,
                                                        'pickupTime', to_char(x.pickup_time, 'HH24:MI'),
                                                        'paymentStatus', (select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = x.passenger_id order by ct.period desc limit 1)))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from driver_legs l where l.driver_id = auth.uid()), '[]'::jsonb)
  );
$$;

-- ---------- daily commute instances ----------
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
              then 'absent'::rider_status else 'expected'::rider_status end
  from commute_instances i
  join club_members m on m.leg_id = i.leg_id and m.active and not m.paused and m.start_date <= p_date
  where i.service_date = p_date
  on conflict do nothing;
  return n;
end $$;

-- The instance the signed-in user should see right now (today's next/ongoing commute).
create or replace function public.get_current_instance()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  i commute_instances;
  l driver_legs;
  v_me uuid := auth.uid();
begin
  perform generate_commute_instances(v_today);
  select ci.* into i from commute_instances ci
  join driver_legs dl on dl.id = ci.leg_id
  where ci.service_date = v_today
    and ci.status not in ('completed', 'cancelled')
    and (dl.driver_id = v_me or exists (select 1 from instance_riders r where r.instance_id = ci.id and r.passenger_id = v_me))
  order by ci.departs_at
  limit 1;
  if not found then
    return null;
  end if;
  select * into l from driver_legs where id = i.leg_id;
  return jsonb_build_object(
    'id', i.id, 'legId', l.id, 'status', i.status, 'serviceDate', i.service_date,
    'departsAt', i.departs_at, 'sharingStartsAt', i.sharing_starts_at, 'sharingEndsAt', i.sharing_ends_at,
    'driverArrivedAt', i.driver_arrived_at, 'isDriver', l.driver_id = v_me,
    'destination', jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry)),
    'route', case when l.driver_id = v_me then st_asgeojson(l.route::geometry, 6)::jsonb
                  else st_asgeojson(st_linesubstring(l.route::geometry,
                         greatest(0, (select min(st_linelocatepoint(l.route::geometry, m.pickup::geometry)) from club_members m where m.leg_id = l.id and m.active) - 2500.0 / l.route_distance_m), 1), 6)::jsonb end,
    'routeDurationS', l.route_duration_s,
    'riders', (select jsonb_agg(jsonb_build_object(
                 'passengerId', r.passenger_id, 'status', r.status, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                 'avatarPath', p.avatar_path,
                 'pickup', jsonb_build_object('label', m.pickup_label, 'lng', st_x(m.pickup::geometry), 'lat', st_y(m.pickup::geometry)),
                 'pickupTime', to_char(m.pickup_time, 'HH24:MI')))
               from instance_riders r join profiles p on p.id = r.passenger_id
               join club_members m on m.leg_id = l.id and m.passenger_id = r.passenger_id
               where r.instance_id = i.id
                 and (l.driver_id = v_me or r.passenger_id = v_me)),
    'driver', (select jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
                                         'rating', p.rating, 'ratingCount', p.rating_count)
               from profiles p where p.id = l.driver_id),
    'vehicle', (select jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'bodyType', v.body_type,
                                          'registrationSummary', v.registration_summary, 'photoPath', v.photo_path)
                from vehicles v where v.driver_id = l.driver_id)
  );
end $$;

-- ---------- explicit pickup state (never GPS inference alone) ----------
create or replace function public.mark_driver_arrived(p_instance uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_leg uuid;
begin
  select leg_id into v_leg from commute_instances where id = p_instance;
  if not is_leg_driver(v_leg) then raise exception 'Only the driver can do this'; end if;
  update commute_instances set driver_arrived_at = coalesce(driver_arrived_at, now()), status = 'sharing' where id = p_instance;
  perform notify(r.passenger_id, 'arrived', 'Your driver has arrived', 'They’ll wait 3 minutes at the pickup point.', '/p/track')
  from instance_riders r where r.instance_id = p_instance and r.status in ('expected', 'at_pickup');
end $$;

create or replace function public.mark_rider_status(p_instance uuid, p_passenger uuid, p_status public.rider_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  i commute_instances;
  is_driver boolean;
begin
  select * into i from commute_instances where id = p_instance;
  is_driver := is_leg_driver(i.leg_id);
  if not (is_driver or p_passenger = auth.uid()) then raise exception 'Not allowed'; end if;
  if p_status = 'no_show' then
    if not is_driver then raise exception 'Only the driver can mark a no-show'; end if;
    if i.driver_arrived_at is null or i.driver_arrived_at > now() - interval '3 minutes' then
      raise exception 'Please wait the full 3-minute grace period first';
    end if;
  end if;
  if p_status not in ('at_pickup', 'collected', 'no_show', 'absent') then raise exception 'Unsupported status'; end if;

  update instance_riders
     set status = p_status,
         at_pickup_at = case when p_status = 'at_pickup' then now() else at_pickup_at end,
         collected_at = case when p_status = 'collected' then now() else collected_at end
   where instance_id = p_instance and passenger_id = p_passenger;

  -- commute is underway once nobody is still expected at a pickup
  if not exists (select 1 from instance_riders r where r.instance_id = p_instance and r.status in ('expected', 'at_pickup'))
     and exists (select 1 from instance_riders r where r.instance_id = p_instance and r.status = 'collected') then
    update commute_instances set status = 'underway', started_at = coalesce(started_at, now()) where id = p_instance;
  end if;

  if p_status = 'no_show' then
    update profiles p set reliability = (
      select greatest(0, round(100.0 * count(*) filter (where r.status in ('collected', 'dropped_off')) / nullif(count(*) filter (where r.status in ('collected', 'dropped_off', 'no_show')), 0)))::int
      from instance_riders r join commute_instances ci on ci.id = r.instance_id
      where r.passenger_id = p_passenger and ci.service_date > current_date - 60)
    where p.id = p_passenger;
    perform notify(p_passenger, 'no_show', 'Marked as no-show', 'Your driver waited 3 minutes and continued. Let them know next time if you can’t make it.', '/p/commute');
  end if;
end $$;

create or replace function public.complete_instance(p_instance uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_leg uuid;
  v_driver uuid;
begin
  select ci.leg_id, l.driver_id into v_leg, v_driver from commute_instances ci join driver_legs l on l.id = ci.leg_id where ci.id = p_instance;
  if v_driver <> auth.uid() then raise exception 'Only the driver can complete the commute'; end if;
  update commute_instances set status = 'completed', completed_at = now() where id = p_instance and status <> 'completed';
  update instance_riders set status = 'dropped_off' where instance_id = p_instance and status = 'collected';
  perform notify(r.passenger_id, 'completed', 'Commute completed', 'How was your commute? Rate your driver to build community trust.', '/p/rate')
  from instance_riders r where r.instance_id = p_instance and r.status = 'dropped_off';
end $$;

-- Breadcrumb for the safety record (live position itself goes over Realtime broadcast).
create or replace function public.record_location(p_instance uuid, p_lng float8, p_lat float8, p_heading real default null, p_speed real default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not can_track(p_instance) then return; end if;
  if exists (select 1 from location_pings where instance_id = p_instance and user_id = auth.uid() and recorded_at > now() - interval '25 seconds') then
    return;
  end if;
  insert into location_pings (instance_id, user_id, location, heading, speed)
  values (p_instance, auth.uid(), st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_heading, p_speed);
end $$;

-- ---------- ratings keep profile aggregates fresh ----------
create or replace function public.on_rating_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles p set rating = s.avg_stars, rating_count = s.n
  from (select round(avg(stars)::numeric, 1) as avg_stars, count(*)::int as n from ratings where ratee_id = new.ratee_id) s
  where p.id = new.ratee_id;
  return new;
end $$;
create trigger ratings_aggregate after insert on public.ratings for each row execute function public.on_rating_insert();

-- ---------- contributions (tracked, not processed, in v1) ----------
create or replace function public.mark_contribution_paid(p_leg uuid, p_passenger uuid, p_period date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_leg_driver(p_leg) or p_passenger = auth.uid()) then raise exception 'Not allowed'; end if;
  update contributions set status = 'paid', paid_at = now()
  where leg_id = p_leg and passenger_id = p_passenger and period = date_trunc('month', p_period)::date;
end $$;

-- ---------- admin: verification + reports ----------
create or replace function public.review_document(p_doc uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update verification_documents
     set status = case when p_approve then 'verified'::verification_status else 'rejected'::verification_status end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_doc
  returning user_id into v_user;

  if not p_approve then
    update profiles set identity_status = 'rejected' where id = v_user;
    perform notify(v_user, 'verification', 'Document needs attention', coalesce(p_note, 'Please re-upload a clearer copy.'), '/onboarding/driver/3');
    return;
  end if;

  if (select count(distinct kind) from verification_documents
      where user_id = v_user and status = 'verified' and kind in ('id', 'licence', 'vehicle_registration', 'insurance')) = 4 then
    update profiles set identity_status = 'verified' where id = v_user;
    update vehicles set status = 'verified' where driver_id = v_user;
    perform notify(v_user, 'verification', 'You’re verified', 'Passengers will now see your Verified Driver badge.', '/d/home');
  end if;
end $$;

create or replace function public.admin_update_report(p_report uuid, p_status public.report_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update reports set status = p_status, handled_by = auth.uid(), handled_at = now() where id = p_report;
end $$;

-- ---------- POPIA: access + erasure + retention ----------
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from profiles p where p.id = auth.uid()),
    'private', (select to_jsonb(x) from profile_private x where x.id = auth.uid()),
    'vehicle', (select to_jsonb(v) - 'id' from vehicles v where v.driver_id = auth.uid()),
    'commutes', (select jsonb_agg(jsonb_build_object('direction', c.direction, 'origin', c.origin_label, 'destination', c.destination_label,
                                                     'days', c.days, 'arriveBy', c.arrive_by, 'maxWalkM', c.max_walk_m))
                 from passenger_commutes c where c.passenger_id = auth.uid()),
    'driverLegs', (select jsonb_agg(jsonb_build_object('direction', l.direction, 'origin', l.origin_label, 'destination', l.destination_label,
                                                       'departure', l.departure_time, 'days', l.days))
                   from driver_legs l where l.driver_id = auth.uid()),
    'requests', (select jsonb_agg(to_jsonb(r) - 'pickup') from join_requests r where r.passenger_id = auth.uid()),
    'ratingsGiven', (select jsonb_agg(to_jsonb(r)) from ratings r where r.rater_id = auth.uid()),
    'messagesSent', (select jsonb_agg(jsonb_build_object('at', m.created_at, 'body', m.body)) from messages m where m.sender_id = auth.uid()),
    'locationPings', (select count(*) from location_pings lp where lp.user_id = auth.uid()),
    'exportedAt', now()
  );
$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  update driver_legs set seats_open = seats_open + 1
  where id in (select leg_id from club_members where passenger_id = auth.uid() and active);
  delete from auth.users where id = auth.uid();
end $$;

create or replace function public.purge_location_pings()
returns void language sql security definer set search_path = public as $$
  delete from location_pings where recorded_at < now() - interval '30 days';
$$;

-- ---------- execute privileges ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, text, text, text, text) from authenticated;
revoke execute on function public.generate_commute_instances(date) from authenticated;
revoke execute on function public.purge_location_pings() from authenticated;
revoke execute on function public.on_rating_insert() from authenticated;

-- ---------- schedules ----------
select cron.schedule('lifty-generate-instances', '5 22 * * *',
  $$select public.generate_commute_instances(((now() at time zone 'Africa/Johannesburg')::date + 1))$$);
select cron.schedule('lifty-purge-location', '30 1 * * *', $$select public.purge_location_pings()$$);
