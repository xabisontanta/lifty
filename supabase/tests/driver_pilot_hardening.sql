-- Fixed local Lifty sandbox only. Every fixture and assertion rolls back.
begin;
select set_config('lifty.driver_checks','0',true);
create function public.driver_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if not coalesce(ok,false) then raise exception 'Driver pilot: %',label;end if;
 perform set_config('lifty.driver_checks',(current_setting('lifty.driver_checks')::int+1)::text,true);
end $$;
create function public.driver_expect_error(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;raise exception 'Expected rejection did not occur';
 exception when others then if sqlerrm not like expected then raise;end if;end;
 perform public.driver_assert(true,label);
end $$;

do $$ declare u uuid;leg uuid:=gen_random_uuid();c uuid;r uuid;a jsonb;begin
 foreach u in array array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()] loop
  insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now());
  insert into public.profiles(id,role,first_name,last_initial) values(u,case when current_setting('lifty.driver_d',true) is null or current_setting('lifty.driver_d',true)='' then 'driver'::public.user_role else 'passenger'::public.user_role end,'Pilot','T');
  insert into public.profile_private(id,terms_accepted_at,location_consent_at) values(u,now(),now());
  if coalesce(current_setting('lifty.driver_d',true),'')='' then perform set_config('lifty.driver_d',u::text,true);
  elsif coalesce(current_setting('lifty.driver_p1',true),'')='' then perform set_config('lifty.driver_p1',u::text,true);
  elsif coalesce(current_setting('lifty.driver_p2',true),'')='' then perform set_config('lifty.driver_p2',u::text,true);
  elsif coalesce(current_setting('lifty.driver_p3',true),'')='' then perform set_config('lifty.driver_p3',u::text,true);
  elsif coalesce(current_setting('lifty.driver_other',true),'')='' then perform set_config('lifty.driver_other',u::text,true);update public.profiles set role='driver' where id=u;
  else perform set_config('lifty.driver_admin',u::text,true);insert into public.admins(user_id) values(u);end if;
 end loop;
 insert into public.vehicles(driver_id,make,model,year,colour,registration_summary,seats_total,status)
 values(current_setting('lifty.driver_d')::uuid,'Test','Pilot',2024,'Blue','ND TEST 123',4,'verified');
 insert into public.verification_documents(user_id,kind,storage_path,status,expires_on)
 select current_setting('lifty.driver_d')::uuid,k::public.doc_kind,current_setting('lifty.driver_d')||'/'||k||'.pdf','verified',current_date+30
 from unnest(array['id','licence','vehicle_registration','insurance'])k;
 insert into public.driver_legs(id,driver_id,direction,origin_label,origin,destination_label,destination,route,route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution)
 select leg,current_setting('lifty.driver_d')::uuid,'to_work','Pilot start',origin,'Pilot destination',destination,route,route_distance_m,route_duration_s,'07:00','{0,1,2,3,4,5,6}',2,8,100
 from public.driver_legs where id='e0000000-0000-4000-8000-000000001011';
 if not found then raise exception 'Seed the fixed local Lifty fixture routes before running this suite';end if;
 perform set_config('lifty.driver_leg',leg::text,true);
 a:=jsonb_build_object('scheduleMode','weekly','days',jsonb_build_array(0,1,2,3,4,5,6),'dates','[]'::jsonb,'startDate',current_date+1,'monthlyContribution',100,
 'routeSignature',(select md5(route::text||departure_time::text||days::text||direction::text) from public.driver_legs where id=leg));
 perform set_config('lifty.driver_agreement',a::text,true);
 foreach u in array array[current_setting('lifty.driver_p1')::uuid,current_setting('lifty.driver_p2')::uuid,current_setting('lifty.driver_p3')::uuid] loop
  insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,window_min,max_walk_m,start_date)
  select u,'to_work','Pickup',origin,'Work',destination,'{0,1,2,3,4,5,6}','08:00',30,750,current_date+1 from public.driver_legs where id=leg returning id into c;
  insert into public.join_requests(passenger_id,leg_id,commute_id,pickup_label,pickup,walking_m,walking_min,deviation_min,route_overlap,pickup_time,monthly_contribution,start_date,status,agreement)
  select u,leg,c,'Pickup',origin,0,0,2,95,'07:10',100,current_date+1,case when u=current_setting('lifty.driver_p3')::uuid then 'pending'::public.request_status else 'accepted'::public.request_status end,a
  from public.driver_legs where id=leg returning id into r;
  if u<>current_setting('lifty.driver_p3')::uuid then
   insert into public.club_members(leg_id,passenger_id,request_id,pickup_label,pickup,pickup_time,monthly_contribution,start_date,agreement)
   select leg,u,r,'Pickup',origin,'07:10',100,current_date+1,a from public.driver_legs where id=leg;
  else perform set_config('lifty.driver_request',r::text,true);end if;
 end loop;
 perform set_config('request.jwt.claim.sub',current_setting('lifty.driver_d'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_d'),'role','authenticated')::text,true);
end $$;

-- Authenticated role exercises real RPC permissions, not owner-only happy paths.
set local role authenticated;
select public.driver_assert(public.driver_verification(current_setting('lifty.driver_d')::uuid)->>'licence'='verified','approved current documents are returned');
select public.save_driver_onboarding_draft('{"step":2,"vehicle":{"make":"Toyota","model":"Corolla","year":"2024","colour":"Blue","registration":"ND123","seats":3,"bodyType":"sedan"},"commute":{"origin":"Home","destination":"Work","originPlace":{"label":"Home","lng":31.2,"lat":-29.5},"departure":"07:00","returnTime":"17:00","offerReturn":true,"days":[0,1,2,3,4],"maxDeviationMin":8},"seatsOpen":3,"monthlyContribution":100}');
select public.driver_assert(public.get_driver_onboarding_draft()->>'step'='2','driver draft restores saved step');
select public.save_driver_onboarding_draft(public.get_driver_onboarding_draft()||jsonb_build_object('vehiclePhotoPath',current_setting('lifty.driver_d')||'/vehicle-draft.jpg'));
select public.driver_assert(public.get_driver_onboarding_draft()->>'vehiclePhotoPath'=current_setting('lifty.driver_d')||'/vehicle-draft.jpg','owned vehicle photo path survives interrupted onboarding');
select public.driver_expect_error('select public.save_driver_onboarding_draft(jsonb_build_object(''vehiclePhotoPath'','''||current_setting('lifty.driver_other')||'/vehicle-foreign.jpg''))','%Invalid draft vehicle photo%','draft cannot restore another account vehicle photo');
select public.driver_expect_error('select public.save_driver_onboarding_draft(jsonb_build_object(''vehiclePhotoPath'','''||current_setting('lifty.driver_d')||'/../vehicle.jpg''))','%Invalid draft vehicle photo%','draft rejects photo path traversal');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"vehiclePhotoPath":"https://example.invalid/vehicle.jpg"}')$q$,'%Invalid draft vehicle photo%','draft rejects arbitrary external photo URL');
select public.driver_assert(public.get_driver_onboarding_draft()->>'vehiclePhotoPath'=current_setting('lifty.driver_d')||'/vehicle-draft.jpg','rejected foreign draft never overwrites owned photo progress');
select public.driver_assert(public.export_my_data()->'driver_onboarding_draft'->>'step'='2','export includes private draft');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"step":2,"isAdmin":true}')$q$,'%Invalid onboarding draft%','draft cannot add authority fields');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"commute":{"originPlace":{"label":"Bad","lng":200,"lat":0}}}')$q$,'%Invalid draft coordinates%','draft rejects impossible coordinates');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"vehicle":{"status":"verified"}}')$q$,'%Invalid draft vehicle%','draft cannot set verification');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"commute":{"days":[0,7]}}')$q$,'%Invalid draft weekdays%','draft validates weekdays');
select public.driver_expect_error($q$select public.save_driver_onboarding_draft('{"step":9}')$q$,'%Invalid onboarding step%','draft validates step');
select public.driver_expect_error('select public.save_driver_onboarding_draft(jsonb_build_object(''vehicle'',jsonb_build_object(''make'',repeat(''x'',25000))))','%Invalid onboarding draft%','draft limits payload size');
reset role;
select public.driver_assert(not has_table_privilege('authenticated','lifty_private.driver_onboarding_drafts','select'),'draft table cannot be read directly');
select public.driver_assert(not has_function_privilege('anon','public.send_club_message(uuid,uuid,text)','execute'),'anonymous chat is denied');
select public.driver_assert(not has_table_privilege('authenticated','messages','insert'),'direct chat inserts cannot bypass idempotency');
select public.driver_assert(not has_function_privilege('authenticated','lifty_private.reconcile_leg(uuid)','execute'),'scoped reconciliation is private');
select public.driver_assert(not has_function_privilege('authenticated','lifty_private.queue_document_expiry_reminders()','execute'),'expiry job is private');
set local role authenticated;
select public.set_driver_requests_paused(current_setting('lifty.driver_leg')::uuid,true);
select public.driver_assert((select requests_paused from public.driver_legs where id=current_setting('lifty.driver_leg')::uuid),'driver can pause only new requests');
select public.driver_assert((select (l->>'requestsPaused')::boolean from jsonb_array_elements(public.get_my_clubs()->'asDriver')l where l->>'legId'=current_setting('lifty.driver_leg')),'pause is returned by the driver snapshot after reload');
select public.driver_expect_error('select public.respond_to_request('''||current_setting('lifty.driver_request')||''',true)','%agreed schedule is no longer available%','paused driver cannot accept pending request');
select public.driver_assert((select count(*)=2 from public.club_members where leg_id=current_setting('lifty.driver_leg')::uuid and active),'pausing preserves existing members');
select public.set_driver_requests_paused(current_setting('lifty.driver_leg')::uuid,false);
select public.driver_assert((select not (l->>'requestsPaused')::boolean from jsonb_array_elements(public.get_my_clubs()->'asDriver')l where l->>'legId'=current_setting('lifty.driver_leg')),'reopening is returned by the driver snapshot');
select public.driver_assert((select j->>'legId'=current_setting('lifty.driver_leg') and j->>'direction'='to_work' from public.list_incoming_requests()j where j->>'id'=current_setting('lifty.driver_request')),'incoming request carries the exact leg and direction');

select set_config('lifty.driver_message1',gen_random_uuid()::text,true);
select public.send_club_message(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message1')::uuid,'Meet at the agreed pickup.');
select public.send_club_message(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message1')::uuid,'Meet at the agreed pickup.');
select public.driver_assert((select count(*)=1 from public.messages where id=current_setting('lifty.driver_message1')::uuid),'retry stores one message');
select public.driver_expect_error('select public.send_club_message('''||current_setting('lifty.driver_leg')||''','''||current_setting('lifty.driver_message1')||''',''Changed content'')','%identifier is already in use%','retry identifier cannot change content');
select public.driver_expect_error('select public.send_club_message('''||current_setting('lifty.driver_leg')||''',gen_random_uuid(),''   '')','%Enter a message%','empty chat is denied');
select public.driver_assert((select (j->>'unreadCount')::int=0 and (j->>'memberCount')::int=3 and j->'lastMessage'->>'mine'='true' from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'driver sees group metadata and own messages are read');
reset role;
select public.driver_assert((select count(*)=2 from public.notifications where source_message_id=current_setting('lifty.driver_message1')::uuid),'one notification per active recipient excluding sender');
select public.driver_assert((select count(*)=2 from lifty_private.notification_outbox o join public.notifications n on n.id=o.id where n.source_message_id=current_setting('lifty.driver_message1')::uuid),'chat events enter durable delivery outbox');
select public.driver_assert(not exists(select 1 from public.notifications where source_message_id=current_setting('lifty.driver_message1')::uuid and body like '%agreed pickup%'),'notification preview does not reveal chat text');

select set_config('request.jwt.claim.sub',current_setting('lifty.driver_p1'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_p1'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_assert((select (j->>'unreadCount')::int=1 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'passenger sees unread driver message');
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message1')::uuid);
select public.driver_assert((select (j->>'unreadCount')::int=0 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'read cursor clears rendered message');
select public.driver_assert((select count(*)=1 from public.notifications where source_message_id=current_setting('lifty.driver_message1')::uuid and read_at is not null),'read cursor updates own notification only');
select public.driver_expect_error('select public.get_driver_onboarding_draft()','%Driver account required%','passenger cannot read driver drafts');
select public.driver_expect_error('select public.set_driver_requests_paused('''||current_setting('lifty.driver_leg')||''',true)','%Not your commute%','passenger cannot pause driver offers');
select public.driver_expect_error('select public.mark_club_read('''||current_setting('lifty.driver_leg')||''',gen_random_uuid())','%Message is unavailable%','read cursor rejects unrelated message ids');
reset role;

select set_config('request.jwt.claim.sub',current_setting('lifty.driver_d'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_d'),'role','authenticated')::text,true);
set local role authenticated;
select set_config('lifty.driver_message2',gen_random_uuid()::text,true);
select public.send_club_message(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message2')::uuid,'Leaving on time.');
reset role;
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_p1'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_p1'),'role','authenticated')::text,true);
set local role authenticated;
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message1')::uuid);
select public.driver_assert((select (j->>'unreadCount')::int=1 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'delayed read acknowledgement does not swallow newer messages');
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message2')::uuid);
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,current_setting('lifty.driver_message1')::uuid);
select public.driver_assert((select (j->>'unreadCount')::int=0 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'stale tab cannot move read cursor backwards');
reset role;
update public.club_members set active=false where leg_id=current_setting('lifty.driver_leg')::uuid and passenger_id=current_setting('lifty.driver_p1')::uuid;
set local role authenticated;
select public.driver_assert(not exists(select 1 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'removed member cannot list group history');
select public.driver_expect_error('select public.send_club_message('''||current_setting('lifty.driver_leg')||''',gen_random_uuid(),''Hello'')','%conversation is unavailable%','removed member cannot send');
reset role;
update public.club_members set active=true where leg_id=current_setting('lifty.driver_leg')::uuid and passenger_id=current_setting('lifty.driver_p1')::uuid;

select set_config('request.jwt.claim.sub',current_setting('lifty.driver_other'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_other'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_assert(public.get_driver_onboarding_draft() is null,'different driver cannot recover another draft');
select public.driver_expect_error('select public.send_club_message('''||current_setting('lifty.driver_leg')||''',gen_random_uuid(),''Hello'')','%conversation is unavailable%','outsider cannot send');
select public.driver_expect_error('select public.mark_club_read('''||current_setting('lifty.driver_leg')||''')','%conversation is unavailable%','outsider cannot mark chat read');
select public.driver_assert(not exists(select 1 from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid),'outsider RLS blocks message history');
reset role;

-- Exact agreement overlap and conservative cumulative detour enforcement.
select public.driver_assert(lifty_private.agreements_overlap(current_setting('lifty.driver_agreement')::jsonb,current_setting('lifty.driver_agreement')::jsonb),'same weekly schedules overlap');
select public.driver_assert(not lifty_private.agreements_overlap('{"scheduleMode":"weekly","days":[0],"startDate":"2026-01-01"}','{"scheduleMode":"weekly","days":[1],"startDate":"2026-01-01"}'),'different weekly days do not overlap');
select public.driver_assert(not lifty_private.agreements_overlap(jsonb_build_object('scheduleMode','dates','dates',jsonb_build_array(current_date+1),'startDate',current_date+1),jsonb_build_object('scheduleMode','dates','dates',jsonb_build_array(current_date+2),'startDate',current_date+1)),'distinct specific dates do not overlap');
update public.join_requests set deviation_min=7 where id=current_setting('lifty.driver_request')::uuid;
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_d'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_d'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_expect_error('select public.respond_to_request('''||current_setting('lifty.driver_request')||''',true)','%Combined estimated pickup detour exceeds%','cumulative pickup detour enforced at acceptance');
reset role;
update public.join_requests set deviation_min=2 where id=current_setting('lifty.driver_request')::uuid;

-- Expiry is enforced immediately, without relying on the reminder job running.
update public.verification_documents set expires_on=current_date-1 where user_id=current_setting('lifty.driver_d')::uuid and kind='licence';
select public.driver_assert(public.driver_verification(current_setting('lifty.driver_d')::uuid)->>'licence'='expired','expired document is shown explicitly');
select public.driver_assert(not public.driver_approved(current_setting('lifty.driver_d')::uuid),'expired document removes current approval');
set local role authenticated;
select public.driver_expect_error('select public.respond_to_request('''||current_setting('lifty.driver_request')||''',true)','%current documents must be approved%','expired driver cannot accept a pending request');
reset role;
select lifty_private.queue_document_expiry_reminders();
select lifty_private.queue_document_expiry_reminders();
select public.driver_assert((select count(*)=1 from public.notifications where user_id=current_setting('lifty.driver_d')::uuid and kind='document_expired'),'expiry reminder is deduplicated');
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_admin'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_expect_error('select public.review_document('''||(select id from public.verification_documents where user_id=current_setting('lifty.driver_d')::uuid and kind='licence')||''',true)','%Expired documents cannot be approved%','reviewer cannot approve an expired document');
select public.driver_expect_error('select public.review_document('''||(select id from public.verification_documents where user_id=current_setting('lifty.driver_d')::uuid and kind='licence')||''',false,null)','%Explain what the driver needs to correct%','document rejection requires useful feedback');
reset role;
update public.verification_documents set expires_on=current_date+5 where user_id=current_setting('lifty.driver_d')::uuid and kind='licence';
select lifty_private.queue_document_expiry_reminders();
select lifty_private.queue_document_expiry_reminders();
select public.driver_assert((select count(*)=1 from public.notifications where user_id=current_setting('lifty.driver_d')::uuid and kind='document_expiring'),'seven-day reminder is deduplicated separately');
select public.driver_assert(public.driver_approved(current_setting('lifty.driver_d')::uuid),'valid current documents restore approval');

-- A withdrawal notifies once, retains its exact status and can never free a seat.
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_p3'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_p3'),'role','authenticated')::text,true);
set local role authenticated;
select public.cancel_join_request(current_setting('lifty.driver_request')::uuid);
select public.cancel_join_request(current_setting('lifty.driver_request')::uuid);
reset role;
select public.driver_assert((select status='cancelled' from public.join_requests where id=current_setting('lifty.driver_request')::uuid),'withdrawal persists cancelled status');
select public.driver_assert((select count(*)=1 from public.notifications where user_id=current_setting('lifty.driver_d')::uuid and kind='request_cancelled'),'withdrawal notifies driver once');
select public.driver_assert((select seats_open=2 from public.driver_legs where id=current_setting('lifty.driver_leg')::uuid),'withdrawal does not change seat reservations');
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_d'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_d'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_assert((select j->>'status'='cancelled' from public.list_incoming_requests()j where j->>'id'=current_setting('lifty.driver_request')),'driver request history distinguishes withdrawn request from decline');
select public.clear_driver_onboarding_draft();
select public.driver_assert(public.get_driver_onboarding_draft() is null,'draft is cleared after setup');
reset role;

-- Acceptance uses the narrow generator, preserving unrelated trip/ledger state.
update public.join_requests set status='pending',responded_at=null where id=current_setting('lifty.driver_request')::uuid;
select public.driver_assert(position('public.reconcile_commutes()' in pg_get_functiondef('public.respond_to_request(uuid,boolean)'::regprocedure))=0,'acceptance does not run global reconciliation');
select public.driver_assert(position('public.generate_contributions()' in pg_get_functiondef('public.respond_to_request(uuid,boolean)'::regprocedure))=0,'acceptance does not duplicate global ledger generation');
select set_config('lifty.driver_accept_start',clock_timestamp()::text,true);
set local role authenticated;
select public.respond_to_request(current_setting('lifty.driver_request')::uuid,true);
reset role;
select set_config('lifty.driver_accept_ms',(extract(epoch from(clock_timestamp()-current_setting('lifty.driver_accept_start')::timestamptz))*1000)::text,true);
select public.driver_assert((select status='accepted' from public.join_requests where id=current_setting('lifty.driver_request')::uuid),'approved driver accepts request through normal RPC');
select public.driver_assert((select count(*)=3 from public.club_members where leg_id=current_setting('lifty.driver_leg')::uuid and active),'acceptance persists exactly one additional member');
select public.driver_assert((select seats_open=1 from public.driver_legs where id=current_setting('lifty.driver_leg')::uuid),'acceptance consumes exactly one seat');
select public.driver_assert(exists(select 1 from public.commute_instances where leg_id=current_setting('lifty.driver_leg')::uuid),'acceptance prepares upcoming departures');
select public.driver_assert(exists(select 1 from public.contributions where leg_id=current_setting('lifty.driver_leg')::uuid and passenger_id=current_setting('lifty.driver_p3')::uuid),'acceptance prepares contribution periods');
set local role authenticated;
select public.driver_expect_error('select public.respond_to_request('''||current_setting('lifty.driver_request')||''',true)','%request is no longer open%','duplicate acceptance is rejected');
reset role;
select public.driver_assert((select count(*)=1 from public.notifications where user_id=current_setting('lifty.driver_p3')::uuid and kind='accepted' and link='/p/accepted?request='||current_setting('lifty.driver_request')),'acceptance retains exact passenger destination');

-- Published new-passenger prices never rewrite previously agreed contributions.
set local role authenticated;
select public.save_driver_settings(current_setting('lifty.driver_leg')::uuid,4,8,120);
select public.driver_assert((select (l->>'monthlyContribution')::int=120 from jsonb_array_elements(public.get_my_clubs()->'asDriver')l where l->>'legId'=current_setting('lifty.driver_leg')),'driver getter returns current new-passenger contribution');
select public.driver_assert((select count(*)=3 and sum((m->>'monthlyContribution')::int)=300 from jsonb_array_elements(public.get_my_clubs()->'asDriver')l cross join lateral jsonb_array_elements(l->'members')m where l->>'legId'=current_setting('lifty.driver_leg')),'driver getter retains each member agreed amount after published price change');

-- Equal timestamps cannot drop a page or advance the read cursor by UUID order.
select public.send_club_message(current_setting('lifty.driver_leg')::uuid,gen_random_uuid(),'Pagination fixture '||n) from generate_series(1,120)n;
select public.driver_assert((select count(distinct created_at)=1 and count(*)=120 from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid and body like 'Pagination fixture %'),'120 real RPC messages share one transaction timestamp');
reset role;
select set_config('request.jwt.claim.sub',current_setting('lifty.driver_p1'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.driver_p1'),'role','authenticated')::text,true);
set local role authenticated;
select public.driver_assert((select (j->>'unreadCount')::int=120 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'recipient sees all 120 equal-timestamp messages unread');
with first_page as(select id,message_seq from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid order by message_seq desc limit 100),
 second_page as(select id,message_seq from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid and message_seq<(select min(message_seq) from first_page) order by message_seq desc limit 100),
 pages as(select * from first_page union all select * from second_page)
select public.driver_assert((select count(*) from first_page)=100 and (select count(*) from second_page)=22 and (select count(*)=count(distinct id) and count(*)=122 from pages),'sequence pagination covers all equal-timestamp messages without skips or duplicates');
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,(select id from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid and body like 'Pagination fixture %' order by message_seq offset 99 limit 1));
select public.driver_assert((select (j->>'unreadCount')::int=20 from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'read acknowledgement for first 100 bulk messages leaves last 20 unread');
select public.mark_club_read(current_setting('lifty.driver_leg')::uuid,(select id from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid order by message_seq desc limit 1));
select public.driver_assert((select (j->>'unreadCount')::int=0 and (j->'lastMessage'->>'sequence')::bigint=(select max(message_seq) from public.messages where leg_id=current_setting('lifty.driver_leg')::uuid) from public.list_chat_summaries()j where j->>'legId'=current_setting('lifty.driver_leg')),'latest sequence is consistent between read cursor and chat summary');
reset role;
select jsonb_build_object('suite','driver-pilot-hardening','passed',current_setting('lifty.driver_checks')::int,'failed',0,'acceptanceMs',round(current_setting('lifty.driver_accept_ms')::numeric),'fixtures','rolled back');
rollback;
