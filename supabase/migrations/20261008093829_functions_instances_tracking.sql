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
                         greatest(0, coalesce((select min(st_linelocatepoint(l.route::geometry, m.pickup::geometry)) from club_members m where m.leg_id = l.id and m.active), 0) - 2500.0 / l.route_distance_m), 1), 6)::jsonb end,
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

  if not exists (select 1 from instance_riders r where r.instance_id = p_instance and r.status in ('expected', 'at_pickup'))
     and exists (select 1 from instance_riders r where r.instance_id = p_instance and r.status = 'collected') then
    update commute_instances set status = 'underway', started_at = coalesce(started_at, now()) where id = p_instance;
  end if;

  if p_status = 'no_show' then
    update profiles p set reliability = coalesce((
      select greatest(0, round(100.0 * count(*) filter (where r.status in ('collected', 'dropped_off')) / nullif(count(*) filter (where r.status in ('collected', 'dropped_off', 'no_show')), 0)))::int
      from instance_riders r join commute_instances ci on ci.id = r.instance_id
      where r.passenger_id = p_passenger and ci.service_date > current_date - 60), 0)
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
  if v_driver is distinct from auth.uid() then raise exception 'Only the driver can complete the commute'; end if;
  update commute_instances set status = 'completed', completed_at = now() where id = p_instance and status <> 'completed';
  update instance_riders set status = 'dropped_off' where instance_id = p_instance and status = 'collected';
  perform notify(r.passenger_id, 'completed', 'Commute completed', 'How was your commute? Rate your driver to build community trust.', '/p/rate')
  from instance_riders r where r.instance_id = p_instance and r.status = 'dropped_off';
end $$;

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

create or replace function public.on_rating_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles p set rating = s.avg_stars, rating_count = s.n
  from (select round(avg(stars)::numeric, 1) as avg_stars, count(*)::int as n from ratings where ratee_id = new.ratee_id) s
  where p.id = new.ratee_id;
  return new;
end $$;
create trigger ratings_aggregate after insert on public.ratings for each row execute function public.on_rating_insert();

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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, text, text, text, text) from authenticated;
revoke execute on function public.generate_commute_instances(date) from authenticated;
revoke execute on function public.on_rating_insert() from authenticated;

select cron.schedule('lifty-generate-instances', '5 22 * * *',
  $c$select public.generate_commute_instances(((now() at time zone 'Africa/Johannesburg')::date + 1))$c$);
