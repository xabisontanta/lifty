-- Run through the local safety runner, which substitutes the exact guarded cleanup file.
-- All mode, notification, cleanup, and account changes roll back.
begin;
select set_config('lifty.safety_checks','0',true);
create function public.lifty_safety_assert(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Test safety: %',label;end if;
perform set_config('lifty.safety_checks',(current_setting('lifty.safety_checks')::int+1)::text,true);end $$;
do $$ declare environment text;marker text;begin
 for environment,marker in values('disabled','LOCAL_LIFTY_ONLY'),('disabled','STAGING_LIFTY_ONLY'),('local',''),('local','STAGING_LIFTY_ONLY'),('staging','LOCAL_LIFTY_ONLY') loop
  update lifty_private.test_environment set mode=environment;
  perform set_config('lifty.nonproduction_seed',marker,true);
  begin perform lifty_private.authorize_test_seed();raise exception 'Unconfirmed seed was accepted';
  exception when others then if sqlerrm not like 'Seed refused:%' then raise;end if;
  perform public.lifty_safety_assert(true,'seed requires an already-enabled matching target: '||environment||'/'||marker);end;
 end loop;
 for environment,marker in values('local','LOCAL_LIFTY_ONLY'),('staging','STAGING_LIFTY_ONLY') loop
  update lifty_private.test_environment set mode=environment;perform set_config('lifty.nonproduction_seed',marker,true);
  perform lifty_private.authorize_test_seed();
  perform public.lifty_safety_assert((select mode=environment from lifty_private.test_environment where id),'confirmed seed preserves '||environment||' mode');
 end loop;
end $$;
select public.lifty_safety_assert(not has_function_privilege('authenticated','lifty_private.authorize_test_seed()','execute'),'app clients cannot authorize a seed');

do $$ declare u uuid:=gen_random_uuid();i uuid;n uuid;fence uuid:=gen_random_uuid();begin
 -- This normal-shaped account stays unlabelled; its trip/notifications are nevertheless synthetic.
 insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
 insert into public.profiles(id,role,first_name,last_initial) values(u,'passenger','Safety','T');
 insert into public.profile_private(id,terms_accepted_at,location_consent_at) values(u,now(),now());
 insert into lifty_private.testers(user_id) values(u);
 perform set_config('lifty.safety_viewer',u::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform public.lifty_safety_assert((public.get_driver_trip_stats('e0000000-0000-4000-8000-000000000101')->>'completedTrips')::int=(select count(*) from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where l.driver_id='e0000000-0000-4000-8000-000000000101' and i.status='completed' and i.departs_at<=now()),'completed trips are counted from persisted instances');
 perform public.lifty_safety_assert(public.get_driver_trip_stats(u)='{"completedTrips":0,"reliability":null}'::jsonb,'no history has zero trips and no invented reliability');
 delete from lifty_private.testers where user_id=u;
 perform public.lifty_safety_assert(public.get_driver_trip_stats('e0000000-0000-4000-8000-000000000101') is null,'unlisted staging viewer cannot recover test trip metrics');
 insert into lifty_private.testers(user_id) values(u);
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at,status)
 values('e0000000-0000-4000-8000-000000001011',current_date+500,now()+interval '5 minutes',now()-interval '1 minute',now()+interval '1 hour','scheduled') returning id into i;
 insert into public.instance_riders(instance_id,passenger_id,status) values(i,u,'expected');
 -- The scheduler has no user claim. Tagging must come from source trip context.
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 perform public.queue_commute_reminders();
 select id into n from public.notifications where user_id=u and source_instance_id=i;
 perform public.lifty_safety_assert(n is not null and (select is_test and source_leg_id='e0000000-0000-4000-8000-000000001011' from public.notifications where id=n),'cron reminder inherits synthetic trip context');
 perform public.lifty_safety_assert(not (select is_test from public.profiles where id=u),'a real-shaped tester is not relabelled as a test person');
 perform set_config('lifty.safety_reminder',n::text,true);
 insert into public.push_tokens(user_id,token,platform) values(u,'local-synthetic-token-never-send','android');
 update lifty_private.test_environment set mode='disabled';
 perform public.lifty_safety_assert(not exists(select 1 from public.claim_pilot_work(true) j where j->>'id'=n::text),'disabled fixture reminder never becomes a production push job');
 update lifty_private.notification_outbox set status='processing',lease=fence,leased_until=now()+interval '5 minutes' where id=n;
 perform public.lifty_safety_assert(not public.can_dispatch_push(n,fence,encode(extensions.digest('local-synthetic-token-never-send','sha256'),'hex')),'a previously leased test notification cannot dispatch after disable');
 update lifty_private.test_environment set mode='staging';delete from lifty_private.testers where user_id=u;
 perform public.lifty_safety_assert(not public.can_dispatch_push(n,fence,encode(extensions.digest('local-synthetic-token-never-send','sha256'),'hex')),'removing a tester cannot resume a previously leased test push');
 perform public.lifty_safety_assert(not has_function_privilege('authenticated','public.can_dispatch_push(uuid,uuid,text)','execute'),'push dispatch validation is service-only');
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
set local role authenticated;
select public.lifty_safety_assert(not exists(select 1 from public.notifications where id=current_setting('lifty.safety_reminder')::uuid),'removed staging tester cannot read the fixture reminder');
reset role;

do $test$ declare environment text;marker text;begin
 for environment,marker in values('local',''),('disabled','REMOVE_TEST_ONLY_FROM_LOCAL_LIFTY'),('staging','REMOVE_TEST_ONLY_FROM_LOCAL_LIFTY') loop
  update lifty_private.test_environment set mode=environment;perform set_config('lifty.nonproduction_cleanup',marker,true);
  begin execute $cleanup$__SAFE_CLEANUP_SQL__$cleanup$;raise exception 'Unconfirmed cleanup was accepted';
  exception when others then if sqlerrm not like 'Cleanup refused:%' then raise;end if;
  perform public.lifty_safety_assert(true,'cleanup refuses absent confirmation or wrong mode: '||environment);end;
 end loop;
end $test$;
update lifty_private.test_environment set mode='local';
set local lifty.nonproduction_cleanup='REMOVE_TEST_ONLY_FROM_LOCAL_LIFTY';
__SAFE_CLEANUP_SQL__
select public.lifty_safety_assert(not exists(select 1 from public.profiles where is_test and id::text like 'e0000000-0000-4000-8000-%'),'confirmed cleanup removes only tagged fixture accounts');
select public.lifty_safety_assert(exists(select 1 from auth.users where id=current_setting('lifty.safety_viewer')::uuid) and exists(select 1 from public.profiles where id=current_setting('lifty.safety_viewer')::uuid and not is_test),'cleanup preserves an unrelated normal-shaped account');
select jsonb_build_object('suite','test-driver-safety','passed',current_setting('lifty.safety_checks')::int,'failed',0,'fixtures','rolled back');
rollback;
