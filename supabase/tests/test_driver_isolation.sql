-- Local sandbox only. Existing seeded drivers stay untouched; every change below rolls back.
begin;
select set_config('lifty.isolation_checks','0',true);
create function public.lifty_isolation_assert(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Test isolation: %',label;end if;
perform set_config('lifty.isolation_checks',(current_setting('lifty.isolation_checks')::int+1)::text,true);end $$;
do $$ declare u uuid:=gen_random_uuid();c uuid;begin
 insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
 insert into public.profiles(id,role,first_name,last_initial) values(u,'passenger','Isolation','T');
 insert into public.profile_private(id,terms_accepted_at,location_consent_at) values(u,now(),now());
 insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,window_min,max_walk_m,start_date)
 values(u,'to_work','Salt Rock',extensions.st_setsrid(extensions.st_makepoint(31.234003,-29.488331),4326)::extensions.geography,'Umhlanga',extensions.st_setsrid(extensions.st_makepoint(31.076244,-29.739187),4326)::extensions.geography,'{0,1,2,3,4}','08:00',15,750,(now() at time zone 'Africa/Johannesburg')::date+1) returning id into c;
 perform set_config('lifty.isolation_viewer',u::text,true);perform set_config('lifty.isolation_commute',c::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
select public.lifty_isolation_assert((select count(*)=20 from public.profiles where is_test and role='driver'),'20 labelled drivers');
select public.lifty_isolation_assert((select count(*)=80 and bool_and(is_test) from public.verification_documents where user_id::text like 'e0000000-0000-4000-8000-%'),'all synthetic documents tagged');
select public.lifty_isolation_assert((select bool_and(is_test) from public.vehicles where driver_id::text like 'e0000000-0000-4000-8000-%'),'all synthetic vehicles tagged');
select public.lifty_isolation_assert((select bool_and(is_test) from public.ratings where ratee_id::text like 'e0000000-0000-4000-8000-%'),'all synthetic reviews tagged');
select public.lifty_isolation_assert(not has_function_privilege('authenticated','public.advance_test_simulation()','execute') and not has_function_privilege('anon','public.advance_test_simulation()','execute'),'simulator is server-only');
select public.lifty_isolation_assert(not has_function_privilege('authenticated','public.begin_test_trip(uuid,integer)','execute') and not has_function_privilege('authenticated','public.configure_test_driver(uuid,boolean,integer,integer)','execute'),'test controls are server-only');
select public.lifty_isolation_assert(not has_function_privilege('authenticated','lifty_private.raw_match_candidates(uuid,uuid)','execute') and not has_function_privilege('authenticated','lifty_private.raw_get_match(uuid,uuid)','execute'),'private copies cannot bypass wrappers');
select public.lifty_isolation_assert(not has_function_privilege('authenticated','public.match_candidates(uuid,uuid)','execute') and not has_function_privilege('anon','public.match_candidates(uuid,uuid)','execute'),'road candidate pool is service-only');
select public.lifty_isolation_assert(not has_table_privilege('authenticated','lifty_private.testers','insert') and not has_table_privilege('authenticated','lifty_private.test_environment','update'),'clients cannot enable fixtures or allowlist themselves');

update lifty_private.test_environment set mode='disabled';
set local role authenticated;
select public.lifty_isolation_assert((select count(*)=0 from public.profiles where is_test),'production default hides profiles');
select public.lifty_isolation_assert((select count(*)=0 from public.vehicles where is_test),'production default hides vehicles');
select public.lifty_isolation_assert((select count(*)=0 from public.ratings where is_test),'production default hides reviews');
select public.lifty_isolation_assert((select count(*)=0 from public.pickup_points where is_test),'production default hides pickup fixtures');
select public.lifty_isolation_assert(public.get_match(current_setting('lifty.isolation_commute')::uuid,'e0000000-0000-4000-8000-000000001011') is null,'production get_match cannot recover hidden quote');
select public.lifty_isolation_assert(public.account_active(),'production normal account remains active');
do $$ begin
 begin perform public.request_to_join_quote(current_setting('lifty.isolation_commute')::uuid,'e0000000-0000-4000-8000-000000001011',gen_random_uuid());raise exception 'Hidden test driver booking was accepted';
 exception when others then if sqlerrm not like 'Test drivers are unavailable%' then raise;end if;perform public.lifty_isolation_assert(true,'production booking cannot bypass the test visibility gate');end;
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000101',true);
 perform set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000101","role":"authenticated"}',true);
 begin perform public.get_account_snapshot();raise exception 'Disabled test account snapshot was restored';
 exception when others then if sqlerrm not like 'Test accounts are unavailable%' then raise;end if;perform public.lifty_isolation_assert(true,'disabled test-account login cannot hydrate fixture profile');end;
 perform set_config('request.jwt.claim.sub',current_setting('lifty.isolation_viewer'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.isolation_viewer'),'role','authenticated')::text,true);
end $$;
reset role;
select public.lifty_isolation_assert(jsonb_array_length(public.match_candidates(current_setting('lifty.isolation_commute')::uuid,current_setting('lifty.isolation_viewer')::uuid)->'candidates')=0,'definer road candidates hidden with mode off');

update lifty_private.test_environment set mode='staging';
select public.lifty_isolation_assert(jsonb_array_length(public.match_candidates(current_setting('lifty.isolation_commute')::uuid,current_setting('lifty.isolation_viewer')::uuid)->'candidates')=0,'staging visitor cannot match fixtures');
set local role authenticated;
select public.lifty_isolation_assert((select count(*)=0 from public.profiles where is_test),'staging visitor cannot select profiles');
reset role;
insert into lifty_private.testers(user_id) values(current_setting('lifty.isolation_viewer')::uuid);
select public.lifty_isolation_assert(jsonb_array_length(public.match_candidates(current_setting('lifty.isolation_commute')::uuid,current_setting('lifty.isolation_viewer')::uuid)->'candidates')>0,'allowlisted staging tester gets candidates');
set local role authenticated;
select public.lifty_isolation_assert((select count(*)=20 from public.profiles where is_test and role='driver'),'allowlisted staging tester gets profiles');
select public.lifty_isolation_assert((select count(*)>0 from public.pickup_points where is_test),'allowlisted staging tester gets pickup fixtures');
reset role;

update lifty_private.test_environment set mode='local';
select public.lifty_isolation_assert((select bool_and((c->'public'->'driver'->>'isTest')::boolean) from jsonb_array_elements(public.match_candidates(current_setting('lifty.isolation_commute')::uuid,current_setting('lifty.isolation_viewer')::uuid)->'candidates') c),'every match labels the synthetic driver');
select public.lifty_isolation_assert((select count(*)>0 from jsonb_array_elements(public.get_estimated_match_quotes(current_setting('lifty.isolation_commute')::uuid)) q where q->>'routing'='estimate'),'fallback is explicitly estimated');
select jsonb_build_object('suite','test-driver-isolation','passed',current_setting('lifty.isolation_checks')::int,'failed',0,'fixtures','rolled back');
rollback;
