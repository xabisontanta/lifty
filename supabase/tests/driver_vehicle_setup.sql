-- Local sandbox only. No preview account or vehicle is reset; fixtures roll back.
begin;
select set_config('lifty.vehicle_checks','0',true);
create function public.vehicle_setup_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if not coalesce(ok,false) then raise exception 'Vehicle setup: %',label;end if;
 perform set_config('lifty.vehicle_checks',(current_setting('lifty.vehicle_checks')::int+1)::text,true);
end $$;
create function public.vehicle_setup_expect_error(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;raise exception 'Expected rejection did not occur';
 exception when others then if sqlerrm not like expected then raise;end if;end;
 perform public.vehicle_setup_assert(true,label);
end $$;
create function public.vehicle_setup_payload() returns jsonb language sql stable as $$
 select current_setting('lifty.vehicle_payload')::jsonb
$$;
do $$ declare d uuid:=gen_random_uuid();o uuid:=gen_random_uuid();p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();u uuid;begin
 perform set_config('lifty.vehicle_driver',d::text,true);perform set_config('lifty.vehicle_other',o::text,true);
 perform set_config('lifty.vehicle_passenger',p::text,true);perform set_config('lifty.vehicle_passenger2',q::text,true);
 foreach u in array array[d,o,p,q] loop
  insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
   values(u,'authenticated','authenticated','{}','{}',now(),now());
  insert into public.profiles(id,role,first_name,last_initial)
   values(u,case when u in(d,o) then 'driver'::public.user_role else 'passenger'::public.user_role end,'Vehicle setup','Q');
  insert into public.profile_private(id,last_name,terms_accepted_at) values(u,'Tester',now());
 end loop;
 insert into storage.objects(bucket_id,name) values('vehicle-photos',d||'/own.png'),('vehicle-photos',o||'/other.png');
 perform set_config('lifty.vehicle_payload',jsonb_build_object('make','Volkswagen','model','Polo Vivo','year',2024,'colour','Silver',
  'bodyType','hatchback','registrationSummary','ND TEST 123','seats',4,'photoPath',null)::text,true);
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated')::text,true);
end $$;
select public.vehicle_setup_assert(not has_function_privilege('anon','public.save_driver_vehicle(jsonb)','execute'),'anonymous RPC denied');
select public.vehicle_setup_assert(has_function_privilege('authenticated','public.save_driver_vehicle(jsonb)','execute'),'authenticated RPC available');
select public.vehicle_setup_assert(not has_column_privilege('authenticated','public.vehicles','driver_id','update'),'ownership update grant stays closed');
select public.vehicle_setup_assert(not has_column_privilege('authenticated','public.vehicles','status','update'),'verification update grant stays closed');
select public.vehicle_setup_assert(not has_column_privilege('authenticated','public.vehicles','status','insert'),'verification insert grant stays closed');
set local role authenticated;
select set_config('lifty.saved_vehicle',public.save_driver_vehicle(public.vehicle_setup_payload())::text,true);
select public.vehicle_setup_assert((select driver_id=auth.uid() and status='pending' and make='Volkswagen' and model='Polo Vivo'
 and year=2024 and colour='Silver' and body_type='hatchback' and seats_total=4 and photo_path is null
 from public.vehicles where id=current_setting('lifty.saved_vehicle')::uuid),'first setup inserts own pending vehicle without photo');
select public.vehicle_setup_assert(public.save_driver_vehicle(public.vehicle_setup_payload())::text=current_setting('lifty.saved_vehicle'),'repeat setup keeps stable vehicle UUID');
select public.vehicle_setup_assert((select count(*)=1 from public.vehicles where driver_id=auth.uid()),'repeat does not duplicate vehicle');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"status":"verified"}')$q$,'%Invalid vehicle fields%','client cannot grant verification');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('driverId',current_setting('lifty.vehicle_other')))$q$,'%Invalid vehicle fields%','client cannot choose another owner');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle('[]')$q$,'%Invalid vehicle fields%','array payload rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(null)$q$,'%Invalid vehicle fields%','null payload rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle('{}')$q$,'%Enter all vehicle details%','required fields enforced');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"year":"2024"}')$q$,'%Enter all vehicle details%','year must be numeric');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"year":1979}')$q$,'%Enter a valid vehicle year%','old invalid year rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"year":2024.5}')$q$,'%Enter a valid vehicle year%','fractional year rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"year":2100}')$q$,'%Enter a valid vehicle year%','unrealistic future year rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"seats":0}')$q$,'%Vehicle seats must be between%','zero seats rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"seats":8}')$q$,'%Vehicle seats must be between%','oversized capacity rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"seats":2.5}')$q$,'%Vehicle seats must be between%','fractional seats rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"model":"  "}')$q$,'%Invalid vehicle details%','blank model rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"bodyType":"bus"}')$q$,'%Invalid vehicle details%','unknown body type rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('make',E'VW\nForged'))$q$,'%Invalid vehicle details%','control characters rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"photoPath":true}')$q$,'%Invalid vehicle photo%','photo path must be text or null');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('photoPath',current_setting('lifty.vehicle_other')||'/other.png'))$q$,'%Upload your own vehicle photo first%','another account photo rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('photoPath',auth.uid()||'/missing.png'))$q$,'%Upload your own vehicle photo first%','unuploaded photo rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('photoPath',auth.uid()||'/../other.png'))$q$,'%Upload your own vehicle photo first%','photo traversal rejected');
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"photoPath":"https://remote.invalid/car.png"}')$q$,'%Upload your own vehicle photo first%','remote photo URL rejected');
select public.save_driver_vehicle(public.vehicle_setup_payload()||jsonb_build_object('photoPath',auth.uid()||'/own.png'));
select public.vehicle_setup_assert((select photo_path=auth.uid()||'/own.png' from public.vehicles where driver_id=auth.uid()),'own uploaded photo accepted');
reset role;
insert into public.verification_documents(user_id,kind,storage_path,status,expires_on)
 select current_setting('lifty.vehicle_driver')::uuid,k::public.doc_kind,current_setting('lifty.vehicle_driver')||'/'||k||'.pdf','verified',current_date+30
 from unnest(array['id','licence','vehicle_registration','insurance'])k;
set local role authenticated;
select public.vehicle_setup_assert((select status='verified' from public.vehicles where driver_id=auth.uid()),'review fixtures are server verified');
select public.save_driver_vehicle(public.vehicle_setup_payload());
select public.vehicle_setup_assert((select status='verified' from public.vehicles where driver_id=auth.uid()),'identical vehicle details preserve approval');
select public.vehicle_setup_assert(public.driver_verification(auth.uid())->>'vehicle'='verified' and public.driver_verification(auth.uid())->>'insurance'='verified','identical save preserves document approvals');
select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"colour":"Blue"}');
select public.vehicle_setup_assert((select status='pending' from public.vehicles where driver_id=auth.uid()),'changed vehicle invalidates vehicle approval');
select public.vehicle_setup_assert(public.driver_verification(auth.uid())->>'vehicle'='pending' and public.driver_verification(auth.uid())->>'insurance'='pending','changed vehicle invalidates registration and insurance reviews');
select public.vehicle_setup_assert(public.driver_verification(auth.uid())->>'identity'='verified' and public.driver_verification(auth.uid())->>'licence'='verified','vehicle change retains unrelated identity and licence reviews');
reset role;
do $$ declare l uuid:=gen_random_uuid();u uuid;begin
 insert into public.driver_legs(id,driver_id,direction,origin_label,origin,destination_label,destination,route,
  route_distance_m,route_duration_s,departure_time,days,seats_open,max_deviation_min,monthly_contribution)
 values(l,current_setting('lifty.vehicle_driver')::uuid,'to_work','QA Home',extensions.st_geogfromtext('POINT(31.02 -29.88)'),
  'QA Office',extensions.st_geogfromtext('POINT(31.08 -29.82)'),extensions.st_geogfromtext('LINESTRING(31.02 -29.88,31.08 -29.82)'),
  10000,1800,'07:00','{1,2,3,4,5}',4,8,0);
 foreach u in array array[current_setting('lifty.vehicle_passenger')::uuid,current_setting('lifty.vehicle_passenger2')::uuid] loop
  insert into public.club_members(leg_id,passenger_id,pickup_label,pickup,pickup_time,monthly_contribution,start_date)
  values(l,u,'QA Stop',extensions.st_geogfromtext('POINT(31.03 -29.87)'),'07:05',0,current_date+1);
 end loop;
 perform set_config('lifty.vehicle_leg',l::text,true);
end $$;
set local role authenticated;
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"seats":1}')$q$,'%Vehicle capacity cannot be less than existing members%','RPC retains accepted passenger seat safeguard');
select public.vehicle_setup_assert((select seats_total=4 from public.vehicles where driver_id=auth.uid()),'rejected capacity change leaves vehicle intact');
select public.save_driver_vehicle(public.vehicle_setup_payload()||'{"seats":2}');
select public.vehicle_setup_assert((select seats_open=0 from public.driver_legs where id=current_setting('lifty.vehicle_leg')::uuid),'capacity change reconciles open seats against members');
reset role;
select set_config('request.jwt.claim.sub',current_setting('lifty.vehicle_passenger'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.vehicle_passenger'),'role','authenticated')::text,true);
set local role authenticated;
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload())$q$,'%Active driver account required%','passenger cannot publish vehicle');
reset role;
select set_config('request.jwt.claim.sub',current_setting('lifty.vehicle_driver'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('lifty.vehicle_driver'),'role','authenticated')::text,true);
update public.profiles set suspended_at=now() where id=current_setting('lifty.vehicle_driver')::uuid;
set local role authenticated;
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload())$q$,'%Active driver account required%','suspended driver cannot publish vehicle');
reset role;
update public.profiles set suspended_at=null,deletion_requested_at=now() where id=current_setting('lifty.vehicle_driver')::uuid;
set local role authenticated;
select public.vehicle_setup_expect_error($q$select public.save_driver_vehicle(public.vehicle_setup_payload())$q$,'%Active driver account required%','deleting driver cannot publish vehicle');
reset role;
select public.vehicle_setup_assert(not exists(select 1 from public.vehicles where driver_id=current_setting('lifty.vehicle_other')::uuid),'other account vehicle remains untouched');
select jsonb_build_object('suite','driver-vehicle-setup','passed',current_setting('lifty.vehicle_checks')::int,'failed',0,'fixtures','rolled back');
rollback;
