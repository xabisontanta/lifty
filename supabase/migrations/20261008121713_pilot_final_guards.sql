-- Close stale-request, suspended-peer, delivery-status, and export gaps.

CREATE OR REPLACE FUNCTION public.can_track(p_instance uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=p_instance and w.user_id=auth.uid()) and public.account_active() and exists(select 1 from public.profile_private where id=auth.uid() and location_consent_at is not null)
 and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where i.id=p_instance and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and l.active and exists(select 1 from public.profiles dp where dp.id=l.driver_id and dp.suspended_at is null)
 and (l.driver_id=auth.uid() or exists(select 1 from public.instance_riders r join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id where r.instance_id=i.id and r.passenger_id=auth.uid() and r.status in('expected','at_pickup') and m.active and not m.paused)));
$function$;

CREATE OR REPLACE FUNCTION public.can_receive_location(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare instance uuid; passenger uuid;
begin
 if p_topic !~ '^commute:[0-9a-f-]{36}:[0-9a-f-]{36}$' or not public.account_active() then return false; end if;
 instance:=split_part(p_topic,':',2)::uuid; passenger:=split_part(p_topic,':',3)::uuid;
 return exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.instance_riders r on r.instance_id=i.id
 join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id
 where exists(select 1 from public.profiles dp where dp.id=l.driver_id and dp.suspended_at is null) and exists(select 1 from public.profiles pp where pp.id=passenger and pp.suspended_at is null) and i.id=instance and r.passenger_id=passenger and m.active and not m.paused and r.status in('expected','at_pickup','collected')
 and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and (l.driver_id=auth.uid() or passenger=auth.uid()));
exception when invalid_text_representation then return false;
end $function$;

CREATE OR REPLACE FUNCTION public.find_matches(p_commute uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c passenger_commutes;
  v_dated boolean;
  today date:=(now() at time zone 'Africa/Johannesburg')::date;
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
      and exists(select 1 from generate_series(greatest(today+1,c.start_date)::timestamp,
          least(coalesce(c.end_date,greatest(today+1,c.start_date)+370),greatest(today+1,c.start_date)+370)::timestamp,interval '1 day') d
          where public.commute_booked_on(c,d::date) and (extract(isodow from d)::int-1)=any(l.days))
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
             where d > today and public.commute_booked_on(c,d) and (extract(isodow from d)::int - 1) = any (l.days)
               and date_trunc('month', d) = date_trunc('month', (select min(x) from unnest(c.specific_dates) x where x > today and public.commute_booked_on(c,x))))::int as booked_days
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
    'coveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where d > today and (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
    'uncoveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where d > today and not (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
    'availableSeats', o.seats_open,
    'pricing', case when v_dated then 'per_day' else 'monthly' end,
    'perDayContribution', o.per_day,
    'bookedDays', o.booked_days,
    'monthlyContribution', case when v_dated then o.per_day * o.booked_days else round(o.monthly_contribution*o.shared_days::numeric/greatest(cardinality(o.leg_days),1))::int end,
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
  l driver_legs;
  today date:=(now() at time zone 'Africa/Johannesburg')::date;
begin
  select * into l from public.driver_legs where id=p_leg for share;
  if l.id is null then raise exception 'Lift club not found';end if;
  if not public.account_active() or not public.driver_approved((select driver_id from public.driver_legs where id=p_leg)) then raise exception 'An approved driver is required'; end if;
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  m := get_match(p_commute, p_leg);
  if m is null or c.id is null then
    raise exception 'This lift club is no longer a match for your commute';
  end if;
  v_start := greatest(today + 1,
                      case when c.specific_dates is not null and cardinality(c.specific_dates) > 0
                           then (select min(d) from unnest(c.specific_dates) d where d > today)
                           else c.start_date end);
  -- Re-submission replaces only this passenger's own pending offer.
  update public.join_requests set status='cancelled',responded_at=now() where passenger_id=auth.uid() and leg_id=p_leg and status='pending';
  insert into join_requests (passenger_id, leg_id, commute_id, pickup_label, pickup, walking_m, walking_min,
                             deviation_min, route_overlap, pickup_time, monthly_contribution, start_date)
  values (auth.uid(), p_leg, p_commute, m -> 'pickup' ->> 'label',
          st_setsrid(st_makepoint((m -> 'pickup' ->> 'lng')::float8, (m -> 'pickup' ->> 'lat')::float8), 4326)::geography,
          (m ->> 'walkingDistanceM')::int, (m ->> 'walkingMinutes')::int, (m ->> 'driverDeviationMinutes')::int,
          (m ->> 'routeOverlap')::int, (m ->> 'pickupEta')::time, (m ->> 'monthlyContribution')::int, coalesce(v_start, today + 1))
  returning id into v_id;
  update public.join_requests set match_snapshot=m,agreement=jsonb_build_object(
      'routeSignature',md5(l.route::text||l.departure_time::text||l.days::text||l.direction::text),
      'destination',m->'destination','maxWalkMeters',c.max_walk_m,'arriveBy',to_char(c.arrive_by,'HH24:MI'),
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
    if r.agreement->>'routeSignature' is distinct from md5(l.route::text||l.departure_time::text||l.days::text||l.direction::text)
       then raise exception 'This offer needs to be refreshed. Ask the passenger to submit a new request.';end if;
    if not l.active or (r.agreement->>'endDate' is not null and (r.agreement->>'endDate')::date<(now() at time zone 'Africa/Johannesburg')::date)
       then raise exception 'The agreed schedule is no longer available';end if;
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

CREATE OR REPLACE FUNCTION public.list_incoming_requests()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'id', r.id,
    'status', case r.status when 'accepted' then 'accepted' when 'pending' then 'pending' else 'declined' end,
    'passenger', jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                                    'avatarPath', p.avatar_path, 'rating', p.rating, 'ratingCount', p.rating_count,
                                    'reliability', p.reliability, 'verified', coalesce(p.identity_status = 'verified', false)),
    'pickup', jsonb_build_object('label', r.pickup_label, 'lng', st_x(r.pickup::geometry), 'lat', st_y(r.pickup::geometry)),
    'destination', coalesce(r.agreement->'destination',r.match_snapshot->'destination',jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry))),
    'walkingFlexibilityM', coalesce((r.agreement->>'maxWalkMeters')::int,c.max_walk_m),
    'days', coalesce(r.agreement->'days',to_jsonb(c.days)),
    'specificDates', coalesce(r.agreement->'dates',to_jsonb(coalesce(c.specific_dates, '{}'::date[]))),
    'startDate', r.start_date,
    'arriveBy', coalesce(r.agreement->>'arriveBy',to_char(c.arrive_by, 'HH24:MI')),
    'routeOverlap', r.route_overlap,
    'currentCommuteMinutes', round(l.route_duration_s / 60.0),
    'deviationMinutes', r.deviation_min,
    'additionalDistanceKm', round((r.deviation_min * 0.5)::numeric, 1),
    'monthlyContribution', r.monthly_contribution,
    'geometry', coalesce(r.match_snapshot->'geometry',jsonb_build_object(
      'path', st_asgeojson(l.route::geometry, 6)::jsonb,
      'deviation', st_asgeojson(st_makeline(array[
          st_lineinterpolatepoint(l.route::geometry, greatest(0, st_linelocatepoint(l.route::geometry, r.pickup::geometry) - 300.0 / l.route_distance_m)),
          r.pickup::geometry,
          st_lineinterpolatepoint(l.route::geometry, least(1, st_linelocatepoint(l.route::geometry, r.pickup::geometry) + 300.0 / l.route_distance_m))]), 6)::jsonb,
      'walking', '{"type":"LineString","coordinates":[]}'::jsonb))
  )
  from join_requests r
  join driver_legs l on l.id = r.leg_id and l.driver_id = auth.uid()
  join profiles p on p.id = r.passenger_id
  join passenger_commutes c on c.id = r.commute_id
  where public.account_active() and r.status <> 'cancelled'
  order by r.created_at desc;
$function$;

-- Existing pending records are preserved; pre-snapshot offers require fresh submission.
create or replace function lifty_private.protect_agreed_route() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.route,new.departure_time,new.days,new.direction,new.origin,new.destination) is distinct from
    (old.route,old.departure_time,old.days,old.direction,old.origin,old.destination)
    and exists(select 1 from public.club_members where leg_id=old.id and active)
 then raise exception 'This route has active agreements. Resolve those clubs before changing its route or schedule.';end if;
 return new;
end $$;
create trigger protect_agreed_route before update on public.driver_legs for each row execute function lifty_private.protect_agreed_route();
revoke all on function lifty_private.protect_agreed_route() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finish_pilot_work(p_kind text, p_id uuid, p_lease uuid, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare delivered boolean;
begin
 if p_kind='push' then
  delivered:=exists(select 1 from lifty_private.push_receipts where notification_id=p_id);
  update lifty_private.notification_outbox set status=case when p_error is null and delivered then 'sent' when p_error is null then 'no_device' when attempts>=6 then 'failed' else 'pending' end,delivered_at=case when p_error is null and delivered then now() else null end,last_error=case when p_error is null and not delivered then 'No valid Android push destination' else left(p_error,300) end,lease=null,leased_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::int)) where id=p_id and lease=p_lease and leased_until>now();
 else update lifty_private.cleanup_jobs set status=case when attempts>=10 then 'failed' else 'pending' end,last_error=left(p_error,300),lease=null,leased_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::int)) where id=p_id and lease=p_lease and leased_until>now(); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_rider_status(p_instance uuid, p_passenger uuid, p_status rider_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.commute_instances; r public.instance_riders; driver boolean;
begin
 select * into i from public.commute_instances where id=p_instance for update;
 select * into r from public.instance_riders where instance_id=p_instance and passenger_id=p_passenger for update;
 driver:=public.is_leg_driver(i.leg_id);
 if not public.account_active() or i.id is null or r.passenger_id is null or i.status not in('scheduled','sharing','underway') or now() not between i.sharing_starts_at and i.sharing_ends_at or not exists(select 1 from public.club_members where leg_id=i.leg_id and passenger_id=p_passenger and active and not paused) then raise exception 'Rider or trip is unavailable'; end if;
 if not(driver or p_passenger=auth.uid()) then raise exception 'Not allowed'; end if;
 if p_status not in('at_pickup','collected','no_show','absent') then raise exception 'Unsupported status'; end if;
 if r.status not in('expected','at_pickup') then raise exception 'Rider pickup is already resolved'; end if;
 if p_status in('collected','no_show') and not driver then raise exception 'Only the driver can collect or mark no-show'; end if;
 if p_status='no_show' and (r.driver_arrived_at is null or r.driver_arrived_at>now()-interval '3 minutes') then raise exception 'Wait the full three-minute grace period for this passenger'; end if;
 update public.instance_riders set status=p_status,at_pickup_at=case when p_status='at_pickup' then now() else at_pickup_at end,collected_at=case when p_status='collected' then now() else collected_at end,no_show_at=case when p_status='no_show' then now() else no_show_at end where instance_id=p_instance and passenger_id=p_passenger;
 if p_status in('collected','no_show') then
  update public.profiles p set reliability=coalesce((select round(100.0*count(*) filter(where x.status in('collected','dropped_off'))/nullif(count(*) filter(where x.status in('collected','dropped_off','no_show')),0))::int
   from public.instance_riders x join public.commute_instances ci on ci.id=x.instance_id where x.passenger_id=p_passenger and ci.service_date>(now() at time zone 'Africa/Johannesburg')::date-60),100) where p.id=p_passenger;
 end if;
 if p_status='no_show' then perform public.notify(p_passenger,'no_show','Pickup missed','Your driver waited three minutes at your pickup.','/p/commute'); end if;
 if not exists(select 1 from public.instance_riders where instance_id=p_instance and status in('expected','at_pickup')) and exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then update public.commute_instances set status='underway',started_at=coalesce(started_at,now()) where id=p_instance; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_commute_instances(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at)
 select l.id,p_date,(p_date+l.departure_time) at time zone 'Africa/Johannesburg',
 ((p_date+l.departure_time) at time zone 'Africa/Johannesburg')-interval '20 minutes',
 ((p_date+l.departure_time) at time zone 'Africa/Johannesburg')+make_interval(secs=>l.route_duration_s)+interval '60 minutes'
 from public.driver_legs l join public.profiles p on p.id=l.driver_id
 where l.active and p.suspended_at is null and (extract(isodow from p_date)::int-1)=any(l.days)
 and exists(select 1 from public.club_members m join public.profiles q on q.id=m.passenger_id where m.leg_id=l.id and m.active and not m.paused and q.suspended_at is null and lifty_private.agreed_on(m.agreement,p_date))
 and not exists(select 1 from public.schedule_exceptions e where e.user_id=l.driver_id and (e.leg_id is null or e.leg_id=l.id) and e.kind<>'pickup-change' and (e.date=p_date or (e.kind='pause' and e.date is null)))
 on conflict(leg_id,service_date) do update set departs_at=excluded.departs_at,sharing_starts_at=excluded.sharing_starts_at,sharing_ends_at=excluded.sharing_ends_at,
 status=case when public.commute_instances.status='cancelled' then 'scheduled'::public.instance_status else public.commute_instances.status end
 where public.commute_instances.sharing_starts_at>now() and public.commute_instances.status in ('scheduled','cancelled');
 get diagnostics n=row_count;
 update public.instance_riders r set status='absent' from public.commute_instances i where r.instance_id=i.id and i.service_date=p_date and i.status in('scheduled','sharing','underway') and r.status in('expected','at_pickup')
 and (not exists(select 1 from public.club_members m where m.leg_id=i.leg_id and m.passenger_id=r.passenger_id and m.active and not m.paused)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=r.passenger_id and (e.leg_id is null or e.leg_id=i.leg_id) and e.kind<>'pickup-change' and (e.date=p_date or(e.kind='pause' and e.date is null))));
 -- Reconcile only future, unstarted trips. Preserve actual pickup history.
 update public.commute_instances i set status='cancelled' from public.driver_legs l where i.leg_id=l.id and i.service_date=p_date and i.departs_at>now() and i.status in('scheduled','sharing')
 and (not l.active or not (extract(isodow from p_date)::int-1)=any(l.days)
 or exists(select 1 from public.profiles p where p.id=l.driver_id and p.suspended_at is not null)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=l.driver_id and (e.leg_id is null or e.leg_id=l.id) and e.kind<>'pickup-change' and (e.date=p_date or (e.kind='pause' and e.date is null))));
 insert into public.instance_riders(instance_id,passenger_id,status,pickup_label,pickup,pickup_time)
 select i.id,m.passenger_id,case when m.paused or not m.active or p.suspended_at is not null or not lifty_private.agreed_on(m.agreement,p_date)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=m.passenger_id and (e.leg_id is null or e.leg_id=i.leg_id) and e.kind<>'pickup-change' and (e.date=p_date or(e.kind='pause' and e.date is null))) then 'absent'::public.rider_status else 'expected'::public.rider_status end,
 coalesce(c.pickup_label,m.pickup_label),coalesce(c.pickup,m.pickup),m.pickup_time
 from public.commute_instances i join public.club_members m on m.leg_id=i.leg_id join public.profiles p on p.id=m.passenger_id
 left join lateral(select x.* from public.pickup_changes x where x.leg_id=m.leg_id and x.passenger_id=m.passenger_id and x.service_date=p_date and x.status='approved' order by reviewed_at desc limit 1)c on true
 where i.service_date=p_date and i.status='scheduled' and (i.departs_at>now() or not exists(select 1 from public.instance_riders r where r.instance_id=i.id))
 on conflict(instance_id,passenger_id) do update set status=excluded.status,pickup_label=excluded.pickup_label,pickup=excluded.pickup,pickup_time=excluded.pickup_time
 where public.instance_riders.status in ('expected','absent') and exists(select 1 from public.commute_instances z where z.id=excluded.instance_id and z.departs_at>now() and z.status='scheduled');
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb:='{}'; t text; fk text; data jsonb;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 for t,fk in values('profiles','id'),('profile_private','id'),('vehicles','driver_id'),('driver_legs','driver_id'),('verification_documents','user_id'),('passenger_commutes','passenger_id'),('join_requests','passenger_id'),('club_members','passenger_id'),('instance_riders','passenger_id'),('schedule_exceptions','user_id'),('pickup_changes','passenger_id'),('messages','sender_id'),('ratings','rater_id'),('contributions','passenger_id'),('reports','reporter_id'),('location_pings','user_id'),('notifications','user_id'),('push_tokens','user_id') loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I r where %I=$1',t,fk) into data using auth.uid();
  result:=result||jsonb_build_object(t,data);
 end loop;
 -- Include arrangements and ledger entries owned through the driver's legs.
 for t in select unnest(array['join_requests','club_members','contributions','pickup_changes','commute_instances']) loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I r join public.driver_legs l on l.id=r.leg_id where l.driver_id=$1',t) into data using auth.uid();
  result:=result||jsonb_build_object('driver_'||t,data);
 end loop;
 result:=result||jsonb_build_object(
  'commute_instances', (select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.commute_instances i where exists(select 1 from public.instance_riders r where r.instance_id=i.id and r.passenger_id=auth.uid())),
  'received_ratings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.ratings r where r.ratee_id=auth.uid()),
  'location_withdrawals',(select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from lifty_private.location_withdrawals w where w.user_id=auth.uid()));
 return result||jsonb_build_object('exportedAt',now(),'fileManifest',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') from storage.objects where bucket_id in('avatars','vehicle-photos','kyc') and split_part(name,'/',1)=auth.uid()::text));
end $function$;

-- Reproduce the live retention function and job, previously deployed outside migration history.
create or replace function public.purge_old_location_pings() returns integer language plpgsql security definer set search_path='' as $$
declare deleted int;
begin delete from public.location_pings where recorded_at<now()-interval '30 days';get diagnostics deleted=row_count;return deleted;end $$;
revoke all on function public.purge_old_location_pings() from public,anon,authenticated;
do $$begin if not exists(select 1 from cron.job where jobname='lifty-purge-location') then
 perform cron.schedule('lifty-purge-location','30 1 * * *','select public.purge_old_location_pings();');end if;end $$;
revoke execute on function public.finish_pilot_work(text,uuid,uuid,text),public.generate_commute_instances(date) from public,anon,authenticated;

