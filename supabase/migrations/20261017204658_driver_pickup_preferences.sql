-- Additive local/staging proposal. Pickup preferences affect new matches and
-- requests; the pickup and schedule of an accepted arrangement remain intact.
alter table public.driver_legs add column pickup_policy text not null default 'flexible'
 check(pickup_policy in('flexible','door_to_door','meeting_point'));
comment on column public.driver_legs.pickup_policy is 'New requests: flexible, passenger origin only, or named meeting points only. Existing agreements retain their pickup.';
revoke update(pickup_policy) on public.driver_legs from anon,authenticated;

create function lifty_private.profile_name_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.profiles where id=new.id and role='driver') then
  update public.verification_documents set status='pending',reviewed_by=null,reviewed_at=null,
   review_note='Account name changed; identity review required'
  where id=(select id from public.verification_documents where user_id=new.id and kind='id'
    order by created_at desc,submitted_seq desc limit 1) and status='verified';
 end if;
 return new;
end $$;
revoke all on function lifty_private.profile_name_changed() from public,anon,authenticated;
create trigger profile_name_identity_review after update of first_name,last_initial on public.profiles
for each row when((old.first_name,old.last_initial) is distinct from(new.first_name,new.last_initial)) execute function lifty_private.profile_name_changed();
create trigger private_name_identity_review after update of last_name on public.profile_private
for each row when(old.last_name is distinct from new.last_name) execute function lifty_private.profile_name_changed();

create or replace function public.update_profile_name(p_full_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized text; first text; last text;
begin
 if not public.account_active() then raise exception 'Sign in to update your name';end if;
 normalized:=trim(regexp_replace(p_full_name,'\s+',' ','g'));
 if normalized is null or length(normalized) not between 3 and 120
  or normalized ~ '[[:cntrl:]]' then raise exception 'Enter your full name';end if;
 first:=split_part(normalized,' ',1);last:=trim(substr(normalized,length(first)+1));
 if length(first)<1 or length(last)<1 then raise exception 'Enter your first name and surname';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 update public.profiles set first_name=first,last_initial=upper(left(last,1)) where id=auth.uid();
 insert into public.profile_private(id,last_name) values(auth.uid(),last)
 on conflict(id) do update set last_name=excluded.last_name;
 -- Both name-write paths invalidate approval through the same triggers.
 return public.driver_verification(auth.uid());
end $$;
revoke all on function public.update_profile_name(text) from public,anon;
grant execute on function public.update_profile_name(text) to authenticated;

-- Preserve all existing draft checks, adding only this validated preference.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.save_driver_onboarding_draft(jsonb)'::regprocedure);
 if position('''days'',''maxDeviationMin''' in d)=0 or position('elsif k=''maxDeviationMin'' then' in d)=0 then
  raise exception 'Driver draft pickup policy patch requires review';end if;
 d:=replace(d,'''days'',''maxDeviationMin''','''days'',''maxDeviationMin'',''pickupPolicy''');
 d:=replace(d,'elsif k=''maxDeviationMin'' then',$patch$elsif k='pickupPolicy' then
    if jsonb_typeof(j->k)<>'string' or j->>k not in('flexible','door_to_door','meeting_point') then raise exception 'Invalid draft pickup preference';end if;
   elsif k='maxDeviationMin' then$patch$);
 execute d;
end $$;

drop function public.upsert_driver_leg(public.leg_direction,text,float8,float8,text,float8,float8,jsonb,int,int,time,smallint[],int,int,int);
create function public.upsert_driver_leg(
 p_direction public.leg_direction,
 p_origin_label text,p_origin_lng float8,p_origin_lat float8,
 p_destination_label text,p_destination_lng float8,p_destination_lat float8,
 p_route jsonb,p_distance_m int,p_duration_s int,p_departure time,p_days smallint[],
 p_seats int,p_max_deviation int,p_contribution int,p_pickup_policy text default null
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;v_cap int;v_members int;
begin
 if not public.account_active() or not exists(select 1 from profiles where id=auth.uid() and role='driver') then
  raise exception 'Only active drivers can publish a commute';end if;
 if p_pickup_policy is not null and p_pickup_policy not in('flexible','door_to_door','meeting_point') then raise exception 'Invalid pickup preference';end if;
 -- Serialize initial publication and edits for this account/direction.
 perform 1 from profiles where id=auth.uid() for update;
 v_cap:=contribution_cap(p_distance_m,coalesce(array_length(p_days,1),0),p_seats);
 if p_contribution>v_cap then raise exception 'Contribution is above the cost-sharing limit of R% per month',v_cap;end if;
 select count(*) into v_members from club_members m join driver_legs l on l.id=m.leg_id
  where l.driver_id=auth.uid() and l.direction=p_direction and m.active;
 insert into driver_legs(driver_id,direction,origin_label,origin,destination_label,destination,route,
  route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution,pickup_policy)
 values(auth.uid(),p_direction,p_origin_label,st_setsrid(st_makepoint(p_origin_lng,p_origin_lat),4326)::geography,
  p_destination_label,st_setsrid(st_makepoint(p_destination_lng,p_destination_lat),4326)::geography,
  st_setsrid(st_geomfromgeojson(p_route::text),4326)::geography,p_distance_m,p_duration_s,p_departure,p_days,
  greatest(p_seats-v_members,0),p_max_deviation,p_contribution,
  coalesce(p_pickup_policy,(select pickup_policy from driver_legs where driver_id=auth.uid() and direction=p_direction),'flexible'))
 on conflict(driver_id,direction) do update set
  origin_label=excluded.origin_label,origin=excluded.origin,destination_label=excluded.destination_label,destination=excluded.destination,
  route=excluded.route,route_distance_m=excluded.route_distance_m,route_duration_s=excluded.route_duration_s,
  departure_time=excluded.departure_time,days=excluded.days,seats_open=excluded.seats_open,
  max_deviation_min=excluded.max_deviation_min,monthly_contribution=excluded.monthly_contribution,
  pickup_policy=excluded.pickup_policy,active=true returning id into v_id;
 return v_id;
end $$;
revoke all on function public.upsert_driver_leg(public.leg_direction,text,float8,float8,text,float8,float8,jsonb,int,int,time,smallint[],int,int,int,text) from public,anon;
grant execute on function public.upsert_driver_leg(public.leg_direction,text,float8,float8,text,float8,float8,jsonb,int,int,time,smallint[],int,int,int,text) to authenticated;

drop function public.save_driver_settings(uuid,int,int,int,time,smallint[]);
create function public.save_driver_settings(p_leg uuid,p_seats int,p_deviation int,p_contribution int,
 p_departure time default null,p_days smallint[] default null,p_pickup_policy text default null)
returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs;used int;
begin
 select * into l from public.driver_legs where id=p_leg for update;
 if l.driver_id is distinct from auth.uid() or not public.account_active() then raise exception 'Not your commute';end if;
 if p_pickup_policy is not null and p_pickup_policy not in('flexible','door_to_door','meeting_point') then raise exception 'Invalid pickup preference';end if;
 select count(*) into used from public.club_members where leg_id=p_leg and active;
 if p_seats<used then raise exception 'Seats cannot be less than existing members';end if;
 update public.driver_legs set seats_open=p_seats-used,max_deviation_min=p_deviation,monthly_contribution=p_contribution,
  departure_time=coalesce(p_departure,departure_time),days=coalesce(p_days,days),pickup_policy=coalesce(p_pickup_policy,pickup_policy) where id=p_leg;
 perform public.reconcile_commutes();
end $$;
revoke all on function public.save_driver_settings(uuid,int,int,int,time,smallint[],text) from public,anon;
grant execute on function public.save_driver_settings(uuid,int,int,int,time,smallint[],text) to authenticated;

-- Centralize pickup selection for road-routed and explicitly estimated matching.
-- Meeting-point preference never invents a roadside stop; it uses the managed
-- pickup_points catalogue. Passenger walking limits still apply to every choice.
create function lifty_private.pickup_candidates(p_leg uuid,p_commute public.passenger_commutes)
returns table(label text,pt extensions.geography) language sql stable security definer set search_path='' as $$
 select pp.name,pp.location from public.driver_legs l join public.pickup_points pp
  on extensions.st_dwithin(pp.location,p_commute.origin,p_commute.max_walk_m)
  and extensions.st_dwithin(pp.location,l.route,800)
 where l.id=p_leg and l.pickup_policy in('flexible','meeting_point')
  and (not pp.is_test or(lifty_private.test_enabled() and public.can_view_test_leg(l.id,p_commute.passenger_id)))
 union all
 select 'On '||split_part(l.destination_label,',',1)||' route',extensions.st_closestpoint(l.route::extensions.geometry,p_commute.origin::extensions.geometry)::extensions.geography
 from public.driver_legs l where l.id=p_leg and l.pickup_policy='flexible' and p_commute.max_walk_m>0
  and extensions.st_dwithin(l.route,p_commute.origin,p_commute.max_walk_m)
 union all
 select 'Your street',p_commute.origin from public.driver_legs l where l.id=p_leg
  and l.pickup_policy in('door_to_door','flexible');
$$;
revoke all on function lifty_private.pickup_candidates(uuid,public.passenger_commutes) from public,anon,authenticated;

do $$ declare f text;d text;old_pickups text:=$old$select l.id as leg_id, pp.name as label, pp.location as pt
    from legs l
    join pickup_points pp on st_dwithin(pp.location, c.origin, c.max_walk_m) and st_dwithin(pp.location, l.route, 800)
    union all
    select l.id, 'On ' || split_part(l.destination_label, ',', 1) || ' route', st_closestpoint(l.g, c.origin::geometry)::geography
    from legs l where c.max_walk_m > 0 and st_dwithin(l.route, c.origin, c.max_walk_m)
    union all
    select l.id, 'Your street', c.origin from legs l where c.max_walk_m = 0$old$;
begin
 foreach f in array array['lifty_private.raw_match_candidates(uuid,uuid)','lifty_private.raw_find_matches(uuid)'] loop
  d:=pg_get_functiondef(f::regprocedure);
  if position(old_pickups in d)=0 or position('l.seats_open, l.max_deviation_min, l.monthly_contribution,' in d)=0 then
   raise exception 'Pickup candidate patch requires review: %',f;end if;
  d:=replace(d,old_pickups,'select l.id as leg_id, p.label, p.pt from legs l cross join lateral lifty_private.pickup_candidates(l.id,c) p');
  d:=replace(d,'l.seats_open, l.max_deviation_min, l.monthly_contribution,','l.seats_open, l.max_deviation_min, l.monthly_contribution, l.pickup_policy,');
  if f like '%raw_find_matches%' then
   d:=replace(d,$old$'direction', c.direction,
    'driver'$old$,$new$'direction', c.direction, 'pickupPolicy', o.pickup_policy,
    'driver'$new$);
  else
   d:=replace(d,$old$'direction', c.direction,
        'driver'$old$,$new$'direction', c.direction, 'pickupPolicy', r.pickup_policy,
        'driver'$new$);
  end if;
  execute d;
 end loop;
 d:=pg_get_functiondef('lifty_private.raw_get_my_clubs()'::regprocedure);
 if position('''maxDeviationMin'', l.max_deviation_min' in d)=0 then raise exception 'Driver pickup snapshot patch requires review';end if;
 execute replace(d,'''maxDeviationMin'', l.max_deviation_min','''maxDeviationMin'', l.max_deviation_min, ''pickupPolicy'', l.pickup_policy');
end $$;

create or replace function public.leg_signature(l public.driver_legs) returns text
language sql stable set search_path='' as $$
 select md5(concat_ws('|',l.route::text,l.origin::text,l.destination::text,l.departure_time::text,l.days::text,
  l.direction::text,l.max_deviation_min::text,l.monthly_contribution::text,l.pickup_policy));
$$;

-- Snapshot policy when requested and reject stale pending requests after a change.
-- Legacy accepted arrangements remain valid and retain their agreed pickup.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.request_to_join(uuid,uuid)'::regprocedure);
 if position('''destination'',m->''destination''' in d)=0 then raise exception 'Request pickup snapshot patch requires review';end if;
 execute replace(d,'''destination'',m->''destination''','''pickupPolicy'',l.pickup_policy,''destination'',m->''destination''');
 d:=pg_get_functiondef('public.respond_to_request(uuid,boolean)'::regprocedure);
 if position('if p_accept then' in d)=0 then raise exception 'Request pickup acceptance patch requires review';end if;
 execute replace(d,'if p_accept then',$patch$if p_accept then
    if coalesce(r.agreement->>'pickupPolicy','flexible') is distinct from l.pickup_policy then
     raise exception 'Pickup preference changed. Ask the passenger to refresh and submit a new request.';end if;$patch$);
end $$;
notify pgrst,'reload schema';
