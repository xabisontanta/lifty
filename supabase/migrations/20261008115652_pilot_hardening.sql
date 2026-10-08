-- A transaction can upload several documents at the same timestamp. Sequence
-- order makes the newest submission deterministic even in that case.
alter table public.verification_documents add column submitted_seq bigint generated always as identity;
create index verification_latest on public.verification_documents(user_id,kind,created_at desc,submitted_seq desc);
create or replace function public.driver_verification(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with latest as(select distinct on(kind) kind,status from public.verification_documents where user_id=p_user and kind in('id','licence','vehicle_registration','insurance') order by kind,created_at desc,submitted_seq desc)
 select jsonb_build_object('identity',coalesce((select status::text from latest where kind='id'),'pending'),'licence',coalesce((select status::text from latest where kind='licence'),'pending'),'vehicle',coalesce((select status::text from latest where kind='vehicle_registration'),'pending'),'insurance',coalesce((select status::text from latest where kind='insurance'),'pending'));
$$;
create or replace function public.review_document(p_doc uuid,p_approve boolean,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare d public.verification_documents;
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only';end if;
 select * into d from public.verification_documents where id=p_doc for update;
 if d.id is null then raise exception 'Document not found';end if;
 if exists(select 1 from public.verification_documents where user_id=d.user_id and kind=d.kind and (created_at,submitted_seq)>(d.created_at,d.submitted_seq)) then raise exception 'This document has been replaced';end if;
 update public.verification_documents set status=case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note where id=p_doc;
 perform public.notify(d.user_id,'verification','Document reviewed',case when p_approve then 'Your document was approved.' else coalesce(p_note,'Replace this document.') end,'/d/profile');
end $$;
create or replace function public.list_pending_documents() returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only';end if;
 return query with latest as(select distinct on(user_id,kind)* from public.verification_documents order by user_id,kind,created_at desc,submitted_seq desc)
 select jsonb_build_object('id',d.id,'userId',d.user_id,'userName',p.first_name||' '||p.last_initial,'kind',d.kind,'storagePath',d.storage_path,'detail',d.detail,'createdAt',floor(extract(epoch from d.created_at)*1000),
 'progress',public.driver_verification(d.user_id)) from latest d join public.profiles p on p.id=d.user_id where d.status='pending';
end $$;
revoke all on function public.list_pending_documents() from public,anon;
grant execute on function public.list_pending_documents() to authenticated;
create or replace function public.list_safety_reports() returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only';end if;
 return query select jsonb_build_object('id',r.id,'kind',r.kind,'body',r.body,'status',r.status,'createdAt',floor(extract(epoch from r.created_at)*1000),'reporterId',r.reporter_id,'subjectId',r.subject_id,'reporterName',p.first_name,'subjectName',q.first_name)
 from public.reports r join public.profiles p on p.id=r.reporter_id left join public.profiles q on q.id=r.subject_id order by r.created_at desc limit 100;
end $$;
revoke all on function public.list_safety_reports() from public,anon;
grant execute on function public.list_safety_reports() to authenticated;
create or replace function public.get_account_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if exists(select 1 from public.profiles where id=auth.uid() and suspended_at is not null) then raise exception 'Your account is suspended. Contact Lifty support.'; end if;
 return (select jsonb_build_object('profile',to_jsonb(p),'private',(select to_jsonb(q) from public.profile_private q where q.id=p.id),
 'vehicle',(select to_jsonb(v) from public.vehicles v where v.driver_id=p.id),
 'verification',public.driver_verification(p.id),
 'commutes',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('originPoint',extensions.st_asgeojson(c.origin::extensions.geometry)::jsonb,'destinationPoint',extensions.st_asgeojson(c.destination::extensions.geometry)::jsonb)) from public.passenger_commutes c where c.passenger_id=p.id),'[]'),
 'memberCount',(select count(*) from public.club_members m join public.driver_legs l on l.id=m.leg_id where l.driver_id=p.id and l.direction='to_work' and m.active),
 'legs',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('originPoint',extensions.st_asgeojson(l.origin::extensions.geometry)::jsonb,'destinationPoint',extensions.st_asgeojson(l.destination::extensions.geometry)::jsonb,'routeGeometry',extensions.st_asgeojson(l.route::extensions.geometry)::jsonb)) from public.driver_legs l where l.driver_id=p.id),'[]'),
 'documents',coalesce((select jsonb_agg(to_jsonb(d)) from (select distinct on(kind) kind,status from public.verification_documents where user_id=p.id order by kind,created_at desc,submitted_seq desc)d),'[]'),
 'exceptions',coalesce((select jsonb_agg(to_jsonb(e)) from public.schedule_exceptions e where e.user_id=p.id),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from public.join_requests r where r.passenger_id=p.id and r.status in ('pending','accepted')),'[]')) from public.profiles p where p.id=auth.uid());
end $$;
