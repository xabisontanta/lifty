-- LOCAL / staging proposal only. No hosted project has been changed by this migration.
-- Old is_demo fixtures become explicitly labelled test accounts; access defaults OFF.
alter table public.profiles add column is_test boolean not null default false;
update public.profiles set is_test=true where is_demo;
grant select(is_test) on public.profiles to authenticated;
create or replace function lifty_private.profile_test_flag() returns trigger language plpgsql security definer set search_path='' as $$
begin new.is_test:=new.is_test or new.is_demo; if tg_op='UPDATE' then new.is_test:=new.is_test or old.is_test;end if;return new;end $$;
create trigger test_profile_label before insert or update on public.profiles for each row execute function lifty_private.profile_test_flag();
create table lifty_private.test_environment(id boolean primary key default true check(id),mode text not null default 'disabled' check(mode in('disabled','local','staging')));
insert into lifty_private.test_environment(id) values(true);
-- A reviewed seed can populate an already-enabled sandbox, but cannot change its mode.
create or replace function lifty_private.authorize_test_seed() returns void language plpgsql security definer set search_path='' as $$
declare marker text:=current_setting('lifty.nonproduction_seed',true);environment text;
begin
 select mode into environment from lifty_private.test_environment where id;
 if not ((marker='LOCAL_LIFTY_ONLY' and environment='local') or (marker='STAGING_LIFTY_ONLY' and environment='staging')) then
  raise exception 'Seed refused: explicitly enable the intended nonproduction mode before confirming that same target';
 end if;
end $$;
revoke all on function lifty_private.authorize_test_seed() from public,anon,authenticated;
create table lifty_private.testers(user_id uuid primary key references public.profiles on delete cascade);
create table lifty_private.test_driver_settings(driver_id uuid primary key references public.profiles on delete cascade,auto_respond boolean not null default true,response_delay_seconds int not null default 5 check(response_delay_seconds between 0 and 3600),decline_percent int not null default 0 check(decline_percent between 0 and 100));
create table lifty_private.test_trips(instance_id uuid primary key references public.commute_instances on delete cascade,started_at timestamptz not null default now(),duration_seconds int not null default 90 check(duration_seconds between 30 and 3600),state text not null default 'approaching' check(state in('approaching','arrived','underway','completed')),pickup_fraction float8 not null,destination_fraction float8 not null);
revoke all on lifty_private.test_environment,lifty_private.testers,lifty_private.test_driver_settings,lifty_private.test_trips from public,anon,authenticated;

create or replace function lifty_private.test_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select mode<>'disabled' from lifty_private.test_environment where id),false);
$$;
create or replace function public.can_view_test_account(p_account uuid,p_viewer uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_account and (not p.is_test or (p_viewer is not null and exists(select 1 from public.profiles vp where vp.id=p_viewer and vp.suspended_at is null) and exists(select 1 from lifty_private.test_environment e where e.id and (e.mode='local' or (e.mode='staging' and exists(select 1 from lifty_private.testers t where t.user_id=p_viewer)))))));
$$;
create or replace function public.can_view_test_leg(p_leg uuid,p_viewer uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.driver_legs l where l.id=p_leg and public.can_view_test_account(l.driver_id,p_viewer));
$$;
create or replace function public.can_view_test_instance(p_instance uuid,p_viewer uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.commute_instances i where i.id=p_instance and public.can_view_test_leg(i.leg_id,p_viewer));
$$;
revoke all on function public.can_view_test_account(uuid,uuid),public.can_view_test_leg(uuid,uuid),public.can_view_test_instance(uuid,uuid) from public,anon;
grant execute on function public.can_view_test_account(uuid,uuid),public.can_view_test_leg(uuid,uuid),public.can_view_test_instance(uuid,uuid) to authenticated,service_role;

-- Mark dependent rows too. Clients cannot clear these labels by including is_test=false.
do $$ declare t text; begin
 foreach t in array array['profile_private','vehicles','verification_documents','driver_legs','pickup_points','passenger_commutes','join_requests','club_members','commute_instances','instance_riders','ratings','messages','notifications','contributions','schedule_exceptions','location_pings','pickup_changes','push_tokens','reports'] loop
  execute format('alter table public.%I add column is_test boolean not null default false',t);
 end loop;
end $$;
alter table public.notifications add column source_leg_id uuid references public.driver_legs(id) on delete cascade;
alter table public.notifications add column source_instance_id uuid references public.commute_instances(id) on delete cascade;
create or replace function lifty_private.test_row_flag() returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new); u text; test boolean:=false;
begin
 if tg_table_name='pickup_points' then return new;end if;
 foreach u in array array['driver_id','passenger_id','user_id','sender_id','rater_id','ratee_id','reporter_id'] loop
  if j->>u is not null and exists(select 1 from public.profiles p where p.id=(j->>u)::uuid and p.is_test) then test:=true;end if;
 end loop;
 if tg_table_name='profile_private' then test:=exists(select 1 from public.profiles p where p.id=new.id and p.is_test);end if;
 if j->>'leg_id' is not null and exists(select 1 from public.driver_legs l join public.profiles p on p.id=l.driver_id where l.id=(j->>'leg_id')::uuid and p.is_test) then test:=true;end if;
 if j->>'instance_id' is not null and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.profiles p on p.id=l.driver_id where i.id=(j->>'instance_id')::uuid and p.is_test) then test:=true;end if;
 if tg_table_name='notifications' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_test) then test:=true;end if;
 if tg_table_name='notifications' then
  -- Preserve origin context even when a cron job has no auth.uid() or a real tester is the recipient.
  if new.source_instance_id is null and new.link ~ '[?&]instance=[0-9a-f-]{36}' then select id into new.source_instance_id from public.commute_instances where id=substring(new.link from '[?&]instance=([0-9a-f-]{36})')::uuid;end if;
  if new.source_leg_id is null and new.link ~ '^/p/match/[0-9a-f-]{36}' then select id into new.source_leg_id from public.driver_legs where id=substring(new.link from '^/p/match/([0-9a-f-]{36})')::uuid;end if;
  if new.source_leg_id is null and new.link ~ '[?&]request=[0-9a-f-]{36}' then select leg_id into new.source_leg_id from public.join_requests where id=substring(new.link from '[?&]request=([0-9a-f-]{36})')::uuid;end if;
  if new.source_instance_id is not null then select leg_id into new.source_leg_id from public.commute_instances where id=new.source_instance_id;end if;
  if exists(select 1 from public.driver_legs l join public.profiles p on p.id=l.driver_id where l.id=new.source_leg_id and p.is_test) then test:=true;end if;
 end if;
 if tg_op='UPDATE' then test:=test or old.is_test;end if;
 new.is_test:=test; return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['profile_private','vehicles','verification_documents','driver_legs','passenger_commutes','join_requests','club_members','commute_instances','instance_riders','ratings','messages','notifications','contributions','schedule_exceptions','location_pings','pickup_changes','push_tokens','reports'] loop
  execute format('create trigger test_row_label before insert or update on public.%I for each row execute function lifty_private.test_row_flag()',t);
  execute format('update public.%I set is_test=is_test',t);
 end loop;
end $$;

-- Restrictive policies combine with each existing owner/member policy; adding another
-- permissive policy later cannot accidentally expose test people to production users.
create policy test_visibility on public.profiles as restrictive for select to authenticated using(public.can_view_test_account(id));
create policy test_visibility on public.profile_private as restrictive for select to authenticated using(public.can_view_test_account(id));
create policy test_visibility on public.passenger_commutes as restrictive for select to authenticated using(public.can_view_test_account(passenger_id));
create policy test_visibility on public.vehicles as restrictive for select to authenticated using(public.can_view_test_account(driver_id));
create policy test_visibility on public.ratings as restrictive for select to authenticated using(public.can_view_test_account(rater_id) and public.can_view_test_account(ratee_id));
create policy test_visibility on public.pickup_points as restrictive for select to authenticated using(not is_test or (select lifty_private.test_enabled()));
create policy test_visibility on public.driver_legs as restrictive for select to authenticated using(public.can_view_test_account(driver_id));
create policy test_visibility on public.verification_documents as restrictive for select to authenticated using(public.can_view_test_account(user_id));
create policy test_visibility on public.join_requests as restrictive for select to authenticated using(public.can_view_test_leg(leg_id));
create policy test_visibility on public.club_members as restrictive for select to authenticated using(public.can_view_test_leg(leg_id));
create policy test_visibility on public.commute_instances as restrictive for select to authenticated using(public.can_view_test_leg(leg_id));
create policy test_visibility on public.instance_riders as restrictive for select to authenticated using(public.can_view_test_instance(instance_id));
create policy test_visibility on public.messages as restrictive for select to authenticated using(public.can_view_test_leg(leg_id));
create policy test_visibility on public.contributions as restrictive for select to authenticated using(public.can_view_test_leg(leg_id));
create policy test_visibility on public.location_pings as restrictive for select to authenticated using(public.can_view_test_instance(instance_id));

-- Retain existing validation/booking logic in private implementations. Public wrappers
-- enforce test visibility because SECURITY DEFINER functions otherwise bypass RLS.
do $$ declare s text; f text; d text; o text; begin
 foreach s in array array['account_active()','get_account_snapshot()','is_leg_driver(uuid)','is_leg_member(uuid)','is_instance_member(uuid)','can_track(uuid)','can_receive_location(text)','driver_approved(uuid)','driver_verification(uuid)','find_matches(uuid)','match_candidates(uuid,uuid)','get_match(uuid,uuid)','persist_match_quotes(uuid,uuid,text,jsonb,jsonb)','request_to_join_quote(uuid,uuid,uuid)','get_my_clubs()','get_current_instance()','get_commute_history()','list_incoming_requests()'] loop
  f:=split_part(s,'(',1); d:=pg_get_functiondef(('public.'||s)::regprocedure); o:=d;
  d:=replace(d,'FUNCTION public.'||f||'(','FUNCTION lifty_private.raw_'||f||'(');
  if d=o then raise exception 'Could not copy public.% to lifty_private.raw_%: definition not recognised',f,f;end if;
  execute d;
 end loop;
end $$;
create or replace function public.account_active() returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_account_active() and public.can_view_test_account(auth.uid());
$$;
create or replace function public.get_account_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and is_test) and not public.can_view_test_account(auth.uid()) then raise exception 'Test accounts are unavailable in this environment';end if;
 return lifty_private.raw_get_account_snapshot();
end $$;
create or replace function public.is_leg_driver(p_leg uuid) returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_is_leg_driver(p_leg) and public.can_view_test_leg(p_leg);
$$;
create or replace function public.is_leg_member(p_leg uuid) returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_is_leg_member(p_leg) and public.can_view_test_leg(p_leg);
$$;
create or replace function public.is_instance_member(p_instance uuid) returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_is_instance_member(p_instance) and public.can_view_test_instance(p_instance);
$$;
create or replace function public.can_track(p_instance uuid) returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_can_track(p_instance) and public.can_view_test_instance(p_instance);
$$;
create or replace function public.can_receive_location(p_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_topic !~ '^commute:[0-9a-f-]{36}:[0-9a-f-]{36}$' then return false;end if;
 return public.can_view_test_instance(split_part(p_topic,':',2)::uuid) and lifty_private.raw_can_receive_location(p_topic);
exception when invalid_text_representation then return false;
end $$;
-- Channel admission is cached. Revalidate every receiver at publication time,
-- so removing a staging tester never delivers another location to an old channel.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.publish_location(uuid,double precision,double precision,real,real)'::regprocedure);
 -- A replacement that matches nothing would silently leave the old, unprotected function in place: fail instead.
 if position('where r.instance_id=p_instance and r.status' in d)=0 or position('perform realtime.send(payload,''loc'',''commute:''||p_instance||'':''||auth.uid(),true);' in d)=0 then
  raise exception 'publish_location definition not recognised; test-visibility patch not applied';
 end if;
 d:=replace(d,'where r.instance_id=p_instance and r.status', 'where public.can_view_test_leg(l.id,r.passenger_id) and r.instance_id=p_instance and r.status');
 d:=replace(d,'perform realtime.send(payload,''loc'',''commute:''||p_instance||'':''||auth.uid(),true);',
 'if public.can_view_test_account(l.driver_id,l.driver_id) then perform realtime.send(payload,''loc'',''commute:''||p_instance||'':''||auth.uid(),true);end if;');
 execute d;
end $$;
create or replace function public.driver_approved(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select lifty_private.raw_driver_approved(p_user) and exists(select 1 from public.profiles p where p.id=p_user and (not p.is_test or lifty_private.test_enabled()));
$$;
create or replace function public.driver_verification(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.profiles p where p.id=p_user and p.is_test)
  and not (auth.uid() is null and coalesce(auth.role(),'service_role')='service_role')
  and not public.can_view_test_account(p_user)
 then '{"identity":"pending","licence":"pending","vehicle":"pending","insurance":"pending"}'::jsonb
 else lifty_private.raw_driver_verification(p_user) end;
$$;
revoke all on function public.driver_verification(uuid) from public,anon;
grant execute on function public.driver_verification(uuid) to authenticated,service_role;
-- Count persisted trips, rather than treating review counts as completed arrangements.
create or replace function lifty_private.driver_trip_stats(p_driver uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('completedTrips',count(*) filter(where i.status='completed'),
  'reliability',case when count(*) filter(where i.status in('completed','cancelled'))>0 then round(100.0*count(*) filter(where i.status='completed')/count(*) filter(where i.status in('completed','cancelled'))) else null end)
 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where l.driver_id=p_driver and i.departs_at<=now();
$$;
create or replace function public.get_driver_trip_stats(p_driver uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.account_active() and public.can_view_test_account(p_driver) then lifty_private.driver_trip_stats(p_driver) else null end;
$$;
revoke all on function public.get_driver_trip_stats(uuid) from public,anon;
grant execute on function public.get_driver_trip_stats(uuid) to authenticated;
create or replace function lifty_private.label_test_driver(j jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid; flag boolean;
begin
 if j is null then return null;end if;
 uid:=nullif(j->'driver'->>'id','')::uuid;
 if uid is null then return j;end if;
 select p.is_test into flag from public.profiles p where p.id=uid;
 return jsonb_set(j,'{driver}',(j->'driver')||jsonb_build_object('isTest',coalesce(flag,false))||lifty_private.driver_trip_stats(uid));
end $$;
create or replace function public.find_matches(p_commute uuid) returns setof jsonb language sql stable security definer set search_path='' as $$
 select lifty_private.label_test_driver(j) from lifty_private.raw_find_matches(p_commute) j where public.can_view_test_leg((j->>'legId')::uuid);
$$;
create or replace function public.match_candidates(p_commute uuid,p_passenger uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb; rows jsonb;
begin
 j:=lifty_private.raw_match_candidates(p_commute,p_passenger);
 select coalesce(jsonb_agg(jsonb_set(c,'{public}',lifty_private.label_test_driver(c->'public'))),'[]') into rows from jsonb_array_elements(j->'candidates') c where public.can_view_test_leg((c->'public'->>'legId')::uuid,p_passenger);
 return jsonb_set(j,'{candidates}',rows);
end $$;
create or replace function public.get_match(p_commute uuid,p_leg uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.can_view_test_leg(p_leg) then lifty_private.label_test_driver(lifty_private.raw_get_match(p_commute,p_leg)) else null end;
$$;
create or replace function public.persist_match_quotes(p_commute uuid,p_passenger uuid,p_signature text,p_matches jsonb,p_leg_signatures jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(p_matches) m where not public.can_view_test_leg((m->>'legId')::uuid,p_passenger)) then raise exception 'Test drivers are unavailable to this account';end if;
 return lifty_private.raw_persist_match_quotes(p_commute,p_passenger,p_signature,p_matches,p_leg_signatures);
end $$;
create or replace function public.request_to_join_quote(p_commute uuid,p_leg uuid,p_quote uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.can_view_test_leg(p_leg) then raise exception 'Test drivers are unavailable to this account';end if;
 return lifty_private.raw_request_to_join_quote(p_commute,p_leg,p_quote);
end $$;
create or replace function public.get_my_clubs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare original jsonb; riders jsonb; drivers jsonb;
begin
 original:=lifty_private.raw_get_my_clubs();
 select coalesce(jsonb_agg(lifty_private.label_test_driver(j)||jsonb_build_object('arrivalTime',(select m.match_snapshot->>'arrivalEta' from public.club_members m where m.leg_id=(j->>'legId')::uuid and m.passenger_id=auth.uid() and m.active))),'[]') into riders from jsonb_array_elements(original->'asPassenger') j where public.can_view_test_leg((j->>'legId')::uuid);
 select coalesce(jsonb_agg(j),'[]') into drivers from jsonb_array_elements(original->'asDriver') j where public.can_view_test_leg((j->>'legId')::uuid);
 return jsonb_build_object('asPassenger',riders,'asDriver',drivers);
end $$;
create or replace function public.get_current_instance() returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb;
begin
 j:=lifty_private.raw_get_current_instance();
 if j is not null and not public.can_view_test_leg((j->>'legId')::uuid) then return null;end if;
 return lifty_private.label_test_driver(j);
end $$;
create or replace function public.get_commute_history() returns setof jsonb language sql stable security definer set search_path='' as $$
 select j from lifty_private.raw_get_commute_history() j where public.can_view_test_leg((j->>'legId')::uuid);
$$;
create or replace function public.list_incoming_requests() returns setof jsonb language sql stable security definer set search_path='' as $$
 select j from lifty_private.raw_list_incoming_requests() j where public.can_view_test_account((j->'passenger'->>'id')::uuid);
$$;
revoke all on all functions in schema lifty_private from public,anon,authenticated;
-- Helpers used by restrictive policies must be executable via an exposed wrapper.
create or replace function public.test_data_visible() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from lifty_private.test_environment e where e.id and (e.mode='local' or (e.mode='staging' and exists(select 1 from lifty_private.testers t where t.user_id=auth.uid()))));
$$;
revoke all on function public.test_data_visible() from public,anon;grant execute on function public.test_data_visible() to authenticated;
alter policy test_visibility on public.pickup_points using(not is_test or public.test_data_visible());
revoke execute on function public.find_matches(uuid),public.driver_approved(uuid) from public,anon,authenticated;
revoke execute on function public.match_candidates(uuid,uuid),public.persist_match_quotes(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.match_candidates(uuid,uuid),public.persist_match_quotes(uuid,uuid,text,jsonb,jsonb) to service_role;
-- Service-only test simulation. Runs only when an operator enables local/staging
-- fixtures. It uses the normal request/status/location APIs as the synthetic driver.
create or replace function public.configure_test_driver(p_driver uuid,p_auto boolean,p_delay int default 5,p_decline_percent int default 0) returns void language plpgsql security definer set search_path='' as $$
begin
 if not lifty_private.test_enabled() or not exists(select 1 from public.profiles where id=p_driver and is_test and role='driver') then raise exception 'Test driver not available';end if;
 if p_delay not between 0 and 3600 or p_decline_percent not between 0 and 100 then raise exception 'Invalid simulator settings';end if;
 insert into lifty_private.test_driver_settings(driver_id,auto_respond,response_delay_seconds,decline_percent) values(p_driver,p_auto,p_delay,p_decline_percent) on conflict(driver_id) do update set auto_respond=excluded.auto_respond,response_delay_seconds=excluded.response_delay_seconds,decline_percent=excluded.decline_percent;
end $$;

-- Notifications remain exact request links after reload, including manual responses.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.respond_to_request(uuid,boolean)'::regprocedure);
 if position('''/p/accepted''' in d)=0 or position('''/p/find''' in d)=0 then raise exception 'respond_to_request definition not recognised; notification links not patched';end if;
 d:=replace(d,'''/p/accepted''','''/p/accepted?request='' || r.id::text');
 d:=replace(d,'''/p/find''','''/p/sent?request='' || r.id::text');execute d;
end $$;

create or replace function public.begin_test_trip(p_request uuid,p_duration_seconds int default 90) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.join_requests;l public.driver_legs;i uuid;m public.club_members;start_point extensions.geometry;end_point extensions.geometry;a float8;b float8;
begin
 select * into r from public.join_requests where id=p_request and status='accepted';
 select * into l from public.driver_legs where id=r.leg_id;
 if not lifty_private.test_enabled() or not exists(select 1 from public.profiles where id=l.driver_id and is_test) or not public.can_view_test_leg(l.id,r.passenger_id) then raise exception 'Only an accepted test-driver request can be simulated';end if;
 if p_duration_seconds not between 30 and 3600 then raise exception 'Use a simulation duration between 30 and 3600 seconds';end if;
 select * into m from public.club_members where leg_id=l.id and passenger_id=r.passenger_id and active and not paused;
 if m.id is null then raise exception 'Test membership is unavailable';end if;
 a:=extensions.st_linelocatepoint(l.route::extensions.geometry,m.pickup::extensions.geometry);
 end_point:=extensions.st_setsrid(extensions.st_makepoint((r.agreement->'destination'->>'lng')::float8,(r.agreement->'destination'->>'lat')::float8),4326);
 b:=extensions.st_linelocatepoint(l.route::extensions.geometry,coalesce(end_point,l.destination::extensions.geometry));
 if b<=a then raise exception 'Test route does not go from pickup to destination';end if;
 -- The simulated driver is already on the way, so the trip departs "now". A departure in the future would let the production
 -- schedule reconciler (it cancels not-yet-departed trips on days a leg does not run) cancel the trip on weekends.
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at,status)
 values(l.id,(now() at time zone 'Africa/Johannesburg')::date,now(),now()-interval '5 seconds',now()+make_interval(secs=>p_duration_seconds+120),'sharing')
 on conflict(leg_id,service_date) do update set departs_at=excluded.departs_at,sharing_starts_at=excluded.sharing_starts_at,sharing_ends_at=excluded.sharing_ends_at,status='sharing',started_at=null,completed_at=null,driver_arrived_at=null returning id into i;
 insert into public.instance_riders(instance_id,passenger_id,status,pickup_label,pickup,pickup_time)
 values(i,r.passenger_id,'expected',m.pickup_label,m.pickup,m.pickup_time) on conflict(instance_id,passenger_id) do update set status='expected',driver_arrived_at=null,collected_at=null,no_show_at=null,at_pickup_at=null,pickup_label=excluded.pickup_label,pickup=excluded.pickup;
 insert into lifty_private.test_trips(instance_id,duration_seconds,pickup_fraction,destination_fraction) values(i,p_duration_seconds,a,b) on conflict(instance_id) do update set started_at=now(),duration_seconds=excluded.duration_seconds,state='approaching',pickup_fraction=a,destination_fraction=b;
 insert into public.notifications(user_id,kind,title,body,link,source_instance_id)
 values(r.passenger_id,'test_trip','Test commute starting','This is a simulated trip with a clearly labelled test driver.','/p/commute',i);
 return i;
end $$;

create or replace function public.advance_test_simulation() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;t record;pos extensions.geometry;elapsed float8;fraction float8;accept boolean;responses int:=0;positions int:=0;completed int:=0;original_sub text:=current_setting('request.jwt.claim.sub',true);original_claims text:=current_setting('request.jwt.claims',true);p uuid;
begin
 if not lifty_private.test_enabled() then return jsonb_build_object('disabled',true);end if;
 for r in select jr.*,l.driver_id,s.decline_percent from public.join_requests jr join public.driver_legs l on l.id=jr.leg_id join public.profiles d on d.id=l.driver_id join lifty_private.test_driver_settings s on s.driver_id=d.id where jr.status='pending' and d.is_test and s.auto_respond and jr.created_at<=now()-make_interval(secs=>s.response_delay_seconds) and public.can_view_test_leg(l.id,jr.passenger_id) order by jr.created_at for update of jr skip locked loop
  perform set_config('request.jwt.claim.sub',r.driver_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',r.driver_id,'role','authenticated')::text,true);
  accept:=mod(abs(hashtext(r.id::text)::bigint),100)>=r.decline_percent;
  begin perform public.respond_to_request(r.id,accept);responses:=responses+1;
  exception when others then
   -- A competing final-seat request or changed agreement fails through normal validation.
   update public.join_requests set status='declined',responded_at=now() where id=r.id and status='pending';
   perform public.notify(r.passenger_id,'declined','Test driver unavailable','The simulated driver could not accept this request. Try another lift club.','/p/sent?request='||r.id);
  end;
 end loop;
 -- A driver set to manual is left to the person driving: the server does not move, arrive or collect on their behalf.
 for t in select tt.*,l.driver_id,l.route from lifty_private.test_trips tt join public.commute_instances i on i.id=tt.instance_id join public.driver_legs l on l.id=i.leg_id join public.profiles d on d.id=l.driver_id join lifty_private.test_driver_settings s on s.driver_id=d.id where tt.state<>'completed' and d.is_test and s.auto_respond and i.status in('sharing','underway') for update of tt skip locked loop
  perform set_config('request.jwt.claim.sub',t.driver_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',t.driver_id,'role','authenticated')::text,true);
  elapsed:=extract(epoch from now()-t.started_at)/t.duration_seconds;
  if elapsed<0.30 then
   fraction:=greatest(0,t.pickup_fraction-0.02)+least(1,elapsed/0.30)*(t.pickup_fraction-greatest(0,t.pickup_fraction-0.02));
  elsif elapsed<0.45 then
   fraction:=t.pickup_fraction;
   if t.state='approaching' then
    for p in select passenger_id from public.instance_riders where instance_id=t.instance_id and status in('expected','at_pickup') loop perform public.mark_driver_arrived(t.instance_id,p);perform public.notify(p,'arrived','Your test driver has arrived','The simulated driver is at the agreed pickup.','/p/commute');end loop;
    update lifty_private.test_trips set state='arrived' where instance_id=t.instance_id;
   end if;
  else
   if t.state in('approaching','arrived') then
    for p in select passenger_id from public.instance_riders where instance_id=t.instance_id and status in('expected','at_pickup') loop perform public.mark_driver_arrived(t.instance_id,p);perform public.mark_rider_status(t.instance_id,p,'collected');end loop;
    update lifty_private.test_trips set state='underway' where instance_id=t.instance_id;
   end if;
   fraction:=t.pickup_fraction+least(1,(elapsed-0.45)/0.55)*(t.destination_fraction-t.pickup_fraction);
  end if;
  pos:=extensions.st_lineinterpolatepoint(t.route::extensions.geometry,least(1,greatest(0,fraction)));
  begin perform public.publish_location(t.instance_id,extensions.st_x(pos),extensions.st_y(pos),null,case when elapsed<0.45 then 5 else 14 end);positions:=positions+1;
  exception when others then null; -- consent withdrawal, cancelled membership or sharing expiry stops publications
  end;
  if elapsed>=1 then
   perform public.complete_instance(t.instance_id);update lifty_private.test_trips set state='completed' where instance_id=t.instance_id;completed:=completed+1;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);perform set_config('request.jwt.claims',coalesce(original_claims,'{}'),true);
 return jsonb_build_object('responses',responses,'positions',positions,'completed',completed);
end $$;
revoke all on function public.configure_test_driver(uuid,boolean,int,int),public.begin_test_trip(uuid,int),public.advance_test_simulation() from public,anon,authenticated;
grant execute on function public.configure_test_driver(uuid,boolean,int,int),public.begin_test_trip(uuid,int),public.advance_test_simulation() to service_role;
create policy test_visibility on public.notifications as restrictive for select to authenticated using(not is_test or public.test_data_visible());

-- Background reminders carry their trip context even when there is no JWT actor.
create or replace function public.queue_commute_reminders() returns void language plpgsql security definer set search_path='' as $$
declare target record;added int;
begin
 for target in
  select i.id,r.passenger_id user_id,'/p/track' link from public.commute_instances i join public.instance_riders r on r.instance_id=i.id
  where i.status in('scheduled','sharing') and now() between i.sharing_starts_at and i.departs_at and r.status in('expected','at_pickup') and public.can_view_test_instance(i.id,r.passenger_id)
  union select i.id,l.driver_id,'/d/today' from public.commute_instances i join public.driver_legs l on l.id=i.leg_id
  where i.status in('scheduled','sharing') and now() between i.sharing_starts_at and i.departs_at and public.can_view_test_instance(i.id,l.driver_id)
 loop
  insert into lifty_private.trip_reminders values(target.id,target.user_id) on conflict do nothing;get diagnostics added=row_count;
  if added>0 then insert into public.notifications(user_id,kind,title,body,link,source_instance_id)
   values(target.user_id,'reminder','Your commute window is open','Open Lifty to check today''s pickup.',target.link,target.id);end if;
 end loop;
end $$;
revoke all on function public.queue_commute_reminders() from public,anon,authenticated;
-- Tag old reminder rows with their existing private deduplication context too.
update public.notifications n set source_instance_id=t.instance_id
 from lifty_private.trip_reminders t join public.commute_instances i on i.id=t.instance_id join public.driver_legs l on l.id=i.leg_id join public.profiles p on p.id=l.driver_id
 where n.kind='reminder' and t.user_id=n.user_id and p.is_test and n.created_at between i.sharing_starts_at and i.departs_at;

-- Fixture notifications stay in-app. The production Firebase worker never dispatches
-- simulated people/trips, including previously leased jobs after a mode/allowlist change.
create or replace function public.claim_pilot_work(p_push_ready boolean) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare job record;fence uuid;
begin
 update lifty_private.worker_health set last_seen=now(),push_configured=p_push_ready,last_error=null where id;
 for job in select * from lifty_private.cleanup_jobs where next_attempt_at<=now() and (status='pending' or(status='processing' and leased_until<now())) and attempts<10 order by created_at limit 10 for update skip locked loop
  fence:=gen_random_uuid();update lifty_private.cleanup_jobs set status='processing',attempts=attempts+1,lease=fence,leased_until=now()+interval '5 minutes' where id=job.id;
  return next jsonb_build_object('kind','cleanup','id',job.id,'lease',fence,'files',job.files);
 end loop;
 update lifty_private.notification_outbox o set status='blocked',last_error='Test notifications are in-app only',lease=null,leased_until=null
 from public.notifications n join public.profiles p on p.id=n.user_id where o.id=n.id and (n.is_test or p.is_test) and o.status<>'sent';
 if not p_push_ready then update lifty_private.notification_outbox set status='blocked',last_error='Firebase not configured' where status in('pending','no_device');return;end if;
 for job in select o.* from lifty_private.notification_outbox o join public.notifications n on n.id=o.id join public.profiles p on p.id=n.user_id
  where not n.is_test and not p.is_test and p.suspended_at is null and p.deletion_requested_at is null and next_attempt_at<=now() and attempts<6 and (status in('pending','blocked','no_device') or(status='processing' and leased_until<now())) order by next_attempt_at limit 10 for update of o skip locked loop
  if not exists(select 1 from public.push_tokens t join public.notifications n on n.user_id=t.user_id where n.id=job.id and not t.is_test and t.platform='android') then update lifty_private.notification_outbox set status='no_device',next_attempt_at=now()+interval '1 hour',last_error='No Android push destination' where id=job.id;continue;end if;
  fence:=gen_random_uuid();update lifty_private.notification_outbox set status='processing',attempts=attempts+1,lease=fence,leased_until=now()+interval '5 minutes' where id=job.id;
  return next (select jsonb_build_object('kind','push','id',n.id,'lease',fence,'title',n.title,'body',n.body,'link',n.link,
   'tokens',(select coalesce(jsonb_agg(jsonb_build_object('token',t.token,'hash',encode(extensions.digest(t.token,'sha256'),'hex'))),'[]') from public.push_tokens t where t.user_id=n.user_id and not t.is_test and t.platform='android' and not exists(select 1 from lifty_private.push_receipts r where r.notification_id=n.id and r.token_hash=encode(extensions.digest(t.token,'sha256'),'hex')))) from public.notifications n where n.id=job.id);
 end loop;
end $$;
create or replace function public.can_dispatch_push(p_id uuid,p_lease uuid,p_hash text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from lifty_private.notification_outbox o join public.notifications n on n.id=o.id join public.profiles p on p.id=n.user_id join public.push_tokens t on t.user_id=p.id
 where o.id=p_id and o.lease=p_lease and o.status='processing' and o.leased_until>now() and not n.is_test and not p.is_test and not t.is_test and p.suspended_at is null and p.deletion_requested_at is null and t.platform='android' and encode(extensions.digest(t.token,'sha256'),'hex')=p_hash);
$$;
revoke all on function public.claim_pilot_work(boolean),public.can_dispatch_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_pilot_work(boolean),public.can_dispatch_push(uuid,uuid,text) to service_role;
