CREATE OR REPLACE FUNCTION public.get_current_instance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  i commute_instances;
  l driver_legs;
  v_me uuid := auth.uid();
begin
  if not public.account_active() then raise exception 'Not authenticated or suspended'; end if;
  perform generate_commute_instances(v_today);
  select ci.* into i from commute_instances ci
  join driver_legs dl on dl.id = ci.leg_id
  where ci.service_date = v_today
    and ci.status not in ('completed', 'cancelled') and ci.sharing_ends_at>now()
    and (dl.driver_id = v_me or exists (select 1 from instance_riders r where r.instance_id = ci.id and r.passenger_id = v_me and r.status not in ('absent','no_show','dropped_off')))
  order by ci.departs_at
  limit 1;
  if not found then
    return null;
  end if;
  select * into l from driver_legs where id = i.leg_id;
  return jsonb_build_object(
    'id', i.id, 'legId', l.id, 'direction',l.direction, 'status', i.status, 'serviceDate', i.service_date,
    'departsAt', i.departs_at, 'sharingStartsAt', i.sharing_starts_at, 'sharingEndsAt', i.sharing_ends_at,
    'driverArrivedAt', i.driver_arrived_at, 'isDriver', l.driver_id = v_me,
    'destination', jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry)),
    'route', case when l.driver_id = v_me then st_asgeojson(l.route::geometry, 6)::jsonb
                  else st_asgeojson(st_linesubstring(l.route::geometry,
                         greatest(0, coalesce((select min(st_linelocatepoint(l.route::geometry, m.pickup::geometry)) from club_members m where m.leg_id = l.id and m.active), 0) - 2500.0 / l.route_distance_m), 1), 6)::jsonb end,
    'routeDurationS', l.route_duration_s,
    'riders', (select jsonb_agg(jsonb_build_object(
                 'passengerId', r.passenger_id, 'status', r.status, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                 'avatarPath', p.avatar_path, 'driverArrivedAt',r.driver_arrived_at,'passengerAtPickup',r.at_pickup_at is not null,'collectedAt',r.collected_at,'noShowAt',r.no_show_at,
                 'pickup', jsonb_build_object('label',coalesce(r.pickup_label,m.pickup_label),'lng',st_x(coalesce(r.pickup,m.pickup)::geometry),'lat',st_y(coalesce(r.pickup,m.pickup)::geometry)),
                 'pickupTime', to_char(m.pickup_time, 'HH24:MI')))
               from instance_riders r join profiles p on p.id = r.passenger_id
               join club_members m on m.leg_id = l.id and m.passenger_id = r.passenger_id
               where r.instance_id = i.id
                 and (l.driver_id = v_me or r.passenger_id = v_me)),
    'driver', (select jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
                                         'rating', p.rating, 'ratingCount', p.rating_count,'verification',public.driver_verification(p.id))
               from profiles p where p.id = l.driver_id),
    'vehicle', (select jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'bodyType', v.body_type,
                                          'registrationSummary', v.registration_summary, 'photoPath', v.photo_path)
                from vehicles v where v.driver_id = l.driver_id)
  );
end $function$;

create or replace function public.can_track(p_instance uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_active() and exists(select 1 from public.profile_private where id=auth.uid() and location_consent_at is not null)
 and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where i.id=p_instance and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and l.active
 and (l.driver_id=auth.uid() or exists(select 1 from public.instance_riders r join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id where r.instance_id=i.id and r.passenger_id=auth.uid() and r.status in('expected','at_pickup') and m.active and not m.paused)));
$$;
create or replace function public.can_receive_location(p_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare instance uuid; passenger uuid;
begin
 if p_topic !~ '^commute:[0-9a-f-]{36}:[0-9a-f-]{36}$' or not public.account_active() then return false; end if;
 instance:=split_part(p_topic,':',2)::uuid; passenger:=split_part(p_topic,':',3)::uuid;
 return exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.instance_riders r on r.instance_id=i.id
 join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id
 where i.id=instance and r.passenger_id=passenger and m.active and not m.paused and r.status in('expected','at_pickup','collected')
 and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and (l.driver_id=auth.uid() or passenger=auth.uid()));
exception when invalid_text_representation then return false;
end $$;
drop policy "commute members receive live location" on realtime.messages;
drop policy "commute members send live location" on realtime.messages;
create policy "authorized pair receives server location" on realtime.messages for select to authenticated using(public.can_receive_location(realtime.topic()));
drop policy pings_read on public.location_pings;
create policy pings_owner_or_safety_reviewer on public.location_pings for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
drop policy riders_read on public.instance_riders;
create policy riders_participant on public.instance_riders for select to authenticated using(passenger_id=(select auth.uid()) or exists(select 1 from public.commute_instances i where i.id=instance_id and public.is_leg_driver(i.leg_id)));
create or replace function public.publish_location(p_instance uuid,p_lng float8,p_lat float8,p_heading real default null,p_speed real default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs; passenger uuid; payload jsonb;
begin
 if not public.can_track(p_instance) then raise exception 'Location sharing is not authorized'; end if;
 if p_lat is null or p_lng is null or not p_lat between -90 and 90 or not p_lng between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 select dl.* into l from public.driver_legs dl join public.commute_instances i on i.leg_id=dl.id where i.id=p_instance;
 payload:=jsonb_build_object('from',auth.uid(),'lat',p_lat,'lng',p_lng,'heading',p_heading,'speed',p_speed,'at',floor(extract(epoch from clock_timestamp())*1000));
 if l.driver_id=auth.uid() then
  for passenger in select r.passenger_id from public.instance_riders r join public.club_members m on m.leg_id=l.id and m.passenger_id=r.passenger_id join public.profiles p on p.id=r.passenger_id
    where r.instance_id=p_instance and r.status in('expected','at_pickup','collected') and m.active and not m.paused and p.suspended_at is null loop
   perform realtime.send(payload,'loc','commute:'||p_instance||':'||passenger,true);
  end loop;
 else
  perform realtime.send(payload,'loc','commute:'||p_instance||':'||auth.uid(),true);
 end if;
 if not exists(select 1 from public.location_pings where instance_id=p_instance and user_id=auth.uid() and recorded_at>now()-interval '25 seconds') then
  insert into public.location_pings(instance_id,user_id,location,heading,speed) values(p_instance,auth.uid(),extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_heading,p_speed);
 end if;
end $$;
create or replace function public.record_location(p_instance uuid,p_lng float8,p_lat float8,p_heading real default null,p_speed real default null) returns void language plpgsql security definer set search_path='' as $$
begin perform public.publish_location(p_instance,p_lng,p_lat,p_heading,p_speed); end $$;
create or replace function public.mark_driver_arrived(p_instance uuid,p_passenger uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() or not exists(select 1 from public.commute_instances i where i.id=p_instance and public.is_leg_driver(i.leg_id) and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at) then raise exception 'Only the driver can mark arrival during the trip'; end if;
 update public.instance_riders set driver_arrived_at=coalesce(driver_arrived_at,now()) where instance_id=p_instance and passenger_id=p_passenger and status in('expected','at_pickup');
 if not found then raise exception 'Rider is unavailable'; end if;
 update public.commute_instances set status='sharing',driver_arrived_at=coalesce(driver_arrived_at,now()) where id=p_instance and status='scheduled';
end $$;
create or replace function public.mark_driver_arrived(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'Select the passenger whose pickup you have reached'; end $$;
create or replace function public.mark_rider_status(p_instance uuid,p_passenger uuid,p_status public.rider_status) returns void language plpgsql security definer set search_path='' as $$
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
 if p_status='no_show' then perform public.notify(p_passenger,'no_show','Pickup missed','Your driver waited three minutes at your pickup.','/p/commute'); end if;
 if not exists(select 1 from public.instance_riders where instance_id=p_instance and status in('expected','at_pickup')) and exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then update public.commute_instances set status='underway',started_at=coalesce(started_at,now()) where id=p_instance; end if;
end $$;
create or replace function public.stop_my_sharing(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instance_member(p_instance) then raise exception 'Not your trip'; end if;
 -- Withdrawal is durable and blocks future device publications for this trip.
 update public.profile_private set location_consent_at=null where id=auth.uid();
end $$;
create or replace function public.get_commute_history() returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'legId',i.leg_id,'direction',l.direction,'date',i.service_date,'departsAt',i.departs_at,
 'status',case when r.status='no_show' then 'missed' else i.status::text end,'driverId',l.driver_id,'driverName',p.first_name,
 'pickupLabel',coalesce(r.pickup_label,m.pickup_label,l.origin_label),'destinationLabel',l.destination_label,
 'canRate',i.status='completed' and r.status='dropped_off' and r.passenger_id=auth.uid(),
 'rated',exists(select 1 from public.ratings x where x.instance_id=i.id and x.rater_id=auth.uid() and x.ratee_id=l.driver_id))
 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.profiles p on p.id=l.driver_id
 left join public.instance_riders r on r.instance_id=i.id and r.passenger_id=auth.uid()
 left join public.club_members m on m.leg_id=l.id and m.passenger_id=auth.uid()
 where l.driver_id=auth.uid() or r.passenger_id=auth.uid() order by i.service_date desc,i.departs_at desc limit 100;
$$;
