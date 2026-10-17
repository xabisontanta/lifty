-- Fixed local Lifty sandbox only. Fixtures and assertions roll back together.
begin;
select set_config('lifty.hold_checks','0',true);
create function public.hold_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if not coalesce(ok,false) then raise exception 'Driver hold: %',label;end if;
 perform set_config('lifty.hold_checks',(current_setting('lifty.hold_checks')::int+1)::text,true);
end $$;
create function public.hold_expect_error(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;raise exception 'Expected rejection did not occur';
 exception when others then if sqlerrm not like expected then raise;end if;end;
 perform public.hold_assert(true,label);
end $$;
do $$ declare u uuid;leg uuid:=gen_random_uuid();i uuid;a jsonb;begin
 foreach u in array array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()] loop
  insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
  insert into public.profiles(id,role,first_name,last_initial) values(u,case when coalesce(current_setting('lifty.hold_driver',true),'')='' then 'driver'::public.user_role else 'passenger'::public.user_role end,'Hold','T');
  insert into public.profile_private(id,terms_accepted_at,location_consent_at) values(u,now(),now());
  if coalesce(current_setting('lifty.hold_driver',true),'')='' then perform set_config('lifty.hold_driver',u::text,true);
  elsif coalesce(current_setting('lifty.hold_p1',true),'')='' then perform set_config('lifty.hold_p1',u::text,true);
  elsif coalesce(current_setting('lifty.hold_p2',true),'')='' then perform set_config('lifty.hold_p2',u::text,true);
  elsif coalesce(current_setting('lifty.hold_outsider',true),'')='' then perform set_config('lifty.hold_outsider',u::text,true);
  else perform set_config('lifty.hold_admin',u::text,true);insert into public.admins(user_id) values(u);end if;
 end loop;
 insert into public.vehicles(driver_id,make,model,year,colour,registration_summary,seats_total,status)
 values(current_setting('lifty.hold_driver')::uuid,'Test','Hold',2024,'Blue','ND HOLD 123',4,'verified');
 insert into public.verification_documents(user_id,kind,storage_path,status,expires_on)
 select current_setting('lifty.hold_driver')::uuid,k::public.doc_kind,current_setting('lifty.hold_driver')||'/'||k||'.pdf','verified',current_date+30
 from unnest(array['id','licence','vehicle_registration','insurance'])k;
 insert into public.driver_legs(id,driver_id,direction,origin_label,origin,destination_label,destination,route,route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution)
 select leg,current_setting('lifty.hold_driver')::uuid,'to_work','Hold start',origin,'Hold destination',destination,route,route_distance_m,route_duration_s,
  (now() at time zone 'Africa/Johannesburg')::time,'{0,1,2,3,4,5,6}',2,8,100
 from public.driver_legs where id='e0000000-0000-4000-8000-000000001011';
 if not found then raise exception 'Seed fixed local Lifty routes before this suite';end if;
 perform set_config('lifty.hold_leg',leg::text,true);
 a:=jsonb_build_object('scheduleMode','weekly','days',jsonb_build_array(0,1,2,3,4,5,6),'startDate',current_date-1,'monthlyContribution',100);
 foreach u in array array[current_setting('lifty.hold_p1')::uuid,current_setting('lifty.hold_p2')::uuid] loop
  insert into public.club_members(leg_id,passenger_id,pickup_label,pickup,pickup_time,monthly_contribution,start_date,agreement)
  select leg,u,'Hold pickup',origin,(now() at time zone 'Africa/Johannesburg')::time,100,current_date-1,a from public.driver_legs where id=leg;
 end loop;
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at,status)
 values(leg,current_date,now()+interval '5 minutes',now()-interval '20 minutes',now()+interval '2 hours','sharing') returning id into i;
 perform set_config('lifty.hold_instance',i::text,true);
 insert into public.instance_riders(instance_id,passenger_id,status,pickup_label,pickup,pickup_time)
 select i,m.passenger_id,'expected',m.pickup_label,m.pickup,m.pickup_time from public.club_members m where m.leg_id=leg;
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at,status)
 values(leg,current_date+1,now()+interval '1 day',now()+interval '23 hours',now()+interval '26 hours','scheduled') returning id into i;
 perform set_config('lifty.hold_future',i::text,true);
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at,status,completed_at)
 values(leg,current_date-1,now()-interval '1 day',now()-interval '25 hours',now()-interval '22 hours','completed',now()-interval '23 hours') returning id into i;
 perform set_config('lifty.hold_history',i::text,true);
 perform set_config('request.jwt.claim.sub',current_setting('lifty.hold_driver'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_driver'),'role','authenticated')::text,true);
end $$;

set local role authenticated;
select public.hold_assert((public.get_current_instance()->>'verificationHold')::boolean=false,'approved driver sees an unheld current trip');
select public.mark_driver_arrived(current_setting('lifty.hold_instance')::uuid,current_setting('lifty.hold_p1')::uuid);
select public.mark_rider_status(current_setting('lifty.hold_instance')::uuid,current_setting('lifty.hold_p1')::uuid,'collected');
reset role;
update public.verification_documents set expires_on=current_date-1 where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence';
select public.hold_assert(lifty_private.driver_hold_reason(current_setting('lifty.hold_driver')::uuid)='expired','expiry is enforced immediately');
select public.hold_assert((select count(*)=3 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_hold'),'hold notifies driver and both passengers');
select lifty_private.reconcile_driver_holds(current_setting('lifty.hold_driver')::uuid);
select public.hold_assert((select count(*)=3 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_hold'),'repeat reconciliation deduplicates hold notices');
select public.hold_assert((select status='sharing' from public.commute_instances where id=current_setting('lifty.hold_instance')::uuid),'expiry preserves the in-progress trip');
select public.hold_assert((select status='collected' from public.instance_riders where instance_id=current_setting('lifty.hold_instance')::uuid and passenger_id=current_setting('lifty.hold_p1')::uuid),'expiry preserves collected passenger');
select public.hold_assert((select status='scheduled' from public.commute_instances where id=current_setting('lifty.hold_future')::uuid),'future instance stays visible as held rather than deleted');
set local role authenticated;
select public.hold_assert((public.get_current_instance()->>'verificationHold')::boolean and public.get_current_instance()->>'verificationHoldReason'='expired','driver gets computed hold contract');
select public.hold_expect_error('select public.mark_driver_arrived('''||current_setting('lifty.hold_instance')||''','''||current_setting('lifty.hold_p2')||''')','%approval is on hold%','expired driver cannot arrive for another pickup');
select public.hold_expect_error('select public.mark_rider_status('''||current_setting('lifty.hold_instance')||''','''||current_setting('lifty.hold_p2')||''',''collected'')','%approval is on hold%','expired driver cannot collect another rider');
reset role;
select set_config('request.jwt.claim.sub',current_setting('lifty.hold_p2'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_p2'),'role','authenticated')::text,true);
set local role authenticated;
select public.hold_assert((public.get_current_instance()->>'verificationHold')::boolean,'passenger keeps current trip with hold warning');
select public.hold_expect_error('select public.mark_rider_status('''||current_setting('lifty.hold_instance')||''','''||current_setting('lifty.hold_p2')||''',''at_pickup'')','%approval is on hold%','held journey cannot start through passenger readiness');
select public.hold_expect_error('select public.complete_instance('''||current_setting('lifty.hold_instance')||''')','%Only the driver%','passenger cannot use driver safe closure');
reset role;

-- Expiry does not strand the person already collected or punish the next rider.
select set_config('request.jwt.claim.sub',current_setting('lifty.hold_driver'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_driver'),'role','authenticated')::text,true);
set local role authenticated;
select public.stop_my_sharing(current_setting('lifty.hold_instance')::uuid);
select public.complete_instance(current_setting('lifty.hold_instance')::uuid);
select public.complete_instance(current_setting('lifty.hold_instance')::uuid);
reset role;
select public.hold_assert((select status='completed' from public.commute_instances where id=current_setting('lifty.hold_instance')::uuid),'held run with collected rider can finish');
select public.hold_assert((select status='dropped_off' from public.instance_riders where instance_id=current_setting('lifty.hold_instance')::uuid and passenger_id=current_setting('lifty.hold_p1')::uuid),'collected rider becomes completed');
select public.hold_assert((select status='absent' from public.instance_riders where instance_id=current_setting('lifty.hold_instance')::uuid and passenger_id=current_setting('lifty.hold_p2')::uuid),'uncollected rider is cancelled without a no-show penalty');
select public.hold_assert((select reliability=100 from public.profiles where id=current_setting('lifty.hold_p2')::uuid),'verification problem does not lower passenger reliability');
select public.hold_assert((select status='completed' from public.commute_instances where id=current_setting('lifty.hold_history')::uuid),'completed history remains intact');
select public.hold_assert((select count(*)=2 from public.club_members where leg_id=current_setting('lifty.hold_leg')::uuid and active),'hold never ends accepted arrangements');

-- A human review restores current approval and emits a separate recovery event.
update public.verification_documents set expires_on=current_date+30,status='pending' where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence';
select set_config('request.jwt.claim.sub',current_setting('lifty.hold_admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_admin'),'role','authenticated')::text,true);
set local role authenticated;
select public.review_document((select id from public.verification_documents where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence'),true);
reset role;
select public.hold_assert(lifty_private.driver_hold_reason(current_setting('lifty.hold_driver')::uuid) is null,'reviewer approval releases hold');
select public.hold_assert((select count(*)=3 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_restored'),'driver and passengers receive recovery notices');
select lifty_private.reconcile_driver_holds(current_setting('lifty.hold_driver')::uuid);
select public.hold_assert((select count(*)=3 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_restored'),'recovery notices are deduplicated');

-- A later expiry is a new episode, never swallowed by previous deduplication.
update public.verification_documents set expires_on=current_date-1 where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence';
select public.hold_assert((select count(*)=9 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_hold'),'changed reason and later expiry each create a new hold episode');
update public.verification_documents set expires_on=current_date+30 where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence';

-- Reuse the current departure for an already-underway suspension scenario.
update public.commute_instances set status='underway',completed_at=null,started_at=now()-interval '5 minutes' where id=current_setting('lifty.hold_instance')::uuid;
update public.instance_riders set status=case when passenger_id=current_setting('lifty.hold_p1')::uuid then 'collected'::public.rider_status else 'expected'::public.rider_status end where instance_id=current_setting('lifty.hold_instance')::uuid;
set local role authenticated;
select public.suspend_account(current_setting('lifty.hold_driver')::uuid,true,'Local safety test suspension');
reset role;
select public.hold_assert((select status='underway' from public.commute_instances where id=current_setting('lifty.hold_instance')::uuid),'suspension reconciliation preserves underway rider');
select public.hold_assert((select status='scheduled' from public.commute_instances where id=current_setting('lifty.hold_future')::uuid),'suspension preserves held future instance for explanation');
select set_config('request.jwt.claim.sub',current_setting('lifty.hold_driver'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_driver'),'role','authenticated')::text,true);
set local role authenticated;
select public.hold_assert(public.get_current_instance()->>'verificationHoldReason'='suspended','suspended driver has narrow current-trip closure view');
select public.hold_expect_error('select public.mark_driver_arrived('''||current_setting('lifty.hold_instance')||''','''||current_setting('lifty.hold_p2')||''')','%Only the driver%','suspension cannot start another pickup');
select public.stop_my_sharing(current_setting('lifty.hold_instance')::uuid);
select public.complete_instance(current_setting('lifty.hold_instance')::uuid);
reset role;
select public.hold_assert((select status='completed' from public.commute_instances where id=current_setting('lifty.hold_instance')::uuid),'suspended driver safely closes already-underway trip');
select public.hold_assert((select status='dropped_off' from public.instance_riders where instance_id=current_setting('lifty.hold_instance')::uuid and passenger_id=current_setting('lifty.hold_p1')::uuid),'suspended completion preserves actual passenger history');
select set_config('request.jwt.claim.sub',current_setting('lifty.hold_outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.hold_outsider'),'role','authenticated')::text,true);
set local role authenticated;
select public.hold_expect_error('select public.complete_instance('''||current_setting('lifty.hold_instance')||''')','%Only the driver%','outsider cannot use safe completion');
select public.hold_expect_error('select public.stop_my_sharing('''||current_setting('lifty.hold_instance')||''')','%Not your trip%','outsider cannot change sharing');
reset role;
select public.hold_assert(not has_function_privilege('authenticated','lifty_private.reconcile_driver_holds(uuid)','execute'),'hold notifier is private');
select public.hold_assert(not has_function_privilege('anon','public.complete_instance(uuid)','execute'),'anonymous completion remains denied');
select public.hold_assert(not has_table_privilege('authenticated','lifty_private.driver_leg_holds','select'),'private hold state is not exposed');

-- Fixture notices carry source-leg isolation and are never FCM tasks.
update public.profiles set is_test=true,suspended_at=null where id=current_setting('lifty.hold_driver')::uuid;
update public.verification_documents set expires_on=current_date-1 where user_id=current_setting('lifty.hold_driver')::uuid and kind='licence';
select public.hold_assert(exists(select 1 from public.notifications where source_leg_id=current_setting('lifty.hold_leg')::uuid and kind='verification_hold' and is_test),'fixture hold events remain labelled test');
select count(*) from public.claim_pilot_work(false);
select public.hold_assert(not exists(select 1 from lifty_private.notification_outbox o join public.notifications n on n.id=o.id where n.source_leg_id=current_setting('lifty.hold_leg')::uuid and n.is_test and (o.status<>'blocked' or o.last_error<>'Test notifications are in-app only')),'fixture hold alerts cannot enter FCM delivery');
select jsonb_build_object('suite','driver-verification-trip-hold','passed',current_setting('lifty.hold_checks')::int,'failed',0,'fixtures','rolled back');
rollback;
