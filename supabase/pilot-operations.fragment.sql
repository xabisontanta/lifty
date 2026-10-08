create extension if not exists pg_net;
alter table public.profiles add column deletion_requested_at timestamptz;
create table lifty_private.worker_health(id boolean primary key default true check(id),last_seen timestamptz,push_configured boolean not null default false,last_error text);
insert into lifty_private.worker_health(id) values(true);
create table lifty_private.notification_outbox(id uuid primary key references public.notifications on delete cascade,status text not null default 'pending' check(status in('pending','processing','blocked','sent','failed','no_device')),attempts int not null default 0,next_attempt_at timestamptz not null default now(),lease uuid,leased_until timestamptz,delivered_at timestamptz,last_error text);
create index outbox_due on lifty_private.notification_outbox(next_attempt_at) where status<>'sent';
create table lifty_private.push_receipts(notification_id uuid not null references public.notifications on delete cascade,token_hash text not null,provider_id text,created_at timestamptz not null default now(),primary key(notification_id,token_hash));
create table lifty_private.cleanup_jobs(id uuid primary key default gen_random_uuid(),user_id uuid not null unique,files jsonb not null,status text not null default 'pending',attempts int not null default 0,next_attempt_at timestamptz not null default now(),lease uuid,leased_until timestamptz,last_error text,created_at timestamptz not null default now());
create or replace function lifty_private.enqueue_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into lifty_private.notification_outbox(id) values(new.id) on conflict do nothing;return new;end $$;
create trigger durable_notification after insert on public.notifications for each row execute function lifty_private.enqueue_notification();
create table lifty_private.match_alerts(commute_id uuid not null references public.passenger_commutes on delete cascade,leg_id uuid not null references public.driver_legs on delete cascade,notified_on date not null,primary key(commute_id,leg_id,notified_on));
create or replace function public.run_saved_match_alerts() returns void language plpgsql security definer set search_path='' as $$
declare c public.passenger_commutes; m jsonb; inserted int;
begin
 for c in select x.* from public.passenger_commutes x join public.profiles p on p.id=x.passenger_id where x.notify_on_match and p.suspended_at is null loop
  -- The matching function remains owner-bound; this scheduled transaction sets that owner's claims.
  perform set_config('request.jwt.claim.sub',c.passenger_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c.passenger_id,'role','authenticated')::text,true);
  for m in select * from public.find_matches(c.id) loop
   insert into lifty_private.match_alerts values(c.id,(m->>'legId')::uuid,(now() at time zone 'Africa/Johannesburg')::date) on conflict do nothing;
   get diagnostics inserted=row_count;
   if inserted>0 then perform public.notify(c.passenger_id,'match','A compatible lift is available','Review the covered days before requesting to join.','/p/match/'||(m->>'legId')); end if;
  end loop;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
end $$;
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); files jsonb;
begin
 if me is null then raise exception 'Not authenticated'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]'::jsonb) into files from storage.objects where bucket_id in('avatars','vehicle-photos','kyc') and (split_part(name,'/',1)=me::text or owner_id=me::text);
 insert into lifty_private.cleanup_jobs(user_id,files) values(me,files) on conflict(user_id) do update set files=excluded.files,status='pending',next_attempt_at=now();
 update public.profiles set deletion_requested_at=now(),suspended_at=now(),suspension_reason='Account deletion requested' where id=me;
 update public.profile_private set location_consent_at=null where id=me;
 delete from auth.sessions where user_id=me;
 delete from auth.refresh_tokens where user_id=me::text;
 perform public.reconcile_commutes();
end $$;
create or replace function public.finalize_account_deletion(p_job uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare job lifty_private.cleanup_jobs; l record;
begin
 select * into job from lifty_private.cleanup_jobs where id=p_job and lease=p_lease and status='processing' and leased_until>now() for update;
 if job.id is null then raise exception 'Lease expired'; end if;
 if exists(select 1 from storage.objects where bucket_id in('avatars','vehicle-photos','kyc') and (split_part(name,'/',1)=job.user_id::text or owner_id=job.user_id::text)) then raise exception 'Storage cleanup is incomplete'; end if;
 for l in select leg_id,count(*) n from public.club_members where passenger_id=job.user_id and active group by leg_id loop
  update public.club_members set active=false where passenger_id=job.user_id and leg_id=l.leg_id;
  update public.driver_legs set seats_open=seats_open+l.n where id=l.leg_id;
 end loop;
 delete from auth.users where id=job.user_id;
 delete from lifty_private.cleanup_jobs where id=p_job;
end $$;
create or replace function public.export_my_data() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'; t text; fk text; data jsonb;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 for t,fk in values('profiles','id'),('profile_private','id'),('vehicles','driver_id'),('driver_legs','driver_id'),('verification_documents','user_id'),('passenger_commutes','passenger_id'),('join_requests','passenger_id'),('club_members','passenger_id'),('instance_riders','passenger_id'),('schedule_exceptions','user_id'),('pickup_changes','passenger_id'),('messages','sender_id'),('ratings','rater_id'),('contributions','passenger_id'),('reports','reporter_id'),('location_pings','user_id'),('notifications','user_id'),('push_tokens','user_id') loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I r where %I=$1',t,fk) into data using auth.uid();
  result:=result||jsonb_build_object(t,data);
 end loop;
 return result||jsonb_build_object('exportedAt',now(),'fileManifest',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') from storage.objects where bucket_id in('avatars','vehicle-photos','kyc') and split_part(name,'/',1)=auth.uid()::text));
end $$;
create or replace function public.list_pickup_changes() returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'legId',c.leg_id,'passengerId',c.passenger_id,'passengerName',p.first_name,'date',c.service_date,'pickup',jsonb_build_object('label',c.pickup_label,'area',c.pickup_label,'location',jsonb_build_object('lat',extensions.st_y(c.pickup::extensions.geometry),'lng',extensions.st_x(c.pickup::extensions.geometry))),'status',c.status,'createdAt',floor(extract(epoch from c.created_at)*1000)) from public.pickup_changes c join public.profiles p on p.id=c.passenger_id where c.passenger_id=auth.uid() or public.is_leg_driver(c.leg_id) order by c.created_at desc;
$$;
create or replace function public.suspend_account(p_user uuid,p_suspended boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only'; end if;
 if p_user=auth.uid() or exists(select 1 from public.admins where user_id=p_user) then raise exception 'Admin access must be managed by the project owner'; end if;
 if p_suspended and length(trim(p_reason))<5 then raise exception 'Provide the safety reason'; end if;
 update public.profiles set suspended_at=case when p_suspended then now() else null end,suspension_reason=case when p_suspended then left(p_reason,400) else null end where id=p_user and deletion_requested_at is null;
 if p_suspended then delete from auth.sessions where user_id=p_user;delete from auth.refresh_tokens where user_id=p_user::text;end if;
 perform public.reconcile_commutes();
end $$;
create or replace function public.get_admin_health() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only'; end if;
 return jsonb_build_object('pendingDocuments',(select count(*) from (select distinct on(user_id,kind) status from public.verification_documents order by user_id,kind,created_at desc,id desc)d where status='pending'),
 'openReports',(select count(*) from public.reports where status<>'closed'),'suspendedUsers',(select count(*) from public.profiles where suspended_at is not null),
 'notifications',jsonb_build_object('pending',(select count(*) from lifty_private.notification_outbox where status in('pending','processing','blocked','no_device')),'failed',(select count(*) from lifty_private.notification_outbox where status='failed'),'delivered',(select count(*) from lifty_private.notification_outbox where status='sent'),'providerConfigured',(select push_configured from lifty_private.worker_health)),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'lastRun',r.end_time,'status',coalesce(r.status,'awaiting first run'),'detail',r.return_message)),'[]') from cron.job j left join lateral(select end_time,status,return_message from cron.job_run_details where jobid=j.jobid order by runid desc limit 1)r on true),
 'worker',(select to_jsonb(h) from lifty_private.worker_health h),'cleanupPending',(select count(*) from lifty_private.cleanup_jobs));
end $$;

-- A dedicated Vault credential authorizes cron -> worker, separate from user JWTs.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'lifty_pilot_worker','Cron invocation credential');
create or replace function public.authorize_pilot_worker(p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select p_token is not null and p_token=(select decrypted_secret from vault.decrypted_secrets where name='lifty_pilot_worker');
$$;
create or replace function public.claim_pilot_work(p_push_ready boolean) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare job record; fence uuid;
begin
 update lifty_private.worker_health set last_seen=now(),push_configured=p_push_ready,last_error=null where id;
 for job in select * from lifty_private.cleanup_jobs where next_attempt_at<=now() and (status='pending' or(status='processing' and leased_until<now())) and attempts<10 order by created_at limit 10 for update skip locked loop
  fence:=gen_random_uuid(); update lifty_private.cleanup_jobs set status='processing',attempts=attempts+1,lease=fence,leased_until=now()+interval '5 minutes' where id=job.id;
  return next jsonb_build_object('kind','cleanup','id',job.id,'lease',fence,'files',job.files);
 end loop;
 if not p_push_ready then update lifty_private.notification_outbox set status='blocked',last_error='Firebase not configured' where status in('pending','no_device');return;end if;
 for job in select o.* from lifty_private.notification_outbox o where next_attempt_at<=now() and attempts<6 and (status in('pending','blocked','no_device') or(status='processing' and leased_until<now())) order by next_attempt_at limit 10 for update skip locked loop
  if not exists(select 1 from public.push_tokens t join public.notifications n on n.user_id=t.user_id where n.id=job.id and t.platform='android') then update lifty_private.notification_outbox set status='no_device',next_attempt_at=now()+interval '1 hour',last_error='No Android push destination' where id=job.id;continue;end if;
  fence:=gen_random_uuid(); update lifty_private.notification_outbox set status='processing',attempts=attempts+1,lease=fence,leased_until=now()+interval '5 minutes' where id=job.id;
  return next (select jsonb_build_object('kind','push','id',n.id,'lease',fence,'title',n.title,'body',n.body,'link',n.link,
  'tokens',(select coalesce(jsonb_agg(jsonb_build_object('token',t.token,'hash',encode(extensions.digest(t.token,'sha256'),'hex'))),'[]') from public.push_tokens t where t.user_id=n.user_id and t.platform='android' and not exists(select 1 from lifty_private.push_receipts r where r.notification_id=n.id and r.token_hash=encode(extensions.digest(t.token,'sha256'),'hex')))) from public.notifications n where n.id=job.id);
 end loop;
end $$;
create or replace function public.record_push_receipt(p_id uuid,p_lease uuid,p_hash text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from lifty_private.notification_outbox where id=p_id and lease=p_lease and status='processing' and leased_until>now()) then raise exception 'Lease expired';end if;
 insert into lifty_private.push_receipts(notification_id,token_hash,provider_id) values(p_id,p_hash,p_provider) on conflict do nothing;
end $$;
create or replace function public.finish_pilot_work(p_kind text,p_id uuid,p_lease uuid,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_kind='push' then
  update lifty_private.notification_outbox set status=case when p_error is null then 'sent' when attempts>=6 then 'failed' else 'pending' end,delivered_at=case when p_error is null then now() else null end,last_error=left(p_error,300),lease=null,leased_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::int)) where id=p_id and lease=p_lease and leased_until>now();
 else update lifty_private.cleanup_jobs set status=case when attempts>=10 then 'failed' else 'pending' end,last_error=left(p_error,300),lease=null,leased_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::int)) where id=p_id and lease=p_lease and leased_until>now(); end if;
end $$;
create or replace function public.invoke_pilot_worker() returns void language plpgsql security definer set search_path='' as $$
begin
 perform net.http_post(url:='https://kdjzevtryezwbjdgyqaf.supabase.co/functions/v1/pilot-worker',headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='lifty_pilot_worker')),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
-- Only scheduler/service roles can run background operations or access worker credentials.
revoke all on all tables in schema lifty_private from public,anon,authenticated;
revoke all on all functions in schema lifty_private from public,anon,authenticated;
do $$ declare f record;begin
 for f in select p.oid::regprocedure fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' loop
  execute format('revoke execute on function %s from public,anon',f.fn);
 end loop;
end $$;
revoke execute on function public.generate_commute_instances(date),public.reconcile_commutes(),public.generate_contributions(),public.run_saved_match_alerts(),public.invoke_pilot_worker(),public.authorize_pilot_worker(text),public.claim_pilot_work(boolean),public.record_push_receipt(uuid,uuid,text,text),public.finish_pilot_work(text,uuid,uuid,text),public.finalize_account_deletion(uuid,uuid) from authenticated;
grant execute on function public.authorize_pilot_worker(text),public.claim_pilot_work(boolean),public.record_push_receipt(uuid,uuid,text,text),public.finish_pilot_work(text,uuid,uuid,text),public.finalize_account_deletion(uuid,uuid) to service_role;
-- Existing notification and trigger helpers must never be callable by app users.
revoke execute on function public.notify(uuid,text,text,text,text),public.on_rating_insert() from authenticated;
grant execute on function public.account_active(),public.driver_verification(uuid),public.driver_approved(uuid),public.bootstrap_account(text,public.user_role),public.complete_onboarding(),public.get_account_snapshot(),public.save_driver_settings(uuid,int,int,int,time,smallint[]),public.request_pickup_change(uuid,date,text,float8,float8),public.review_pickup_change(uuid,boolean),public.set_club_pause(uuid,boolean),public.report_contribution(uuid,text),public.confirm_contribution(uuid),public.can_receive_location(text),public.publish_location(uuid,float8,float8,real,real),public.mark_driver_arrived(uuid,uuid),public.stop_my_sharing(uuid),public.get_commute_history(),public.list_pickup_changes(),public.suspend_account(uuid,boolean,text),public.get_admin_health() to authenticated;
revoke insert,update,delete on public.pickup_changes from anon,authenticated;
-- Account suspension is restrictive across all app data and private uploads.
do $$ declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in('profiles','profile_private','admins','pickup_points') loop
  execute format('create policy account_must_be_active on public.%I as restrictive for all to authenticated using(public.account_active()) with check(public.account_active())',t);
 end loop;
end $$;
create policy storage_account_active on storage.objects as restrictive for all to authenticated using(public.account_active()) with check(public.account_active());
select cron.alter_job(jobid,schedule:='5 21 * * *') from cron.job where command like '%generate_commute_instances%';
select cron.schedule('lifty-reconcile','10 * * * *','select public.reconcile_commutes();');
select cron.schedule('lifty-saved-matches','20 * * * *','select public.run_saved_match_alerts();');
select cron.schedule('lifty-pilot-worker','* * * * *','select public.invoke_pilot_worker();');
select public.reconcile_commutes();
