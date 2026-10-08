CREATE OR REPLACE FUNCTION public.find_matches(p_commute uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    where public.account_active() and public.driver_approved(l.driver_id) and l.active and l.direction = c.direction and l.seats_open > 0 and l.driver_id <> c.passenger_id
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
      'identityStatus', coalesce(p.identity_status::text, 'pending'), 'verification', public.driver_verification(p.id)),
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
    'days', to_jsonb(array(select unnest(o.leg_days) intersect select unnest(c.days))),
    'coveredDays', to_jsonb(array(select unnest(o.leg_days) intersect select unnest(c.days))),
    'uncoveredDays', to_jsonb(array(select unnest(c.days) except select unnest(o.leg_days))),
    'coveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
    'uncoveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where not (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
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
end $function$;

CREATE OR REPLACE FUNCTION public.request_to_join(p_commute uuid, p_leg uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  m jsonb;
  c passenger_commutes;
  v_id uuid;
  v_driver uuid;
  v_start date;
begin
  if not public.account_active() or not public.driver_approved((select driver_id from public.driver_legs where id=p_leg)) then raise exception 'An approved driver is required'; end if;
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
  update public.join_requests set match_snapshot=m,agreement=jsonb_build_object(
      'scheduleMode',case when c.specific_dates is null then 'weekly' else 'dates' end,
      'days',m->'coveredDays','dates',coalesce(m->'coveredDates','[]'::jsonb),
      'startDate',coalesce(v_start,(now() at time zone 'Africa/Johannesburg')::date+1),'endDate',c.end_date,
      'skipHolidays',c.skip_holidays,'monthlyContribution',(m->>'monthlyContribution')::int,
      'perDayContribution',(m->>'perDayContribution')::int) where id=v_id;
  select driver_id into v_driver from driver_legs where id = p_leg;
  perform notify(v_driver, 'request', 'New lift club request',
                 (select first_name from profiles where id = auth.uid()) || ' would like to join your commute.', '/d/request/' || v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.respond_to_request(p_request uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r join_requests;
  l driver_legs;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request is no longer open';
  end if;
  select * into l from driver_legs where id = r.leg_id for update;
  if l.driver_id is distinct from auth.uid() or not public.account_active() then
    raise exception 'Not your lift club';
  end if;

  if p_accept then
    if not public.driver_approved(l.driver_id) then raise exception 'All four current documents must be approved'; end if;
    if not exists(select 1 from public.profiles where id=r.passenger_id and suspended_at is null) then raise exception 'Passenger is suspended'; end if;
    if exists(select 1 from public.club_members where leg_id=l.id and passenger_id=r.passenger_id and active) then raise exception 'Passenger already belongs to this club'; end if;
    if l.seats_open <= 0 then
      raise exception 'You have no open seats';
    end if;
    insert into club_members (leg_id, passenger_id, request_id, pickup_label, pickup, pickup_time, monthly_contribution, start_date)
    values (r.leg_id, r.passenger_id, r.id, r.pickup_label, r.pickup, r.pickup_time, r.monthly_contribution, r.start_date)
    on conflict (leg_id, passenger_id) do update set active = true, paused = false, pickup_label = excluded.pickup_label,
      pickup = excluded.pickup, pickup_time = excluded.pickup_time, monthly_contribution = excluded.monthly_contribution;
    update public.club_members set agreement=r.agreement,match_snapshot=r.match_snapshot,start_date=r.start_date,request_id=r.id where leg_id=l.id and passenger_id=r.passenger_id;
    update driver_legs set seats_open = seats_open - 1 where id = l.id;
    insert into contributions (leg_id, passenger_id, period, amount, status)
    values (l.id, r.passenger_id, date_trunc('month', r.start_date)::date, r.monthly_contribution, 'upcoming')
    on conflict do nothing;
    perform public.generate_contributions();
    perform public.reconcile_commutes();
    update join_requests set status = 'accepted', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'accepted', 'You’re in!',
                   (select first_name from profiles where id = l.driver_id) || ' accepted your request to join the lift club.', '/p/accepted');
  else
    update join_requests set status = 'declined', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'declined', 'Not a fit this time',
                   'That lift club can’t take you right now. We’ll keep looking for other matches.', '/p/find');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_clubs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'asPassenger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'paused', m.paused, 'startDate', m.start_date,
        'pickup', jsonb_build_object('label', m.pickup_label, 'lng', st_x(m.pickup::geometry), 'lat', st_y(m.pickup::geometry)),
        'pickupTime', to_char(m.pickup_time, 'HH24:MI'),
        'destination', coalesce(m.match_snapshot->'destination',jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry))),
        'days', coalesce(m.agreement->'days',to_jsonb(l.days)), 'schedule',m.agreement,'monthlyContribution', m.monthly_contribution,
        'paymentStatus', coalesce((select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = m.passenger_id order by ct.period desc limit 1), 'upcoming'),
        'driver', jsonb_build_object('id', dp.id, 'firstName', dp.first_name, 'lastInitial', dp.last_initial, 'avatarPath', dp.avatar_path,
                                     'rating', dp.rating, 'ratingCount', dp.rating_count, 'identityStatus', coalesce(dp.identity_status::text, 'pending'),'verification',public.driver_verification(dp.id)),
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
$function$;
