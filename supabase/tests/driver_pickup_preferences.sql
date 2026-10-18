-- Local Lifty sandbox only; all fixture records and assertions roll back.
begin;
select set_config('lifty.pickup_checks','0',true);
create function public.pickup_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if not coalesce(ok,false) then raise exception 'Driver pickup: %',label;end if;
 perform set_config('lifty.pickup_checks',(current_setting('lifty.pickup_checks')::int+1)::text,true);
end $$;
create function public.pickup_expect_error(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;raise exception 'Expected rejection did not occur';
 exception when others then if sqlerrm not like expected then raise;end if;end;
 perform public.pickup_assert(true,label);
end $$;
do $$ declare u uuid;d uuid:=gen_random_uuid();p uuid:=gen_random_uuid();o uuid:=gen_random_uuid();l uuid:=gen_random_uuid();c uuid;point uuid;begin
 perform set_config('lifty.pickup_driver',d::text,true);perform set_config('lifty.pickup_passenger',p::text,true);perform set_config('lifty.pickup_other',o::text,true);
 foreach u in array array[d,p,o] loop
  insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
   values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
  insert into public.profiles(id,role,first_name,last_initial) values(u,case when u=d then 'driver'::public.user_role else 'passenger'::public.user_role end,'Pickup','T');
  insert into public.profile_private(id,last_name,terms_accepted_at) values(u,'Tester',now());
 end loop;
 insert into public.vehicles(driver_id,make,model,year,colour,registration_summary,seats_total,status)
  values(d,'Volkswagen','Polo Vivo',2024,'Silver','ND TEST 123',4,'verified');
 insert into public.verification_documents(user_id,kind,storage_path,status,expires_on)
  select d,k::public.doc_kind,d||'/'||k||'.pdf','verified',current_date+30 from unnest(array['id','licence','vehicle_registration','insurance'])k;
 insert into public.driver_legs(id,driver_id,direction,origin_label,origin,destination_label,destination,route,
  route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution)
 values(l,d,'to_work','Home',extensions.st_geogfromtext('POINT(31.02 -29.88)'),
  'Office',extensions.st_geogfromtext('POINT(31.08 -29.82)'),extensions.st_geogfromtext('LINESTRING(31.02 -29.88,31.04 -29.86,31.08 -29.82)'),
  10000,1800,'07:00','{0,1,2,3,4,5,6}',4,15,100);
 perform set_config('lifty.pickup_leg',l::text,true);
 insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,window_min,max_walk_m,start_date)
 values(p,'to_work','Passenger home',extensions.st_geogfromtext('POINT(31.042 -29.855)'),
  'Passenger work',extensions.st_geogfromtext('POINT(31.075 -29.825)'),'{0,1,2,3,4,5,6}','08:00',30,1000,current_date+1) returning id into c;
 perform set_config('lifty.pickup_commute',c::text,true);
 insert into public.pickup_points(name,area,location) values('Pickup test meeting stop','Driver pickup QA',extensions.st_geogfromtext('POINT(31.04 -29.86)')) returning id into point;
 perform set_config('lifty.pickup_point',point::text,true);
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated')::text,true);
end $$;

select public.pickup_assert((select pickup_policy='flexible' from public.driver_legs where id=current_setting('lifty.pickup_leg')::uuid),'existing offers default to flexible');
select public.pickup_assert(not has_function_privilege('anon','public.update_profile_name(text)','execute'),'anonymous name changes denied');
select public.pickup_assert(not has_function_privilege('anon','public.save_driver_settings(uuid,int,int,int,time,smallint[],text)','execute'),'anonymous settings denied');
select public.pickup_assert(not has_function_privilege('authenticated','lifty_private.pickup_candidates(uuid,public.passenger_commutes)','execute'),'pickup helper remains private');
select public.pickup_assert(not has_column_privilege('authenticated','public.driver_legs','pickup_policy','update'),'direct policy writes cannot bypass validated RPC');

set local role authenticated;
select public.save_driver_onboarding_draft('{"step":2,"commute":{"pickupPolicy":"meeting_point","maxDeviationMin":15}}');
select public.pickup_assert(public.get_driver_onboarding_draft()->'commute'->>'pickupPolicy'='meeting_point','pickup preference survives interrupted onboarding');
select public.pickup_expect_error($q$select public.save_driver_onboarding_draft('{"commute":{"pickupPolicy":"anywhere"}}')$q$,'%Invalid draft pickup preference%','invalid draft policy rejected');
select public.pickup_expect_error($q$select public.save_driver_onboarding_draft('{"commute":{"pickupPolicy":true}}')$q$,'%Invalid draft pickup preference%','draft policy must be text');
select public.save_driver_settings(current_setting('lifty.pickup_leg')::uuid,4,15,100,p_pickup_policy=>'meeting_point');
select public.pickup_assert((public.get_account_snapshot()->'legs'->0->>'pickup_policy')='meeting_point','account snapshot restores selected policy');
select public.pickup_assert((select j->>'pickupPolicy'='meeting_point' from jsonb_array_elements(public.get_my_clubs()->'asDriver')j where j->>'legId'=current_setting('lifty.pickup_leg')),'driver club snapshot exposes selected policy');
select public.save_driver_settings(current_setting('lifty.pickup_leg')::uuid,4,14,100);
select public.pickup_assert((public.get_account_snapshot()->'legs'->0->>'pickup_policy')='meeting_point','older settings client preserves saved policy');
select public.pickup_expect_error('select public.save_driver_settings('''||current_setting('lifty.pickup_leg')||''',4,15,100,p_pickup_policy=>''anywhere'')','%Invalid pickup preference%','settings reject unknown policy');
select public.pickup_assert((public.get_account_snapshot()->'legs'->0->>'max_deviation_min')='14','rejected save does not change detour');
select public.pickup_expect_error('select public.save_driver_settings('''||current_setting('lifty.pickup_leg')||''',4,31,100)','%max_deviation_min%','detour cannot exceed server limit');
select public.pickup_expect_error('select public.save_driver_settings('''||current_setting('lifty.pickup_leg')||''',5,14,100)','%Seat limit%','policy RPC retains vehicle seat guard');
select public.pickup_expect_error('select public.save_driver_settings('''||current_setting('lifty.pickup_leg')||''',4,14,100000)','%Contribution exceeds%','policy RPC retains contribution cap');
select set_config('lifty.pickup_return',public.upsert_driver_leg('to_home','Office',31.08,-29.82,'Home',31.02,-29.88,
 '{"type":"LineString","coordinates":[[31.08,-29.82],[31.04,-29.86],[31.02,-29.88]]}',10000,1800,'17:00','{0,1,2,3,4,5,6}',4,8,100,'door_to_door')::text,true);
select public.pickup_assert((select pickup_policy='door_to_door' from public.driver_legs where id=current_setting('lifty.pickup_return')::uuid),'initial route publication persists selected policy');
select public.upsert_driver_leg('to_home','Office',31.08,-29.82,'Home',31.02,-29.88,
 '{"type":"LineString","coordinates":[[31.08,-29.82],[31.04,-29.86],[31.02,-29.88]]}',10000,1800,'17:00','{0,1,2,3,4,5,6}',4,8,100);
select public.pickup_assert((select pickup_policy='door_to_door' from public.driver_legs where id=current_setting('lifty.pickup_return')::uuid),'legacy publication signature preserves saved preference');
reset role;

-- Road and fallback matching use the same point policy. The passenger permits
-- a walk, but door-to-door still resolves to their origin, never a random stop.
update public.driver_legs set pickup_policy='door_to_door' where id=current_setting('lifty.pickup_leg')::uuid;
select public.pickup_assert((select count(*)=1 and bool_and(extensions.st_equals(x.pt::extensions.geometry,c.origin::extensions.geometry))
 from public.passenger_commutes c cross join lateral lifty_private.pickup_candidates(current_setting('lifty.pickup_leg')::uuid,c)x
 where c.id=current_setting('lifty.pickup_commute')::uuid),'door-to-door offers only passenger origin even when walking allowed');
select public.pickup_assert((select j->'public'->>'pickupPolicy'='door_to_door' and j->'public'->'pickup'->>'label'='Your street'
 from jsonb_array_elements(public.match_candidates(current_setting('lifty.pickup_commute')::uuid,current_setting('lifty.pickup_passenger')::uuid)->'candidates')j
 where j->'public'->>'legId'=current_setting('lifty.pickup_leg')),'road candidate keeps exact origin pickup and policy');
select set_config('request.jwt.claim.sub',current_setting('lifty.pickup_passenger'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.pickup_passenger'),'role','authenticated')::text,true);
set local role authenticated;
select public.pickup_assert((select j->>'pickupPolicy'='door_to_door' and (j->>'walkingDistanceM')::int=0
 from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.pickup_commute')::uuid))j where j->>'legId'=current_setting('lifty.pickup_leg')),'estimated search keeps door pickup and zero walking');
select public.pickup_expect_error('select public.save_driver_settings('''||current_setting('lifty.pickup_leg')||''',4,15,100,p_pickup_policy=>''flexible'')','%Not your commute%','passenger cannot alter driver preference');
reset role;
update public.driver_legs set pickup_policy='meeting_point' where id=current_setting('lifty.pickup_leg')::uuid;
select public.pickup_assert((select count(*)>=1 and bool_and(x.label<>'Your street' and x.label not like 'On % route')
 from public.passenger_commutes c cross join lateral lifty_private.pickup_candidates(current_setting('lifty.pickup_leg')::uuid,c)x
 where c.id=current_setting('lifty.pickup_commute')::uuid),'meeting-point policy never invents roadside or home pickup');
select public.pickup_assert((select j->'public'->>'pickupPolicy'='meeting_point' and j->'public'->'pickup'->>'label'='Pickup test meeting stop'
 from jsonb_array_elements(public.match_candidates(current_setting('lifty.pickup_commute')::uuid,current_setting('lifty.pickup_passenger')::uuid)->'candidates')j
 where j->'public'->>'legId'=current_setting('lifty.pickup_leg')),'road search uses managed meeting point');
set local role authenticated;
select public.pickup_assert((select j->'pickup'->>'label'='Pickup test meeting stop' from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.pickup_commute')::uuid))j
 where j->>'legId'=current_setting('lifty.pickup_leg')),'estimated search uses same managed meeting point');
reset role;
update public.passenger_commutes set max_walk_m=0 where id=current_setting('lifty.pickup_commute')::uuid;
select public.pickup_assert(not exists(select 1 from jsonb_array_elements(public.match_candidates(current_setting('lifty.pickup_commute')::uuid,current_setting('lifty.pickup_passenger')::uuid)->'candidates')j
 where j->'public'->>'legId'=current_setting('lifty.pickup_leg')),'meeting point cannot override passenger zero walking preference');
set local role authenticated;
select public.pickup_assert(not exists(select 1 from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.pickup_commute')::uuid))j
 where j->>'legId'=current_setting('lifty.pickup_leg')),'fallback also respects passenger zero walking preference');
reset role;
update public.passenger_commutes set max_walk_m=1000 where id=current_setting('lifty.pickup_commute')::uuid;
delete from public.pickup_points where id=current_setting('lifty.pickup_point')::uuid;
select public.pickup_assert(not exists(select 1 from public.passenger_commutes c cross join lateral lifty_private.pickup_candidates(current_setting('lifty.pickup_leg')::uuid,c)x
 where c.id=current_setting('lifty.pickup_commute')::uuid),'no named point means no meeting-point match');
update public.driver_legs set pickup_policy='flexible' where id=current_setting('lifty.pickup_leg')::uuid;
select public.pickup_assert(exists(select 1 from public.passenger_commutes c cross join lateral lifty_private.pickup_candidates(current_setting('lifty.pickup_leg')::uuid,c)x
 where c.id=current_setting('lifty.pickup_commute')::uuid and x.label like 'On % route'),'flexible preserves inferred route pickup behaviour');
select public.pickup_assert(exists(select 1 from public.passenger_commutes c cross join lateral lifty_private.pickup_candidates(current_setting('lifty.pickup_leg')::uuid,c)x
 where c.id=current_setting('lifty.pickup_commute')::uuid and x.label='Your street'),'flexible includes passenger origin as alternative');

-- Quotes and pending requests cannot silently reuse a previous pickup policy.
set local role authenticated;
select set_config('lifty.pickup_quote',(select j->>'quoteId' from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.pickup_commute')::uuid))j
 where j->>'legId'=current_setting('lifty.pickup_leg')),true);
reset role;
update public.driver_legs set pickup_policy='door_to_door' where id=current_setting('lifty.pickup_leg')::uuid;
set local role authenticated;
select public.pickup_expect_error('select public.request_to_join_quote('''||current_setting('lifty.pickup_commute')||''','''||current_setting('lifty.pickup_leg')||''','''||current_setting('lifty.pickup_quote')||''')',
 '%changed or expired%','policy edit invalidates previously shown quote');
select set_config('lifty.pickup_quote',(select j->>'quoteId' from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.pickup_commute')::uuid))j
 where j->>'legId'=current_setting('lifty.pickup_leg')),true);
select set_config('lifty.pickup_request',public.request_to_join_quote(current_setting('lifty.pickup_commute')::uuid,current_setting('lifty.pickup_leg')::uuid,current_setting('lifty.pickup_quote')::uuid)::text,true);
select public.pickup_assert((select agreement->>'pickupPolicy'='door_to_door' from public.join_requests where id=current_setting('lifty.pickup_request')::uuid),'requested policy stored in immutable agreement');
reset role;
update public.driver_legs set pickup_policy='meeting_point' where id=current_setting('lifty.pickup_leg')::uuid;
select set_config('request.jwt.claim.sub',current_setting('lifty.pickup_driver'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.pickup_driver'),'role','authenticated')::text,true);
set local role authenticated;
select public.pickup_expect_error('select public.respond_to_request('''||current_setting('lifty.pickup_request')||''',true)','%Pickup preference changed%','driver cannot accept stale pickup policy request');
reset role;
update public.driver_legs set pickup_policy='door_to_door' where id=current_setting('lifty.pickup_leg')::uuid;
set local role authenticated;
select public.respond_to_request(current_setting('lifty.pickup_request')::uuid,true);
select set_config('lifty.pickup_agreement',(select agreement::text from public.club_members where leg_id=current_setting('lifty.pickup_leg')::uuid and passenger_id=current_setting('lifty.pickup_passenger')::uuid),true);
select public.save_driver_settings(current_setting('lifty.pickup_leg')::uuid,4,15,100,p_pickup_policy=>'meeting_point');
select public.pickup_assert((select agreement::text=current_setting('lifty.pickup_agreement') and active from public.club_members where leg_id=current_setting('lifty.pickup_leg')::uuid and passenger_id=current_setting('lifty.pickup_passenger')::uuid),'changing preference preserves accepted arrangement');
select public.pickup_assert((select agreement->>'pickupPolicy'='door_to_door' and pickup_label='Your street' from public.club_members where leg_id=current_setting('lifty.pickup_leg')::uuid and passenger_id=current_setting('lifty.pickup_passenger')::uuid),'existing passenger keeps agreed door pickup');

-- Name changes preserve private surname, reject malformed/anonymous calls, and
-- request a human identity review only when the legal name genuinely changes.
select public.pickup_assert(public.update_profile_name('  Pickup   Tester  ')->>'identity'='verified','normalizing same name retains identity approval');
select public.pickup_assert(public.update_profile_name('Nomsa Dlamini')->>'identity'='pending','changed legal name requires renewed identity review');
select public.pickup_assert(public.get_account_snapshot()->'profile'->>'first_name'='Nomsa' and public.get_account_snapshot()->'private'->>'last_name'='Dlamini','name reload retains first name and private surname');
select public.pickup_assert(public.get_account_snapshot()->'profile'->>'last_initial'='D','only surname initial is public');
select public.pickup_expect_error($q$select public.update_profile_name('Nomsa')$q$,'%first name and surname%','name requires surname');
select public.pickup_expect_error($q$select public.update_profile_name(repeat('x',121))$q$,'%Enter your full name%','name length is bounded');
reset role;
select public.pickup_assert((select first_name='Pickup' from public.profiles where id=current_setting('lifty.pickup_other')::uuid),'name RPC never changes another account');
select public.pickup_assert((select bool_and(status='verified') from public.verification_documents where user_id=current_setting('lifty.pickup_driver')::uuid and kind<>'id'),'name change preserves unrelated vehicle/licence evidence');
update public.verification_documents set status='verified' where user_id=current_setting('lifty.pickup_driver')::uuid and kind='id';
set local role authenticated;
update public.profiles set first_name='Changed' where id=current_setting('lifty.pickup_driver')::uuid;
select public.pickup_assert(public.driver_verification(current_setting('lifty.pickup_driver')::uuid)->>'identity'='pending','direct public name write cannot retain stale identity approval');
reset role;
update public.verification_documents set status='verified' where user_id=current_setting('lifty.pickup_driver')::uuid and kind='id';
set local role authenticated;
update public.profile_private set last_name='Changed surname' where id=current_setting('lifty.pickup_driver')::uuid;
select public.pickup_assert(public.driver_verification(current_setting('lifty.pickup_driver')::uuid)->>'identity'='pending','direct private surname write cannot retain stale identity approval');
reset role;
update public.profiles set suspended_at=now() where id=current_setting('lifty.pickup_driver')::uuid;
set local role authenticated;
select public.pickup_expect_error($q$select public.update_profile_name('Another Name')$q$,'%Sign in to update your name%','suspended account cannot change name');
reset role;
select jsonb_build_object('suite','driver-pickup-preferences','passed',current_setting('lifty.pickup_checks')::int,'failed',0);
rollback;
