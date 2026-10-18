-- Guarded local runner only; every fixture and assertion rolls back.
begin;
select set_config('lifty.image_checks','0',true);
create function public.image_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if not coalesce(ok,false) then raise exception 'Vehicle illustration: %',label;end if;
 perform set_config('lifty.image_checks',(current_setting('lifty.image_checks')::int+1)::text,true);
end $$;
create function public.image_error(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement;raise exception 'Expected rejection did not occur';exception when others then if sqlerrm not like expected then raise;end if;end;
 perform public.image_assert(true,label);
end $$;

do $$ declare d uuid:=gen_random_uuid();p uuid:=gen_random_uuid();r uuid:=gen_random_uuid();spec jsonb:='{"make":"volkswagen","model":"polo vivo","year":2022,"colour":"silver","bodyType":"hatchback"}';j jsonb;begin
 insert into auth.users(id,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select u,'authenticated','authenticated','{"provider":"email"}','{}',now(),now() from unnest(array[d,p])u;
 insert into public.profiles(id,role,first_name) values(d,'driver','Illustration'),(p,'passenger','Illustration');
 insert into lifty_private.driver_onboarding_drafts(user_id,draft) values(d,'{"step":1,"vehicle":{"make":"VW","model":"Polo Vivo","year":"2022","colour":"Silver","bodyType":"hatchback","registration":"AB TEST"}}');
 perform set_config('lifty.image_driver',d::text,true);perform set_config('lifty.image_passenger',p::text,true);perform set_config('lifty.image_reference',r::text,true);
 perform set_config('lifty.image_vehicle',spec::text,true);
 perform public.image_assert(not has_function_privilege('authenticated','public.claim_vehicle_illustration(uuid,jsonb,boolean,boolean)','execute'),'authenticated cannot spoof caller id');
 perform public.image_assert(not has_function_privilege('anon','public.claim_vehicle_illustration(uuid,jsonb,boolean,boolean)','execute'),'anonymous cannot claim');
 perform public.image_assert(not has_function_privilege('authenticated','public.finish_vehicle_illustration(text,uuid,text)','execute'),'browser cannot publish output');
 perform public.image_assert(has_function_privilege('service_role','public.claim_vehicle_illustration(uuid,jsonb,boolean,boolean)','execute'),'verified edge service can claim');
 perform public.image_assert(not has_table_privilege('authenticated','lifty_private.vehicle_illustration_references','select'),'catalogue references remain private');
 perform public.image_assert(not has_table_privilege('authenticated','lifty_private.vehicle_illustration_jobs','insert'),'browser cannot write cache');
 perform public.image_assert((select bool_and(not public) from storage.buckets where id in('vehicle-illustrations','vehicle-illustration-references')),'references and output use private buckets');
 perform public.image_assert((select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='lifty_private' and c.relname in('vehicle_illustration_references','vehicle_illustration_jobs','vehicle_illustration_usage') and c.relrowsecurity),'all private tables have RLS');
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'code'='reference-unavailable','unknown model returns no image');
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,true)->>'code'='reference-unavailable','no free-text provider generation without reference');
 perform public.image_assert(public.claim_vehicle_illustration(p,spec,true,true)->>'status'='not-owned','passenger cannot incur generation');
 perform public.image_assert(public.claim_vehicle_illustration(gen_random_uuid(),spec)->>'status'='account-unavailable','nonexistent account rejected');
 insert into lifty_private.vehicle_illustration_references(id,make,model,model_year,body_type,storage_path,source_url)
 values(r,'volkswagen','polo vivo',2022,'hatchback','test-fixture/polo.png','https://source.invalid/reviewed');
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,true)->>'code'='reference-unavailable','unreviewed reference unusable');
 update lifty_private.vehicle_illustration_references set rights_confirmed=true,reviewed_at=now(),active=true where id=r;
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'code'='cache-miss','passive cache miss does not generate');
 perform public.image_assert(not exists(select 1 from lifty_private.vehicle_illustration_jobs where reference_id=r),'passive cache miss creates no job');
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,false)->>'code'='provider-unconfigured','provider disabled is truthful');
 perform public.image_assert(not exists(select 1 from lifty_private.vehicle_illustration_usage where user_id=d),'unconfigured provider consumes no quota');
 perform public.image_assert(public.claim_vehicle_illustration(d,jsonb_set(spec,'{year}','2021'),true,true)->>'status'='not-owned','different model year cannot generate');
 perform public.image_assert(public.claim_vehicle_illustration(p,jsonb_set(spec,'{year}','2021'))->>'code'='reference-unavailable','different year cannot read a substitute');
 perform public.image_assert(public.claim_vehicle_illustration(d,jsonb_set(spec,'{colour}','"blue"'),true,true)->>'status'='not-owned','draft colour must match');
 j:=public.claim_vehicle_illustration(d,spec,true,true);
 perform public.image_assert(j->>'status'='claimed','owned exact saved draft can claim');
 perform public.image_assert(j->>'referencePath'='test-fixture/polo.png','service claim uses only reviewed reference');
 perform set_config('lifty.image_key',j->>'vehicleKey',true);perform set_config('lifty.image_lease',j->>'lease',true);
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,true)->>'status'='processing','duplicate claim deduplicates');
 perform public.image_assert((select attempts=1 from lifty_private.vehicle_illustration_usage where user_id=d),'duplicate claim consumes no additional quota');
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'status'='processing','passive participant sees in-flight state');
 perform public.image_assert(not public.finish_vehicle_illustration(j->>'vehicleKey',gen_random_uuid(),null),'wrong lease cannot change job');
 perform public.image_assert(public.finish_vehicle_illustration(j->>'vehicleKey',(j->>'lease')::uuid,null),'provider failure releases lease');
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,true)->>'code'='generation-unavailable','failed job backs off before retry');
 update lifty_private.vehicle_illustration_jobs set retry_after=now()-interval '1 minute' where vehicle_key=j->>'vehicleKey';
 j:=public.claim_vehicle_illustration(d,spec,true,true);
 perform public.image_assert(j->>'status'='claimed','explicit retry after backoff works');
 perform public.image_assert(not public.finish_vehicle_illustration(j->>'vehicleKey',current_setting('lifty.image_lease')::uuid,null),'stale lease cannot complete newer request');
 perform set_config('lifty.image_lease',j->>'lease',true);
 perform public.image_assert(public.finish_vehicle_illustration(j->>'vehicleKey',(j->>'lease')::uuid,(j->>'vehicleKey')||'/'||(j->>'lease')||'.webp'),'matching lease publishes only its path');
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'status'='ready','passenger can read ready model illustration');
 perform public.image_assert(public.claim_vehicle_illustration(d,spec,true,false)->>'status'='ready','cached illustration works without provider key');
 perform public.image_assert((select attempts=2 from lifty_private.vehicle_illustration_usage where user_id=d),'ready cache consumes no quota');
 perform public.image_assert(public.claim_vehicle_illustration(p,jsonb_set(spec,'{colour}','"blue"'))->>'code'='cache-miss','paint does not reuse silver cache');
 perform public.image_assert(public.claim_vehicle_illustration(p,jsonb_set(spec,'{model}','"polo"'))->>'code'='reference-unavailable','Polo never substitutes for Polo Vivo');
 perform public.image_assert(public.claim_vehicle_illustration(p,jsonb_set(spec,'{bodyType}','"sedan"'))->>'code'='reference-unavailable','wrong body style does not reuse hatchback');
 -- Third permitted generation uses another explicitly saved colour.
 update lifty_private.driver_onboarding_drafts set draft=jsonb_set(draft,'{vehicle,colour}','"blue"') where user_id=d;
 j:=public.claim_vehicle_illustration(d,jsonb_set(spec,'{colour}','"blue"'),true,true);
 perform public.image_assert(j->>'status'='claimed','updated saved colour has a separate exact cache');
 perform public.finish_vehicle_illustration(j->>'vehicleKey',(j->>'lease')::uuid,null);
 update lifty_private.driver_onboarding_drafts set draft=jsonb_set(draft,'{vehicle,colour}','"red"') where user_id=d;
 perform public.image_assert(public.claim_vehicle_illustration(d,jsonb_set(spec,'{colour}','"red"'),true,true)->>'status'='rate-limit','fourth new daily attempt rejected');
 update public.profiles set suspended_at=now() where id=p;
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'status'='account-unavailable','suspended user cannot even read cache');
 update public.profiles set suspended_at=null where id=p;
 update lifty_private.vehicle_illustration_references set active=false where id=r;
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'code'='reference-unavailable','reference withdrawal immediately hides generated output');
 update lifty_private.vehicle_illustration_references set active=true,reviewed_at=now()+interval '1 second' where id=r;
 perform public.image_assert(public.claim_vehicle_illustration(p,spec)->>'code'='cache-miss','re-review invalidates old generated output');
 perform public.image_assert((select identity_status is null from public.profiles where id=d),'illustration never verifies driver');
 perform public.image_assert((select count(*)=0 from public.verification_documents where user_id=d),'illustration never creates verification documents');
end $$;
select public.image_error(format('select public.finish_vehicle_illustration(%L,%L,%L)',current_setting('lifty.image_key'),current_setting('lifty.image_lease'),'other-driver/file.webp'),'Invalid illustration path','arbitrary storage path rejected');
select jsonb_build_object('suite','vehicle-illustrations','passed',current_setting('lifty.image_checks')::int,'failed',0);
rollback;
