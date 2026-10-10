-- Fixed local sandbox only. Real booking, Realtime publications and rating triggers.
-- Controlled clock fast-forward applies only to the transaction's test trip.
begin;
select set_config('lifty.lifecycle_checks','0',true);
create function public.lifty_lifecycle_assert(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Test lifecycle: %',label;end if;
perform set_config('lifty.lifecycle_checks',(current_setting('lifty.lifecycle_checks')::int+1)::text,true);end $$;
do $$ declare u uuid:=gen_random_uuid();c uuid;r uuid;q uuid;j jsonb;begin
 insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
 insert into public.profiles(id,role,first_name,last_initial) values(u,'passenger','Lifecycle','T');
 insert into public.profile_private(id,terms_accepted_at,location_consent_at) values(u,now(),now());
 insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,window_min,max_walk_m,start_date)
 values(u,'to_work','Salt Rock',extensions.st_setsrid(extensions.st_makepoint(31.234003,-29.488331),4326)::extensions.geography,'Umhlanga',extensions.st_setsrid(extensions.st_makepoint(31.076244,-29.739187),4326)::extensions.geography,'{0,1,2,3,4}','08:00',15,750,(now() at time zone 'Africa/Johannesburg')::date+1) returning id into c;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 j:=public.get_estimated_match_quotes(c);
 select (v->>'quoteId')::uuid into q from jsonb_array_elements(j) v where v->>'legId'='e0000000-0000-4000-8000-000000001011';
 r:=public.request_to_join_quote(c,'e0000000-0000-4000-8000-000000001011',q);
 perform set_config('lifty.lifecycle_viewer',u::text,true);perform set_config('lifty.lifecycle_commute',c::text,true);perform set_config('lifty.lifecycle_request',r::text,true);
end $$;
select public.lifty_lifecycle_assert((select status='pending' from public.join_requests where id=current_setting('lifty.lifecycle_request')::uuid),'normal request persisted pending');
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='pending' from public.join_requests where id=current_setting('lifty.lifecycle_request')::uuid),'response delay keeps immediate request pending');
select public.configure_test_driver('e0000000-0000-4000-8000-000000000101',false,0,0);
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='pending' from public.join_requests where id=current_setting('lifty.lifecycle_request')::uuid),'manual driver mode never auto accepts');
select public.configure_test_driver('e0000000-0000-4000-8000-000000000101',true,0,0);
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='accepted' from public.join_requests where id=current_setting('lifty.lifecycle_request')::uuid),'delayed simulator uses normal driver acceptance');
select public.lifty_lifecycle_assert((select count(*)=1 from public.club_members where request_id=current_setting('lifty.lifecycle_request')::uuid and active),'one immutable club membership');
select public.lifty_lifecycle_assert((select count(*)=1 from public.notifications where user_id=current_setting('lifty.lifecycle_viewer')::uuid and kind='accepted' and link='/p/accepted?request='||current_setting('lifty.lifecycle_request')),'accept notification has exact request link');
-- Make the leg a day that is NOT today, whatever day the suite runs on: the production schedule reconciler (run by the app's
-- current-commute lookup) cancels not-yet-departed trips on days a leg does not run, and must leave a simulated trip alone.
-- (the guard that forbids changing an agreed schedule is suspended for this one statement; the whole suite is rolled back)
set local session_replication_role=replica;
update public.driver_legs set days=array[((extract(isodow from (now() at time zone 'Africa/Johannesburg'))::int-1+1)%7)]::smallint[] where id='e0000000-0000-4000-8000-000000001011';
set local session_replication_role=origin;
select set_config('lifty.lifecycle_instance',public.begin_test_trip(current_setting('lifty.lifecycle_request')::uuid,90)::text,true);
select public.lifty_lifecycle_assert((select is_test and status='sharing' from public.commute_instances where id=current_setting('lifty.lifecycle_instance')::uuid),'simulated instance is labelled and sharing');
select public.lifty_lifecycle_assert((public.get_current_instance()->>'id')=current_setting('lifty.lifecycle_instance'),'the passenger''s current-commute lookup still finds the simulated trip (the reconciler must not cancel it)');
-- …and the driver's own screen ("Today's commute") must find it too
do $$ begin
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000101',true);
 perform set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000101","role":"authenticated"}',true);
end $$;
select public.lifty_lifecycle_assert((public.get_current_instance()->>'id')=current_setting('lifty.lifecycle_instance'),'the driver''s current-commute lookup finds the simulated trip');
do $$ begin
 perform set_config('request.jwt.claim.sub',current_setting('lifty.lifecycle_viewer'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.lifecycle_viewer'),'role','authenticated')::text,true);
end $$;
-- A driver set to manual is left to the person driving: the server must not move, arrive or collect on their behalf.
select public.configure_test_driver('e0000000-0000-4000-8000-000000000101',false,0,0);
update lifty_private.test_trips set started_at=now()-interval '45 seconds' where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select state='approaching' from lifty_private.test_trips where instance_id=current_setting('lifty.lifecycle_instance')::uuid),'a manual driver''s trip is not driven by the simulator');
select public.lifty_lifecycle_assert((select status='expected' from public.instance_riders where instance_id=current_setting('lifty.lifecycle_instance')::uuid and passenger_id=current_setting('lifty.lifecycle_viewer')::uuid),'a manual driver''s rider is not collected by the simulator');
select public.configure_test_driver('e0000000-0000-4000-8000-000000000101',true,0,0);
update lifty_private.test_trips set started_at=now() where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
-- (one trip record is reused for the same leg and day, so pings from earlier runs may already be there: count the new one)
select set_config('lifty.lifecycle_pings_before',(select count(*)::text from public.location_pings where instance_id=current_setting('lifty.lifecycle_instance')::uuid),true);
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select count(*)=current_setting('lifty.lifecycle_pings_before')::int+1 from public.location_pings where instance_id=current_setting('lifty.lifecycle_instance')::uuid and is_test),'driver publishes through real authorized location API');
select public.lifty_lifecycle_assert(public.can_receive_location('commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer')),'member can receive own private pair channel');
select public.lifty_lifecycle_assert(not public.can_receive_location('commute:'||current_setting('lifty.lifecycle_instance')||':11111111-1111-4111-8111-111111111111'),'outsider pair channel is denied');
select set_config('lifty.lifecycle_broadcasts',(select count(*)::text from realtime.messages where topic='commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer') and event='loc'),true);
update lifty_private.test_environment set mode='staging';
select public.lifty_lifecycle_assert(not public.can_receive_location('commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer')),'removing tester eligibility closes channel admission');
select public.lifty_lifecycle_assert(not public.can_track(current_setting('lifty.lifecycle_instance')::uuid),'unlisted staging passenger cannot publish');
do $$ begin
 perform set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000101',true);
 perform set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000101","role":"authenticated"}',true);
 perform public.publish_location(current_setting('lifty.lifecycle_instance')::uuid,31.2339,-29.4882,null,4);
 perform set_config('request.jwt.claim.sub',current_setting('lifty.lifecycle_viewer'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.lifecycle_viewer'),'role','authenticated')::text,true);
end $$;
select public.lifty_lifecycle_assert((select count(*)=current_setting('lifty.lifecycle_broadcasts')::int from realtime.messages where topic='commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer') and event='loc'),'cached unlisted receiver gets no further server broadcasts');
select public.lifty_lifecycle_assert(jsonb_array_length(public.get_my_clubs()->'asPassenger')=0,'hidden test clubs do not reload through definer RPC');
insert into lifty_private.testers(user_id) values(current_setting('lifty.lifecycle_viewer')::uuid);
select public.lifty_lifecycle_assert(public.can_receive_location('commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer')),'allowlisted staging member can receive again');
update lifty_private.test_environment set mode='local';
update lifty_private.test_trips set started_at=now()-interval '30 seconds' where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select driver_arrived_at is not null from public.instance_riders where instance_id=current_setting('lifty.lifecycle_instance')::uuid and passenger_id=current_setting('lifty.lifecycle_viewer')::uuid),'per-passenger arrival persists');
update public.location_pings set recorded_at=now()-interval '30 seconds' where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
update lifty_private.test_trips set started_at=now()-interval '45 seconds' where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='underway' from public.commute_instances where id=current_setting('lifty.lifecycle_instance')::uuid),'trip progresses underway');
select public.lifty_lifecycle_assert((select status='collected' and collected_at is not null from public.instance_riders where instance_id=current_setting('lifty.lifecycle_instance')::uuid and passenger_id=current_setting('lifty.lifecycle_viewer')::uuid),'passenger collection persists');
select public.lifty_lifecycle_assert((select count(distinct location::text)>1 from public.location_pings where instance_id=current_setting('lifty.lifecycle_instance')::uuid),'actual driver positions move along stored route');
update lifty_private.test_trips set started_at=now()-interval '90 seconds' where instance_id=current_setting('lifty.lifecycle_instance')::uuid;
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='completed' and completed_at is not null from public.commute_instances where id=current_setting('lifty.lifecycle_instance')::uuid),'normal complete_instance completes trip');
select public.lifty_lifecycle_assert((select status='dropped_off' from public.instance_riders where instance_id=current_setting('lifty.lifecycle_instance')::uuid and passenger_id=current_setting('lifty.lifecycle_viewer')::uuid),'completion resolves rider');
select public.lifty_lifecycle_assert(not public.can_track(current_setting('lifty.lifecycle_instance')::uuid),'locations stop after completion');
select public.lifty_lifecycle_assert((select count(*)>0 from realtime.messages where topic='commute:'||current_setting('lifty.lifecycle_instance')||':'||current_setting('lifty.lifecycle_viewer') and event='loc'),'real Realtime server broadcasts were inserted');
insert into public.ratings(rater_id,ratee_id,leg_id,instance_id,stars,tags,comment) values(current_setting('lifty.lifecycle_viewer')::uuid,'e0000000-0000-4000-8000-000000000101','e0000000-0000-4000-8000-000000001011',current_setting('lifty.lifecycle_instance')::uuid,5,'{punctual}','Local lifecycle assertion review');
select public.lifty_lifecycle_assert((select rating_count=(select count(*)::int from public.ratings where ratee_id='e0000000-0000-4000-8000-000000000101') from public.profiles where id='e0000000-0000-4000-8000-000000000101'),'rating updates driver aggregate from actual completed trip');
do $$ begin
 begin insert into public.ratings(rater_id,ratee_id,leg_id,instance_id,stars) values(current_setting('lifty.lifecycle_viewer')::uuid,'e0000000-0000-4000-8000-000000000101','e0000000-0000-4000-8000-000000001011',current_setting('lifty.lifecycle_instance')::uuid,5);
 raise exception 'Duplicate rating was accepted';exception when unique_violation then perform public.lifty_lifecycle_assert(true,'duplicate rating rejected');end;
end $$;

-- A second request exercises the configurable decline path through the same validator.
do $$ declare j jsonb;q uuid;r uuid;begin
 j:=public.get_estimated_match_quotes(current_setting('lifty.lifecycle_commute')::uuid);
 select (v->>'quoteId')::uuid into q from jsonb_array_elements(j) v where v->>'legId'='e0000000-0000-4000-8000-000000001021';
 r:=public.request_to_join_quote(current_setting('lifty.lifecycle_commute')::uuid,'e0000000-0000-4000-8000-000000001021',q);
 perform set_config('lifty.lifecycle_decline_request',r::text,true);
end $$;
select public.configure_test_driver('e0000000-0000-4000-8000-000000000102',true,0,100);
select public.advance_test_simulation();
select public.lifty_lifecycle_assert((select status='declined' from public.join_requests where id=current_setting('lifty.lifecycle_decline_request')::uuid),'100 percent configured decline persists');
select public.lifty_lifecycle_assert((select count(*)=0 from public.club_members where request_id=current_setting('lifty.lifecycle_decline_request')::uuid),'decline creates no membership');
select jsonb_build_object('suite','test-driver-lifecycle','passed',current_setting('lifty.lifecycle_checks')::int,'failed',0,'fixtures','rolled back');
rollback;
