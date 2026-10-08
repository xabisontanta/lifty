-- Isolated synthetic concurrency fixtures. The runner deletes only these generated accounts.
begin;
do $$
declare d uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); l uuid; c uuid; c2 uuid; r uuid; r2 uuid;
begin
 insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) select id,'authenticated','authenticated','pilot-race-'||id||'@example.invalid','{}','{}' from unnest(array[d,p,p2])id;
 insert into public.profiles(id,role,first_name,is_demo) values(d,'driver','Concurrency driver',true),(p,'passenger','Race one',true),(p2,'passenger','Race two',true);
 insert into public.profile_private(id,terms_accepted_at) select id,now() from unnest(array[d,p,p2])id;
 insert into public.vehicles(driver_id,make,model,colour,registration_summary,seats_total) values(d,'Test','Car','White','QA 001',2);
 insert into public.driver_legs(driver_id,direction,origin_label,origin,destination_label,destination,route,route_distance_m,route_duration_s,departure_time,days,seats_open,monthly_contribution)
 values(d,'to_work','Pickup','SRID=4326;POINT(31.14 -29.55)','Work','SRID=4326;POINT(31.07 -29.72)','SRID=4326;LINESTRING(31.14 -29.55,31.07 -29.72)',32000,1800,'06:30',array[0,1,2,3,4]::smallint[],1,500) returning id into l;
 insert into public.verification_documents(user_id,kind,storage_path,status) select d,kind,d||'/'||kind,'verified' from unnest(array['id','licence','vehicle_registration','insurance']::public.doc_kind[])kind;
 insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,max_walk_m,start_date)
 values(p,'to_work','Home','SRID=4326;POINT(31.14 -29.55)','Work','SRID=4326;POINT(31.07 -29.72)',array[0,1,2,3,4]::smallint[],'07:30',0,(now() at time zone 'Africa/Johannesburg')::date+1) returning id into c;
 insert into public.passenger_commutes(passenger_id,direction,origin_label,origin,destination_label,destination,days,arrive_by,max_walk_m,start_date)
 values(p2,'to_work','Home','SRID=4326;POINT(31.14 -29.55)','Work','SRID=4326;POINT(31.07 -29.72)',array[0,1,2,3,4]::smallint[],'07:30',0,(now() at time zone 'Africa/Johannesburg')::date+1) returning id into c2;
 perform set_config('request.jwt.claim.sub',p::text,true);r:=public.request_to_join(c,l);
 perform set_config('request.jwt.claim.sub',p2::text,true);r2:=public.request_to_join(c2,l);
 perform set_config('lifty.test_fixture',jsonb_build_object('driver',d,'passengers',array[p,p2],'leg',l,'requests',array[r,r2])::text,true);
end $$;
select current_setting('lifty.test_fixture')::jsonb fixture;
commit;
