-- PostgREST upserts include driver_id in their UPDATE, which is deliberately not
-- client-writable. Keep that ownership grant closed and publish validated own
-- vehicle fields through this narrow RPC instead.
create function public.save_driver_vehicle(p_vehicle jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=auth.uid(); saved_id uuid; make_value text; model_value text;
 colour_value text; body_value text; registration_value text; photo_value text;
 year_value numeric; seats_value numeric;
begin
 if not public.account_active() or not exists(select 1 from public.profiles where id=owner_id and role='driver' and deletion_requested_at is null) then
  raise exception 'Active driver account required';
 end if;
 if p_vehicle is null or jsonb_typeof(p_vehicle)<>'object' or octet_length(p_vehicle::text)>4096
  or exists(select 1 from jsonb_object_keys(p_vehicle) k where k not in('make','model','year','colour','bodyType','registrationSummary','seats','photoPath')) then
  raise exception 'Invalid vehicle fields';
 end if;
 if jsonb_typeof(p_vehicle->'make') is distinct from 'string'
  or jsonb_typeof(p_vehicle->'model') is distinct from 'string'
  or jsonb_typeof(p_vehicle->'colour') is distinct from 'string'
  or jsonb_typeof(p_vehicle->'bodyType') is distinct from 'string'
  or jsonb_typeof(p_vehicle->'registrationSummary') is distinct from 'string'
  or jsonb_typeof(p_vehicle->'year') is distinct from 'number'
  or jsonb_typeof(p_vehicle->'seats') is distinct from 'number' then
  raise exception 'Enter all vehicle details';
 end if;
 make_value:=btrim(p_vehicle->>'make'); model_value:=btrim(p_vehicle->>'model');
 colour_value:=btrim(p_vehicle->>'colour'); body_value:=p_vehicle->>'bodyType';
 registration_value:=btrim(p_vehicle->>'registrationSummary');
 year_value:=(p_vehicle->>'year')::numeric; seats_value:=(p_vehicle->>'seats')::numeric;
 if length(make_value) not between 1 and 80 or length(model_value) not between 1 and 100
  or length(colour_value) not between 1 and 40 or length(registration_value) not between 4 and 50
  or (make_value||model_value||colour_value||registration_value) ~ '[[:cntrl:]]'
  or body_value not in('sedan','hatchback','suv','other') then raise exception 'Invalid vehicle details'; end if;
 if year_value<>trunc(year_value) or year_value not between 1980 and extract(year from now() at time zone 'Africa/Johannesburg')+1 then
  raise exception 'Enter a valid vehicle year'; end if;
 if seats_value<>trunc(seats_value) or seats_value not between 1 and 7 then raise exception 'Vehicle seats must be between 1 and 7'; end if;
 if p_vehicle ? 'photoPath' and jsonb_typeof(p_vehicle->'photoPath') not in('string','null') then raise exception 'Invalid vehicle photo'; end if;
 photo_value:=p_vehicle->>'photoPath';
 if photo_value is not null and (length(photo_value)>500 or left(photo_value,37)<>owner_id::text||'/'
  or position('..' in photo_value)>0 or photo_value!~'^[A-Za-z0-9/_.-]+$'
  or not exists(select 1 from storage.objects where bucket_id='vehicle-photos' and name=photo_value)) then
  raise exception 'Upload your own vehicle photo first';
 end if;
 -- Same account lock as route publication serialises capacity changes. Existing
 -- vehicle triggers enforce accepted seats and invalidate affected approvals.
 perform 1 from public.profiles where id=owner_id for update;
 insert into public.vehicles(driver_id,make,model,colour,year,body_type,registration_summary,seats_total,photo_path)
 values(owner_id,make_value,model_value,colour_value,year_value::int,body_value,registration_value,seats_value::int,photo_value)
 on conflict(driver_id) do update set make=excluded.make,model=excluded.model,colour=excluded.colour,
  year=excluded.year,body_type=excluded.body_type,registration_summary=excluded.registration_summary,
  seats_total=excluded.seats_total,photo_path=excluded.photo_path
 returning id into saved_id;
 return saved_id;
end $$;
revoke all on function public.save_driver_vehicle(jsonb) from public,anon;
grant execute on function public.save_driver_vehicle(jsonb) to authenticated;
notify pgrst, 'reload schema';
