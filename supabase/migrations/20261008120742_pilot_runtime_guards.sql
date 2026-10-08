create table lifty_private.location_withdrawals(instance_id uuid not null references public.commute_instances on delete cascade,user_id uuid not null references public.profiles on delete cascade,withdrawn_at timestamptz not null default now(),primary key(instance_id,user_id));
revoke all on lifty_private.location_withdrawals from public,anon,authenticated;
create or replace function public.stop_my_sharing(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instance_member(p_instance) then raise exception 'Not your trip';end if;
 insert into lifty_private.location_withdrawals(instance_id,user_id) values(p_instance,auth.uid()) on conflict do nothing;
end $$;
create or replace function public.can_track(p_instance uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=p_instance and w.user_id=auth.uid()) and public.account_active() and exists(select 1 from public.profile_private where id=auth.uid() and location_consent_at is not null)
 and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where i.id=p_instance and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and l.active
 and (l.driver_id=auth.uid() or exists(select 1 from public.instance_riders r join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id where r.instance_id=i.id and r.passenger_id=auth.uid() and r.status in('expected','at_pickup') and m.active and not m.paused)));
$$;
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
create or replace function lifty_private.validate_leg() returns trigger language plpgsql security definer set search_path='' as $$
declare capacity int; members int;
begin
 new.route_distance_m:=greatest(1,ceil(extensions.st_length(new.route))::int);
 select seats_total into capacity from public.vehicles where driver_id=new.driver_id;
 select count(*) into members from public.club_members where leg_id=new.id and active;
 if capacity is null or new.seats_open+members>capacity or new.seats_open<0 then raise exception 'Seat limit exceeds your vehicle or existing members'; end if;
 if tg_op='UPDATE' and members>0 and (new.departure_time<>old.departure_time or not(new.days @> old.days) or new.route::text<>old.route::text or new.destination::text<>old.destination::text) then raise exception 'Existing agreements must be ended before changing the departure, route or covered days'; end if;
 if new.route_distance_m<=0 or new.route_duration_s<=0 or cardinality(new.days)=0 then raise exception 'A valid route and weekdays are required'; end if;
 if new.monthly_contribution>public.contribution_cap(new.route_distance_m,cardinality(new.days),capacity) then raise exception 'Contribution exceeds the cost-sharing limit'; end if;
 if auth.uid() is not null and not public.account_active() then raise exception 'Account suspended'; end if;
 return new;
end $$;
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
  ) where public.account_active();
$function$;
create or replace function public.is_leg_driver(p_leg uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_active() and exists(select 1 from public.driver_legs l where l.id=p_leg and l.driver_id=auth.uid());
$$;
create or replace function public.is_leg_member(p_leg uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_active() and (public.is_leg_driver(p_leg) or exists(select 1 from public.club_members m where m.leg_id=p_leg and m.passenger_id=auth.uid() and m.active));
$$;
create or replace function public.register_push_destination(p_token text,p_platform text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() or p_platform<>'android' or length(p_token) not between 20 and 4096 then raise exception 'Invalid Android push destination';end if;
 delete from public.push_tokens where token=p_token and user_id<>auth.uid();
 insert into public.push_tokens(user_id,token,platform,updated_at) values(auth.uid(),p_token,p_platform,now()) on conflict(user_id,token) do update set updated_at=now();
end $$;
revoke all on function public.register_push_destination(text,text) from public,anon;
grant execute on function public.register_push_destination(text,text) to authenticated;
-- Protect direct table writes too. A device destination has exactly one owner.
create unique index push_one_account_per_device on public.push_tokens(token);
create or replace function public.admin_update_report(p_report uuid,p_status public.report_status) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only';end if;
 update public.reports set status=p_status,handled_by=auth.uid(),handled_at=now() where id=p_report;
end $$;
create table lifty_private.trip_reminders(instance_id uuid not null references public.commute_instances on delete cascade,user_id uuid not null references public.profiles on delete cascade,primary key(instance_id,user_id));
revoke all on lifty_private.trip_reminders from public,anon,authenticated;
create or replace function public.queue_commute_reminders() returns void language plpgsql security definer set search_path='' as $$
declare target record; added int;
begin
 for target in select i.id,r.passenger_id user_id,'/p/track' link from public.commute_instances i join public.instance_riders r on r.instance_id=i.id where i.status in('scheduled','sharing') and now() between i.sharing_starts_at and i.departs_at and r.status in('expected','at_pickup')
 union select i.id,l.driver_id,'/d/today' from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where i.status in('scheduled','sharing') and now() between i.sharing_starts_at and i.departs_at loop
  insert into lifty_private.trip_reminders values(target.id,target.user_id) on conflict do nothing;get diagnostics added=row_count;
  if added>0 then perform public.notify(target.user_id,'reminder','Your commute window is open','Open Lifty to check today''s pickup.',target.link);end if;
 end loop;
end $$;
revoke all on function public.queue_commute_reminders() from public,anon,authenticated;
create or replace function public.invoke_pilot_worker() returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.queue_commute_reminders();
 perform net.http_post(url:='https://kdjzevtryezwbjdgyqaf.supabase.co/functions/v1/pilot-worker',headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='lifty_pilot_worker')),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
create or replace function public.mark_driver_arrived(p_instance uuid,p_passenger uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() or not exists(select 1 from public.commute_instances i where i.id=p_instance and public.is_leg_driver(i.leg_id) and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at) then raise exception 'Only the driver can mark arrival during the trip';end if;
 update public.instance_riders set driver_arrived_at=now() where instance_id=p_instance and passenger_id=p_passenger and status in('expected','at_pickup') and driver_arrived_at is null;
 if found then perform public.notify(p_passenger,'pickup','Your driver has arrived','Your driver has started the three-minute pickup grace period.','/p/track');
 elsif not exists(select 1 from public.instance_riders where instance_id=p_instance and passenger_id=p_passenger and status in('expected','at_pickup')) then raise exception 'Rider is unavailable';end if;
 update public.commute_instances set status='sharing',driver_arrived_at=coalesce(driver_arrived_at,now()) where id=p_instance and status='scheduled';
end $$;
