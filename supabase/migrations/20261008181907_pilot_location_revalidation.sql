-- Revalidate both members when publishing. Realtime channel admission is cached,
-- so closing a trip's sharing must also stop server sends to previously joined channels.
create or replace function public.can_track(p_instance uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.account_active()
 and exists(select 1 from public.profile_private where id=auth.uid() and location_consent_at is not null)
 and not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=p_instance and w.user_id=auth.uid())
 and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id
 join public.profiles dp on dp.id=l.driver_id
 where i.id=p_instance and i.status in('scheduled','sharing','underway')
 and now() between i.sharing_starts_at and i.sharing_ends_at and l.active and dp.suspended_at is null
 and not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=i.id and w.user_id=l.driver_id)
 and (l.driver_id=auth.uid() or exists(select 1 from public.instance_riders r
 join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id
 where r.instance_id=i.id and r.passenger_id=auth.uid() and r.status in('expected','at_pickup') and m.active and not m.paused)));
$$;

create or replace function public.can_receive_location(p_topic text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare instance uuid; passenger uuid;
begin
 if p_topic !~ '^commute:[0-9a-f-]{36}:[0-9a-f-]{36}$' or not public.account_active() then return false; end if;
 instance:=split_part(p_topic,':',2)::uuid; passenger:=split_part(p_topic,':',3)::uuid;
 return exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id
 join public.profiles dp on dp.id=l.driver_id join public.instance_riders r on r.instance_id=i.id
 join public.profiles pp on pp.id=r.passenger_id join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id
 where i.id=instance and r.passenger_id=passenger and dp.suspended_at is null and pp.suspended_at is null
 and l.active and m.active and not m.paused and r.status in('expected','at_pickup','collected')
 and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at
 and (l.driver_id=auth.uid() or passenger=auth.uid())
 and not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=i.id and w.user_id in(l.driver_id,passenger)));
exception when invalid_text_representation then return false;
end $$;

create or replace function public.publish_location(p_instance uuid,p_lng float8,p_lat float8,p_heading real default null,p_speed real default null)
returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs; passenger uuid; payload jsonb;
begin
 if not public.can_track(p_instance) then raise exception 'Location sharing is not authorized';end if;
 if p_lat is null or p_lng is null or not p_lat between -90 and 90 or not p_lng between -180 and 180 then raise exception 'Invalid coordinates';end if;
 select dl.* into l from public.driver_legs dl join public.commute_instances i on i.leg_id=dl.id where i.id=p_instance;
 payload:=jsonb_build_object('from',auth.uid(),'lat',p_lat,'lng',p_lng,'heading',p_heading,'speed',p_speed,'at',floor(extract(epoch from clock_timestamp())*1000));
 if l.driver_id=auth.uid() then
  for passenger in select r.passenger_id from public.instance_riders r
   join public.club_members m on m.leg_id=l.id and m.passenger_id=r.passenger_id join public.profiles p on p.id=r.passenger_id
   where r.instance_id=p_instance and r.status in('expected','at_pickup','collected') and m.active and not m.paused and p.suspended_at is null
   and not exists(select 1 from lifty_private.location_withdrawals w where w.instance_id=p_instance and w.user_id=r.passenger_id) loop
    perform realtime.send(payload,'loc','commute:'||p_instance||':'||passenger,true);
  end loop;
 else
  perform realtime.send(payload,'loc','commute:'||p_instance||':'||auth.uid(),true);
 end if;
 if not exists(select 1 from public.location_pings where instance_id=p_instance and user_id=auth.uid() and recorded_at>now()-interval '25 seconds') then
  insert into public.location_pings(instance_id,user_id,location,heading,speed)
  values(p_instance,auth.uid(),extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_heading,p_speed);
 end if;
end $$;

revoke all on function public.can_track(uuid),public.can_receive_location(text),public.publish_location(uuid,float8,float8,real,real) from public,anon;
grant execute on function public.can_track(uuid),public.can_receive_location(text),public.publish_location(uuid,float8,float8,real,real) to authenticated;
