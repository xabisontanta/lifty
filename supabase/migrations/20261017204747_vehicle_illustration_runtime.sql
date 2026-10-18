-- Optional, disabled-by-default vehicle illustrations. These never update driver
-- verification, vehicle photos, or documents. No catalogue references are seeded.
create table lifty_private.vehicle_illustration_references (
 id uuid primary key default gen_random_uuid(),
 make text not null, model text not null, model_year int not null check(model_year between 1980 and 2100),
 body_type text not null check(body_type in('sedan','hatchback','suv','other')),
 storage_path text not null check(storage_path ~ '^[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp)$' and position('..' in storage_path)=0),
 source_url text not null check(length(source_url) between 10 and 2000),
 rights_confirmed boolean not null default false,
 reviewed_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null,
 active boolean not null default false,
 unique(make,model,model_year,body_type),
 check(make=lower(btrim(regexp_replace(make,'\s+',' ','g'))) and model=lower(btrim(regexp_replace(model,'\s+',' ','g')))),
 check(not active or(rights_confirmed and reviewed_at is not null))
);
create table lifty_private.vehicle_illustration_jobs (
 vehicle_key text primary key check(vehicle_key ~ '^[0-9a-f]{64}$'),
 reference_id uuid not null references lifty_private.vehicle_illustration_references(id) on delete cascade,
 status text not null check(status in('processing','ready','failed')),
 lease uuid, leased_until timestamptz, storage_path text,
 attempts int not null default 1 check(attempts between 1 and 3),
 retry_after timestamptz, updated_at timestamptz not null default now()
);
create table lifty_private.vehicle_illustration_usage (
 user_id uuid not null references public.profiles(id) on delete cascade,
 period date not null, attempts int not null check(attempts between 1 and 3),
 primary key(user_id,period)
);
alter table lifty_private.vehicle_illustration_references enable row level security;
alter table lifty_private.vehicle_illustration_jobs enable row level security;
alter table lifty_private.vehicle_illustration_usage enable row level security;
revoke all on lifty_private.vehicle_illustration_references,lifty_private.vehicle_illustration_jobs,lifty_private.vehicle_illustration_usage from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vehicle-illustration-references','vehicle-illustration-references',false,8388608,array['image/png','image/jpeg','image/webp']),
 ('vehicle-illustrations','vehicle-illustrations',false,8388608,array['image/webp'])
on conflict(id) do nothing;
-- No Storage policies permit browser reference/output writes or reference reads.

create function lifty_private.normalise_illustration_vehicle(v jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare mk text; mdl text; clr text; bt text; yr numeric;
begin
 if v is null or jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in('make','model','year','colour','bodyType')) then return null;end if;
 if jsonb_typeof(v->'make') is distinct from 'string' or jsonb_typeof(v->'model') is distinct from 'string' or jsonb_typeof(v->'colour') is distinct from 'string'
 or jsonb_typeof(v->'bodyType') is distinct from 'string' or jsonb_typeof(v->'year') is distinct from 'number' then return null;end if;
 mk:=lower(btrim(regexp_replace(v->>'make','\s+',' ','g')));mdl:=lower(btrim(regexp_replace(v->>'model','\s+',' ','g')));
 clr:=lower(btrim(regexp_replace(v->>'colour','\s+',' ','g')));bt:=lower(btrim(v->>'bodyType'));yr:=(v->>'year')::numeric;
 if mk='vw' then mk:='volkswagen';end if;if clr='gray' then clr:='grey';end if;
 if length(mk) not between 1 and 80 or length(mdl) not between 1 and 100 or yr<>trunc(yr) or yr not between 1980 and 2100
 or bt not in('sedan','hatchback','suv','other') or clr not in('white','silver','grey','black','blue','red','green','brown','beige','yellow','orange','purple','gold') then return null;end if;
 return jsonb_build_object('make',mk,'model',mdl,'year',yr::int,'colour',clr,'bodyType',bt);
end $$;
revoke all on function lifty_private.normalise_illustration_vehicle(jsonb) from public,anon,authenticated;

-- Called only by the Edge service after auth.getUser verifies the caller JWT.
-- Passive cache reads allow every active signed-in account. Only the driver's
-- exact current saved vehicle/draft can incur a provider request.
create function public.claim_vehicle_illustration(p_user uuid,p_vehicle jsonb,p_generate boolean default false,p_provider_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb; own_vehicle jsonb; ref lifty_private.vehicle_illustration_references; job lifty_private.vehicle_illustration_jobs;
 key text; token uuid; consumed int; today date:=(now() at time zone 'Africa/Johannesburg')::date;
begin
 if not exists(select 1 from public.profiles where id=p_user and suspended_at is null and deletion_requested_at is null) then return jsonb_build_object('status','account-unavailable');end if;
 v:=lifty_private.normalise_illustration_vehicle(p_vehicle);
 if v is null then return jsonb_build_object('status','unavailable','code','invalid-vehicle');end if;
 if p_generate then
  if not exists(select 1 from public.profiles where id=p_user and role='driver') then return jsonb_build_object('status','not-owned');end if;
  if exists(select 1 from public.profiles where id=p_user and onboarding_completed_at is null) then
   select draft->'vehicle' into own_vehicle from lifty_private.driver_onboarding_drafts where user_id=p_user;
   -- Draft years are strings. Build only the strict shared vehicle fields.
   if own_vehicle->>'year' ~ '^[0-9]{4}$' then own_vehicle:=jsonb_build_object('make',own_vehicle->>'make','model',own_vehicle->>'model',
    'year',(own_vehicle->>'year')::int,'colour',own_vehicle->>'colour','bodyType',own_vehicle->>'bodyType');else own_vehicle:=null;end if;
  else
   select jsonb_build_object('make',make,'model',model,'year',year,'colour',colour,'bodyType',body_type) into own_vehicle from public.vehicles where driver_id=p_user;
  end if;
  if lifty_private.normalise_illustration_vehicle(own_vehicle) is distinct from v then return jsonb_build_object('status','not-owned');end if;
 end if;
 select * into ref from lifty_private.vehicle_illustration_references where active and rights_confirmed and reviewed_at is not null
 and make=v->>'make' and model=v->>'model' and model_year=(v->>'year')::int and body_type=v->>'bodyType';
 if ref.id is null then return jsonb_build_object('status','unavailable','code','reference-unavailable');end if;
 -- Review timestamp is a version. Replacing/re-reviewing a reference invalidates
 -- older generated output rather than silently reusing a different body shape.
 key:=encode(extensions.digest(v::text||':'||ref.id::text||':'||extract(epoch from ref.reviewed_at)::text,'sha256'),'hex');
 -- Order is always user, then vehicle key. This serialises quotas and dedupes
 -- simultaneous requests across users, including the first missing cache row.
 if p_generate then perform pg_advisory_xact_lock(hashtextextended('lifty:vehicle:user:'||p_user::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('lifty:vehicle:key:'||key,0));
 select * into job from lifty_private.vehicle_illustration_jobs where vehicle_key=key for update;
 if job.status='ready' then return jsonb_build_object('status','ready','vehicleKey',key,'storagePath',job.storage_path);end if;
 if job.status='processing' and job.leased_until>now() then return jsonb_build_object('status','processing');end if;
 if not p_generate then return jsonb_build_object('status','unavailable','code','cache-miss');end if;
 if not p_provider_enabled then return jsonb_build_object('status','unavailable','code','provider-unconfigured');end if;
 if job.attempts>=3 or job.retry_after>now() then return jsonb_build_object('status','unavailable','code','generation-unavailable');end if;
 insert into lifty_private.vehicle_illustration_usage(user_id,period,attempts) values(p_user,today,1)
 on conflict(user_id,period) do update set attempts=lifty_private.vehicle_illustration_usage.attempts+1
 where lifty_private.vehicle_illustration_usage.attempts<3 returning attempts into consumed;
 if consumed is null then return jsonb_build_object('status','rate-limit');end if;
 token:=gen_random_uuid();
 insert into lifty_private.vehicle_illustration_jobs(vehicle_key,reference_id,status,lease,leased_until)
 values(key,ref.id,'processing',token,now()+interval '3 minutes') on conflict(vehicle_key) do update set
 status='processing',lease=excluded.lease,leased_until=excluded.leased_until,attempts=lifty_private.vehicle_illustration_jobs.attempts+1,updated_at=now();
 return jsonb_build_object('status','claimed','vehicleKey',key,'lease',token,'referencePath',ref.storage_path);
end $$;

create function public.finish_vehicle_illustration(p_key text,p_lease uuid,p_storage_path text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_storage_path is not null and p_storage_path<>p_key||'/'||p_lease::text||'.webp' then raise exception 'Invalid illustration path';end if;
 update lifty_private.vehicle_illustration_jobs set status=case when p_storage_path is null then 'failed' else 'ready' end,
 storage_path=p_storage_path,lease=null,leased_until=null,retry_after=case when p_storage_path is null then now()+interval '1 hour' else null end,updated_at=now()
 where vehicle_key=p_key and lease=p_lease and status='processing' and leased_until>now();
 return found;
end $$;
revoke all on function public.claim_vehicle_illustration(uuid,jsonb,boolean,boolean),public.finish_vehicle_illustration(text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_vehicle_illustration(uuid,jsonb,boolean,boolean),public.finish_vehicle_illustration(text,uuid,text) to service_role;
