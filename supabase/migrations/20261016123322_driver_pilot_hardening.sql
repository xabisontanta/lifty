-- Additive driver pilot hardening. Never grants verification from a draft/upload.
-- Private helpers are not exposed through PostgREST; public RPCs validate current
-- account/membership on every call and preserve the test-environment boundary.

create table lifty_private.driver_onboarding_drafts (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 draft jsonb not null, updated_at timestamptz not null default now()
);
alter table lifty_private.driver_onboarding_drafts enable row level security;
revoke all on lifty_private.driver_onboarding_drafts from public,anon,authenticated;

create or replace function public.save_driver_onboarding_draft(p_draft jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare j jsonb; k text; n numeric;
begin
 if not public.account_active() or not exists(select 1 from public.profiles where id=auth.uid() and role='driver') then raise exception 'Driver account required';end if;
 -- A late autosave must not recreate a completed setup draft.
 if exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed_at is not null) then return;end if;
 if p_draft is null or jsonb_typeof(p_draft)<>'object' or octet_length(p_draft::text)>24576
 or exists(select 1 from jsonb_object_keys(p_draft) keys(key) where keys.key not in('step','vehicle','commute','seatsOpen','monthlyContribution','vehiclePhotoPath')) then raise exception 'Invalid onboarding draft';end if;
 if p_draft ? 'vehiclePhotoPath' and (jsonb_typeof(p_draft->'vehiclePhotoPath')<>'string'
 or left(p_draft->>'vehiclePhotoPath',37)<>auth.uid()::text||'/' or length(p_draft->>'vehiclePhotoPath')>500
 or position('..' in p_draft->>'vehiclePhotoPath')>0 or p_draft->>'vehiclePhotoPath'!~'^[a-zA-Z0-9/_.-]+$') then raise exception 'Invalid draft vehicle photo';end if;
 if p_draft ? 'step' and (jsonb_typeof(p_draft->'step')<>'number' or (p_draft->>'step')::numeric not in(1,2,3,4)) then raise exception 'Invalid onboarding step';end if;
 if p_draft ? 'vehicle' then
  j:=p_draft->'vehicle';
  if jsonb_typeof(j)<>'object' or exists(select 1 from jsonb_object_keys(j) keys(key) where keys.key not in('registration','make','model','year','colour','seats','bodyType')) then raise exception 'Invalid draft vehicle';end if;
  for k in select jsonb_object_keys(j) loop
   if k='seats' then
    if jsonb_typeof(j->k)<>'number' or (j->>k)::numeric not between 1 and 7 or trunc((j->>k)::numeric)<>(j->>k)::numeric then raise exception 'Invalid draft seats';end if;
   elsif jsonb_typeof(j->k)<>'string' or length(j->>k)>150 then raise exception 'Invalid draft vehicle field';end if;
  end loop;
  if j ? 'bodyType' and j->>'bodyType' not in('sedan','hatchback','suv','other') then raise exception 'Invalid draft vehicle type';end if;
 end if;
 if p_draft ? 'commute' then
  j:=p_draft->'commute';
  if jsonb_typeof(j)<>'object' or exists(select 1 from jsonb_object_keys(j) keys(key) where keys.key not in('origin','destination','originPlace','destinationPlace','offerReturn','departure','returnTime','days','maxDeviationMin')) then raise exception 'Invalid draft commute';end if;
  for k in select jsonb_object_keys(j) loop
   if k in('origin','destination') then
    if jsonb_typeof(j->k)<>'string' or length(j->>k)>500 then raise exception 'Invalid draft address';end if;
   elsif k in('originPlace','destinationPlace') then
    if jsonb_typeof(j->k)<>'object' or exists(select 1 from jsonb_object_keys(j->k) x where x not in('label','lng','lat'))
     or jsonb_typeof(j->k->'label') is distinct from 'string' or length(j->k->>'label')>500
     or jsonb_typeof(j->k->'lng') is distinct from 'number' or jsonb_typeof(j->k->'lat') is distinct from 'number'
     or abs((j->k->>'lng')::numeric)>180 or abs((j->k->>'lat')::numeric)>90 then raise exception 'Invalid draft coordinates';end if;
   elsif k='offerReturn' then
    if jsonb_typeof(j->k)<>'boolean' then raise exception 'Invalid return preference';end if;
   elsif k in('departure','returnTime') then
    if jsonb_typeof(j->k)<>'string' or (j->>k)!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid draft departure';end if;
   elsif k='days' then
    if jsonb_typeof(j->k)<>'array' or jsonb_array_length(j->k)>7 then raise exception 'Invalid draft weekdays';end if;
    if exists(select 1 from jsonb_array_elements(j->k) d where jsonb_typeof(d)<>'number' or d::text !~ '^[0-6]$') then raise exception 'Invalid draft weekdays';end if;
   elsif k='maxDeviationMin' then
    if jsonb_typeof(j->k)<>'number' or (j->>k)::numeric not between 0 and 30 then raise exception 'Invalid draft detour';end if;
   end if;
  end loop;
 end if;
 foreach k in array array['seatsOpen','monthlyContribution'] loop
  if p_draft ? k then
   if jsonb_typeof(p_draft->k)<>'number' then raise exception 'Invalid draft amount';end if;
   n:=(p_draft->>k)::numeric;
   if n<0 or n>(case when k='seatsOpen' then 7 else 100000 end) or trunc(n)<>n then raise exception 'Invalid draft amount';end if;
  end if;
 end loop;
 insert into lifty_private.driver_onboarding_drafts(user_id,draft) values(auth.uid(),p_draft)
 on conflict(user_id) do update set draft=excluded.draft,updated_at=now();
end $$;
create or replace function lifty_private.membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.active,new.paused) is distinct from (old.active,old.paused) then perform lifty_private.reconcile_leg(new.leg_id);end if;
 return new;
end $$;
create or replace function public.remove_member(p_leg uuid,p_passenger uuid) returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs;
begin
 select * into l from public.driver_legs where id=p_leg for update;
 if not public.is_leg_driver(p_leg) then raise exception 'Not your lift club';end if;
 if exists(select 1 from public.instance_riders r join public.commute_instances i on i.id=r.instance_id where i.leg_id=p_leg and r.passenger_id=p_passenger and r.status='collected' and i.status not in('completed','cancelled')) then
  raise exception 'Complete the current commute before ending this passenger arrangement';
 end if;
 update public.club_members set active=false where leg_id=p_leg and passenger_id=p_passenger and active;
 if found then
  update public.driver_legs set seats_open=seats_open+1 where id=p_leg;
  perform public.notify(p_passenger,'removed','Lift club update','Your driver has ended this arrangement. Future pickups are cancelled.','/p/commute');
 end if;
end $$;
create or replace function public.get_driver_onboarding_draft() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.account_active() or not exists(select 1 from public.profiles where id=auth.uid() and role='driver') then raise exception 'Driver account required';end if;
 return(select draft from lifty_private.driver_onboarding_drafts where user_id=auth.uid());
end $$;
create or replace function public.clear_driver_onboarding_draft() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() then raise exception 'Account unavailable';end if;
 delete from lifty_private.driver_onboarding_drafts where user_id=auth.uid();
end $$;

-- A monotonic server sequence avoids timestamp/UUID ordering races for read cursors.
alter table public.messages add column message_seq bigint generated always as identity;
create unique index messages_sequence on public.messages(message_seq);
create index messages_club_sequence on public.messages(leg_id,message_seq desc);
create table lifty_private.club_read_cursors (
 user_id uuid not null references public.profiles(id) on delete cascade,
 leg_id uuid not null references public.driver_legs(id) on delete cascade,
 message_seq bigint not null default 0, primary key(user_id,leg_id)
);
alter table lifty_private.club_read_cursors enable row level security;
revoke all on lifty_private.club_read_cursors from public,anon,authenticated;
alter table public.notifications add column source_message_id uuid references public.messages(id) on delete cascade;
create unique index notification_message_recipient on public.notifications(source_message_id,user_id) where source_message_id is not null;

create or replace function lifty_private.club_message_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- No message body in lock-screen previews. Explicit leg context preserves fixture isolation.
 insert into public.notifications(user_id,kind,title,body,link,source_leg_id,source_message_id)
 select u.id,'message','New lift club message','Open your lift club conversation to read it.',
 case when u.role='driver' then '/d/chat/' else '/p/chat/' end||new.leg_id::text,new.leg_id,new.id
 from public.profiles u where u.suspended_at is null and u.id<>new.sender_id
 and (u.id=(select driver_id from public.driver_legs where id=new.leg_id)
 or exists(select 1 from public.club_members m where m.leg_id=new.leg_id and m.passenger_id=u.id and m.active))
 and public.can_view_test_leg(new.leg_id,u.id)
 on conflict(source_message_id,user_id) where source_message_id is not null do nothing;
 return new;
end $$;
create trigger club_message_notify after insert on public.messages for each row execute function lifty_private.club_message_notification();
revoke insert on public.messages from authenticated;
create or replace function public.send_club_message(p_leg uuid,p_message uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; t text:=btrim(p_body);
begin
 -- Identity sequences are allocated before commit. Serialise each club's sends
 -- so a later read cursor cannot skip an earlier message still in flight.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lifty:chat:'||p_leg::text,0));
 if not public.is_leg_member(p_leg) then raise exception 'This conversation is unavailable';end if;
 if p_message is null or t is null or length(t) not between 1 and 1000 then raise exception 'Enter a message between 1 and 1000 characters';end if;
 insert into public.messages(id,leg_id,sender_id,body) values(p_message,p_leg,auth.uid(),t) on conflict(id) do nothing returning * into m;
 if m.id is null then
  select * into m from public.messages where id=p_message;
  if m.sender_id is distinct from auth.uid() or m.leg_id is distinct from p_leg or m.body is distinct from t then raise exception 'Message identifier is already in use';end if;
 end if;
 return jsonb_build_object('id',m.id,'leg_id',m.leg_id,'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at);
end $$;
create or replace function public.mark_club_read(p_leg uuid,p_message uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare s bigint;
begin
 if not public.is_leg_member(p_leg) then raise exception 'This conversation is unavailable';end if;
 if p_message is not null then
  select message_seq into s from public.messages where id=p_message and leg_id=p_leg;
  if s is null then raise exception 'Message is unavailable';end if;
 else select coalesce(max(message_seq),0) into s from public.messages where leg_id=p_leg;end if;
 insert into lifty_private.club_read_cursors(user_id,leg_id,message_seq) values(auth.uid(),p_leg,s)
 on conflict(user_id,leg_id) do update set message_seq=greatest(lifty_private.club_read_cursors.message_seq,excluded.message_seq);
 update public.notifications n set read_at=coalesce(read_at,now()) from public.messages m
 where n.user_id=auth.uid() and n.source_message_id=m.id and m.leg_id=p_leg and m.message_seq<=s;
end $$;
create or replace function public.list_chat_summaries() returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('legId',l.id,'title',case when l.direction='to_work' then 'Morning' else 'Evening' end||' lift club',
 'memberCount',1+(select count(*) from public.club_members m where m.leg_id=l.id and m.active),
 'unreadCount',(select count(*) from public.messages m where m.leg_id=l.id and m.sender_id<>auth.uid() and m.message_seq>coalesce(c.message_seq,0)),
 'lastMessage',(select jsonb_build_object('id',m.id,'sequence',m.message_seq,'senderId',m.sender_id,'senderName',p.first_name,'body',m.body,
 'createdAt',floor(extract(epoch from m.created_at)*1000),'mine',m.sender_id=auth.uid()) from public.messages m join public.profiles p on p.id=m.sender_id where m.leg_id=l.id order by m.message_seq desc limit 1))
 from public.driver_legs l left join lifty_private.club_read_cursors c on c.leg_id=l.id and c.user_id=auth.uid()
 where public.is_leg_member(l.id)
 and exists(select 1 from public.club_members m where m.leg_id=l.id and m.active)
 order by coalesce((select max(message_seq) from public.messages where leg_id=l.id),0) desc,l.id;
$$;

alter table public.driver_legs add column requests_paused boolean not null default false;
create or replace function public.set_driver_requests_paused(p_leg uuid,p_paused boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_paused is null or not public.is_leg_driver(p_leg) then raise exception 'Not your commute';end if;
 update public.driver_legs set requests_paused=p_paused where id=p_leg;
end $$;
-- Pause affects discovery, fresh quotes, submissions and acceptance, never existing trips.
-- Return the persisted pause flag so clients can reopen requests after reload.
do $$ declare d text;begin
 d:=pg_get_functiondef('lifty_private.raw_get_my_clubs()'::regprocedure);
 if position('''seatsOpen'', l.seats_open' in d)=0 then raise exception 'Driver pause snapshot patch requires review';end if;
 d:=replace(d,'''seatsOpen'', l.seats_open','''seatsOpen'', l.seats_open, ''requestsPaused'', l.requests_paused');
 execute replace(d,'''paymentStatus'', (select','''monthlyContribution'', x.monthly_contribution, ''paymentStatus'', (select');
end $$;

do $$ declare f text;d text;begin
 foreach f in array array['lifty_private.raw_match_candidates(uuid,uuid)','lifty_private.raw_find_matches(uuid)'] loop
  d:=pg_get_functiondef(f::regprocedure);
  if position('l.active' in d)=0 then raise exception 'Matching pause patch requires review';end if;
  execute replace(d,'l.active','(l.active and not l.requests_paused)');
 end loop;
 d:=pg_get_functiondef('lifty_private.raw_persist_match_quotes(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 if position('not l.active' in d)=0 then raise exception 'Quote pause patch requires review';end if;
 execute replace(d,'not l.active','(not l.active or l.requests_paused)');
 d:=pg_get_functiondef('lifty_private.raw_request_to_join_quote(uuid,uuid,uuid)'::regprocedure);
 if position('l.id is null' in d)=0 then raise exception 'Request pause patch requires review';end if;
 execute replace(d,'l.id is null','(l.id is null or l.requests_paused)');
end $$;

-- Expiry is a date in the operating timezone, checked dynamically rather than a
-- stale profile badge. Older approved rows retain approval until dates are recorded.
alter table public.verification_documents add column expires_on date;
grant insert(expires_on) on public.verification_documents to authenticated;
create or replace function lifty_private.raw_driver_verification(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with latest as(select distinct on(kind) kind,case when status='verified' and expires_on<(now() at time zone 'Africa/Johannesburg')::date then 'expired' else status::text end status
 from public.verification_documents where user_id=p_user and kind in('id','licence','vehicle_registration','insurance') order by kind,created_at desc,submitted_seq desc)
 select jsonb_build_object('identity',coalesce((select status from latest where kind='id'),'pending'),'licence',coalesce((select status from latest where kind='licence'),'pending'),
 'vehicle',coalesce((select status from latest where kind='vehicle_registration'),'pending'),'insurance',coalesce((select status from latest where kind='insurance'),'pending'));
$$;
create or replace function lifty_private.verification_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 v:=public.driver_verification(new.user_id);
 update public.profiles set identity_status=case when v->>'identity'='expired' then 'pending'::public.verification_status else (v->>'identity')::public.verification_status end where id=new.user_id;
 update public.vehicles set status=case when v->>'vehicle'='verified' and v->>'insurance'='verified' then 'verified'::public.verification_status else 'pending'::public.verification_status end where driver_id=new.user_id;
 return new;
end $$;
create or replace function public.review_document(p_doc uuid,p_approve boolean,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare d public.verification_documents;
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only';end if;
 select * into d from public.verification_documents where id=p_doc for update;
 if d.id is null then raise exception 'Document not found';end if;
 if exists(select 1 from public.verification_documents where user_id=d.user_id and kind=d.kind and (created_at,submitted_seq)>(d.created_at,d.submitted_seq)) then raise exception 'This document has been replaced';end if;
 if p_approve and d.expires_on<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'Expired documents cannot be approved';end if;
 if p_approve and d.kind in('licence','insurance') and d.expires_on is null and d.status<>'verified' then raise exception 'Record the document expiry date before approval';end if;
 if not p_approve and length(btrim(coalesce(p_note,'')))<3 then raise exception 'Explain what the driver needs to correct';end if;
 update public.verification_documents set status=case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_note,1000) where id=p_doc;
 perform public.notify(d.user_id,'verification','Document reviewed',case when p_approve then 'Your document was approved.' else p_note end,'/d/profile');
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.complete_onboarding()'::regprocedure);
 if position('update public.profiles set onboarding_completed_at=' in d)=0 then raise exception 'Onboarding draft completion requires review';end if;
 d:=replace(d,'end $function$',' delete from lifty_private.driver_onboarding_drafts where user_id=auth.uid();'||chr(10)||'end $function$');execute d;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('lifty_private.raw_get_account_snapshot()'::regprocedure);
 if position('kind, status' in d)>0 then d:=replace(d,'kind, status','id, kind, status, expires_on, review_note');
 elsif position('kind,status' in d)>0 then d:=replace(d,'kind,status','id,kind,status,expires_on,review_note');
 else raise exception 'Snapshot document patch requires review';end if;
 execute d;
 d:=pg_get_functiondef('public.list_pending_documents()'::regprocedure);
 if position('''detail'',d.detail' in d)=0 then raise exception 'Reviewer expiry patch requires review';end if;
 execute replace(d,'''detail'',d.detail','''detail'',d.detail,''expiresOn'',d.expires_on');
end $$;

-- Only the owning passenger can withdraw a pending request. Repeated calls are
-- harmless; the driver receives a durable event only for the actual transition.
create or replace function public.cancel_join_request(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.join_requests;
begin
 select * into r from public.join_requests where id=p_request for update;
 if not public.account_active() or r.passenger_id is distinct from auth.uid() or not public.can_view_test_leg(r.leg_id) then raise exception 'Request unavailable';end if;
 if r.status='cancelled' then return;end if;
 if r.status<>'pending' then raise exception 'Only pending requests can be withdrawn';end if;
 update public.join_requests set status='cancelled',responded_at=now() where id=r.id;
 perform public.notify(l.driver_id,'request_cancelled','Lift request withdrawn','The passenger withdrew this request.','/d/request/'||r.id::text||'?request='||r.id::text) from public.driver_legs l where l.id=r.leg_id;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('lifty_private.raw_list_incoming_requests()'::regprocedure);
 if position('case r.status' in d)=0 or position('r.status <> ''cancelled''' in d)=0 then raise exception 'Request status patch requires review';end if;
 d:=replace(d,'case r.status when ''accepted'' then ''accepted'' when ''pending'' then ''pending'' else ''declined'' end','r.status::text');
 d:=replace(d,'''id'', r.id,','''id'', r.id, ''legId'', r.leg_id, ''direction'', l.direction,');
 d:=replace(d,'and r.status <> ''cancelled''','');execute d;
end $$;

-- All new public endpoints are authenticated only; all private helpers stay private.
revoke all on function public.save_driver_onboarding_draft(jsonb),public.get_driver_onboarding_draft(),public.clear_driver_onboarding_draft(),
 public.send_club_message(uuid,uuid,text),public.mark_club_read(uuid,uuid),public.list_chat_summaries(),public.set_driver_requests_paused(uuid,boolean) from public,anon;
grant execute on function public.save_driver_onboarding_draft(jsonb),public.get_driver_onboarding_draft(),public.clear_driver_onboarding_draft(),
 public.send_club_message(uuid,uuid,text),public.mark_club_read(uuid,uuid),public.list_chat_summaries(),public.set_driver_requests_paused(uuid,boolean) to authenticated;
revoke all on function lifty_private.club_message_notification(),lifty_private.raw_driver_verification(uuid),lifty_private.verification_changed() from public,anon,authenticated;

-- Reuse the existing generator semantics, scoped to the changed leg. Booking must
-- not reconcile every other club while holding the final-seat row lock.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.generate_commute_instances(date)'::regprocedure);
 if position('where l.active' in d)=0 or position('i.service_date=p_date' in d)=0 then raise exception 'Scoped instance generator requires review';end if;
 d:=replace(d,'FUNCTION public.generate_commute_instances(p_date date)','FUNCTION lifty_private.generate_leg_instances(p_leg uuid, p_date date)');
 d:=replace(d,'where l.active','where l.id=p_leg and l.active');
 d:=replace(d,'i.service_date=p_date','i.leg_id=p_leg and i.service_date=p_date');execute d;
 d:=pg_get_functiondef('public.generate_contributions()'::regprocedure);
 if position('where m.active' in d)=0 or position('where status=''upcoming''' in d)=0 then raise exception 'Scoped contribution generator requires review';end if;
 d:=replace(d,'FUNCTION public.generate_contributions()','FUNCTION lifty_private.generate_leg_contributions(p_leg uuid)');
 d:=replace(d,'where m.active','where m.leg_id=p_leg and m.active');
 d:=replace(d,'where status=''upcoming''','where leg_id=p_leg and status=''upcoming''');execute d;
end $$;
create or replace function lifty_private.reconcile_leg(p_leg uuid) returns void language plpgsql security definer set search_path='' as $$
declare d date;
begin
 for d in select generate_series((now() at time zone 'Africa/Johannesburg')::date,(now() at time zone 'Africa/Johannesburg')::date+7,interval '1 day')::date
 union select service_date from public.commute_instances where leg_id=p_leg and sharing_starts_at>now() loop
  perform lifty_private.generate_leg_instances(p_leg,d);
 end loop;
 update public.commute_instances set status='cancelled' where leg_id=p_leg and status in('scheduled','sharing','underway') and sharing_ends_at<now();
 perform lifty_private.generate_leg_contributions(p_leg);
end $$;

-- Exact overlap of the agreed weekly/date schedules, including their date bounds.
create or replace function lifty_private.agreements_overlap(a jsonb,b jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare d date;start_on date;end_on date;
begin
 if a is null or b is null then return true;end if; -- legacy unknown schedules fail conservatively
 start_on:=greatest((a->>'startDate')::date,(b->>'startDate')::date,(now() at time zone 'Africa/Johannesburg')::date);
 end_on:=least(coalesce(nullif(a->>'endDate','')::date,'infinity'::date),coalesce(nullif(b->>'endDate','')::date,'infinity'::date));
 if start_on>end_on then return false;end if;
 if a->>'scheduleMode'='dates' then
  return exists(select 1 from jsonb_array_elements_text(a->'dates')x where x.value::date>=start_on and x.value::date<=end_on and lifty_private.agreed_on(b,x.value::date) and lifty_private.agreed_on(a,x.value::date));
 elsif b->>'scheduleMode'='dates' then return lifty_private.agreements_overlap(b,a);
 end if;
 for d in select generate_series(start_on,least(start_on+370,end_on),interval '1 day')::date loop
  if lifty_private.agreed_on(a,d) and lifty_private.agreed_on(b,d) then return true;end if;
 end loop;
 return false;
end $$;
create or replace function lifty_private.check_combined_detour(p_request uuid,p_limit int) returns void language plpgsql stable security definer set search_path='' as $$
declare r public.join_requests;total numeric;
begin
 select * into r from public.join_requests where id=p_request;
 select coalesce(r.deviation_min,0)+coalesce(sum(coalesce(q.deviation_min,(m.match_snapshot->>'deviationMinutes')::numeric,0)),0) into total
 from public.club_members m left join public.join_requests q on q.id=m.request_id
 where m.leg_id=r.leg_id and m.active and not m.paused and m.passenger_id<>r.passenger_id and lifty_private.agreements_overlap(r.agreement,m.agreement);
 if total>p_limit then raise exception 'Combined estimated pickup detour exceeds your limit. Review existing pickups before accepting.';end if;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.respond_to_request(uuid,boolean)'::regprocedure);
 if position('perform public.generate_contributions();' in d)=0 or position('perform public.reconcile_commutes();' in d)=0 or position('if not l.active' in d)=0 then raise exception 'Acceptance hardening requires review';end if;
 d:=replace(d,'if not l.active','if l.requests_paused or not l.active');
 d:=replace(d,'if l.seats_open <= 0 then','perform lifty_private.check_combined_detour(r.id,l.max_deviation_min);'||chr(10)||'    if l.seats_open <= 0 then');
 d:=replace(d,'perform public.generate_contributions();','');
 d:=replace(d,'perform public.reconcile_commutes();','perform lifty_private.reconcile_leg(l.id);');execute d;
end $$;

alter table public.notifications add column source_document_id uuid references public.verification_documents(id) on delete cascade;
create unique index notification_document_recipient on public.notifications(source_document_id,user_id,kind) where source_document_id is not null;
create or replace function lifty_private.queue_document_expiry_reminders() returns void language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Africa/Johannesburg')::date;
begin
 with latest as(select distinct on(user_id,kind) * from public.verification_documents order by user_id,kind,created_at desc,submitted_seq desc)
 insert into public.notifications(user_id,kind,title,body,link,source_document_id,is_test)
 select d.user_id,case when d.expires_on<today then 'document_expired' else 'document_expiring' end,
 case when d.expires_on<today then 'Driver document expired' else 'Driver document expires soon' end,
 case when d.expires_on<today then 'Replace your expired document. New lift requests are unavailable until approval is restored.' else 'Upload a current replacement before your document expires.' end,
 '/d/profile',d.id,d.is_test from latest d join public.profiles p on p.id=d.user_id
 where p.suspended_at is null and d.status='verified' and d.expires_on<=today+7
 on conflict(source_document_id,user_id,kind) where source_document_id is not null do nothing;
end $$;
select cron.schedule('lifty-document-expiry','15 3 * * *','select lifty_private.queue_document_expiry_reminders();');
revoke all on function lifty_private.generate_leg_instances(uuid,date),lifty_private.generate_leg_contributions(uuid),lifty_private.reconcile_leg(uuid),
 lifty_private.agreements_overlap(jsonb,jsonb),lifty_private.check_combined_detour(uuid,int),lifty_private.queue_document_expiry_reminders() from public,anon,authenticated;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.export_my_data()'::regprocedure);
 if position('return result||jsonb_build_object(''exportedAt''' in d)=0 then raise exception 'Driver private data export requires review';end if;
 execute replace(d,'return result||jsonb_build_object(''exportedAt''',
 'return result||jsonb_build_object(''driver_onboarding_draft'',(select draft from lifty_private.driver_onboarding_drafts where user_id=auth.uid()),''club_read_cursors'',(select coalesce(jsonb_agg(to_jsonb(c)),''[]''::jsonb) from lifty_private.club_read_cursors c where user_id=auth.uid()))||jsonb_build_object(''exportedAt''');
end $$;
