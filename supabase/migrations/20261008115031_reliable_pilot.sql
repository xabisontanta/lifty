-- Additive pilot upgrade. Existing users, records and project are preserved.
create schema if not exists lifty_private;
revoke all on schema lifty_private from public, anon, authenticated;
alter table public.profiles add column onboarding_completed_at timestamptz, add column suspended_at timestamptz, add column suspension_reason text;
alter table public.passenger_commutes add column skip_holidays boolean not null default false;
alter table public.join_requests add column agreement jsonb, add column match_snapshot jsonb;
alter table public.club_members add column agreement jsonb, add column match_snapshot jsonb;
alter table public.instance_riders add column driver_arrived_at timestamptz, add column no_show_at timestamptz,
 add column pickup_label text, add column pickup extensions.geography(point,4326), add column pickup_time time;
alter table public.contributions add column reported_at timestamptz, add column report_note text, add column confirmed_by uuid references auth.users(id) on delete set null;
alter table public.verification_documents drop constraint verification_documents_reviewed_by_fkey;
alter table public.verification_documents add constraint verification_documents_reviewed_by_fkey foreign key(reviewed_by) references auth.users(id) on delete set null;
alter table public.reports drop constraint reports_handled_by_fkey;
alter table public.reports add constraint reports_handled_by_fkey foreign key(handled_by) references auth.users(id) on delete set null;

create or replace function public.account_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and suspended_at is null);
$$;
create or replace function public.driver_verification(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with latest as (select distinct on(kind) kind,status from public.verification_documents where user_id=p_user
   and kind in ('id','licence','vehicle_registration','insurance') order by kind,created_at desc,id desc)
 select jsonb_build_object('identity',coalesce((select status::text from latest where kind='id'),'pending'),
 'licence',coalesce((select status::text from latest where kind='licence'),'pending'),
 'vehicle',coalesce((select status::text from latest where kind='vehicle_registration'),'pending'),
 'insurance',coalesce((select status::text from latest where kind='insurance'),'pending'));
$$;
create or replace function public.driver_approved(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.vehicles v on v.driver_id=p.id where p.id=p_user
 and p.role='driver' and p.suspended_at is null and v.status='verified')
 and not exists(select 1 from jsonb_each_text(public.driver_verification(p_user)) x where x.value<>'verified');
$$;
create or replace function lifty_private.verification_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 v:=public.driver_verification(new.user_id);
 update public.profiles set identity_status=(v->>'identity')::public.verification_status where id=new.user_id;
 update public.vehicles set status=case when v->>'vehicle'='verified' and v->>'insurance'='verified' then 'verified'::public.verification_status else 'pending'::public.verification_status end where driver_id=new.user_id;
 return new;
end $$;
create trigger verification_latest after insert or update on public.verification_documents for each row execute function lifty_private.verification_changed();
create or replace function lifty_private.vehicle_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.make,new.model,new.year,new.registration_summary,new.colour,new.seats_total,new.body_type) is distinct from row(old.make,old.model,old.year,old.registration_summary,old.colour,old.seats_total,old.body_type) then
  update public.verification_documents set status='pending',reviewed_by=null,reviewed_at=null,review_note='Vehicle details changed; review required' where user_id=new.driver_id and kind in ('vehicle_registration','insurance');
  new.status:='pending';
 end if;
 return new;
end $$;
create trigger vehicle_approval_reset before update on public.vehicles for each row execute function lifty_private.vehicle_changed();
create or replace function public.review_document(p_doc uuid,p_approve boolean,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare d public.verification_documents;
begin
 if not public.is_admin() or not public.account_active() then raise exception 'Admins only'; end if;
 select * into d from public.verification_documents where id=p_doc for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if exists(select 1 from public.verification_documents where user_id=d.user_id and kind=d.kind and (created_at,id)>(d.created_at,d.id)) then raise exception 'This document has been replaced'; end if;
 update public.verification_documents set status=case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note where id=p_doc;
 perform public.notify(d.user_id,'verification','Document reviewed',case when p_approve then 'Your document was approved.' else coalesce(p_note,'Please replace this document.') end,'/d/profile');
end $$;
create or replace function public.bootstrap_account(p_full_name text,p_role public.user_role) returns void language plpgsql security definer set search_path='' as $$
declare first text; last text; phone_number text;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if exists(select 1 from public.profiles where id=auth.uid()) then return; end if;
 if length(trim(p_full_name))<3 or length(p_full_name)>120 then raise exception 'Enter your full name'; end if;
 first:=split_part(trim(p_full_name),' ',1); last:=trim(substr(trim(p_full_name),length(first)+1));
 select phone into phone_number from auth.users where id=auth.uid();
 insert into public.profiles(id,role,first_name,last_initial) values(auth.uid(),p_role,first,upper(left(last,1)));
 insert into public.profile_private(id,last_name,phone,terms_accepted_at) values(auth.uid(),last,phone_number,now());
end $$;
create or replace function public.complete_onboarding() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() then raise exception 'Not authenticated or account suspended'; end if;
 if not exists(select 1 from public.profile_private where id=auth.uid() and terms_accepted_at is not null) then raise exception 'Accept the terms first'; end if;
 if exists(select 1 from public.profiles where id=auth.uid() and role='driver') then
  if not exists(select 1 from public.vehicles where driver_id=auth.uid()) or not exists(select 1 from public.driver_legs where driver_id=auth.uid()) then raise exception 'Add your vehicle and commute first'; end if;
 else
  if not exists(select 1 from public.passenger_commutes where passenger_id=auth.uid()) then raise exception 'Save your commute first'; end if;
 end if;
 update public.profiles set onboarding_completed_at=coalesce(onboarding_completed_at,now()) where id=auth.uid();
end $$;
-- Existing accounts regain their completed setup, without relying on device flags.
update public.profiles p set onboarding_completed_at=now() where exists(select 1 from public.profile_private q where q.id=p.id and q.terms_accepted_at is not null)
 and ((p.role='driver' and exists(select 1 from public.driver_legs l where l.driver_id=p.id) and exists(select 1 from public.vehicles v where v.driver_id=p.id)) or (p.role='passenger' and exists(select 1 from public.passenger_commutes c where c.passenger_id=p.id)));
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
 'documents',coalesce((select jsonb_agg(to_jsonb(d)) from (select distinct on(kind) kind,status from public.verification_documents where user_id=p.id order by kind,created_at desc,id desc)d),'[]'),
 'exceptions',coalesce((select jsonb_agg(to_jsonb(e)) from public.schedule_exceptions e where e.user_id=p.id),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from public.join_requests r where r.passenger_id=p.id and r.status in ('pending','accepted')),'[]')) from public.profiles p where p.id=auth.uid());
end $$;

-- All writes, including privileged functions, share the same seat/cost checks.
create or replace function lifty_private.validate_leg() returns trigger language plpgsql security definer set search_path='' as $$
declare capacity int; members int;
begin
 select seats_total into capacity from public.vehicles where driver_id=new.driver_id;
 select count(*) into members from public.club_members where leg_id=new.id and active;
 if capacity is null or new.seats_open+members>capacity or new.seats_open<0 then raise exception 'Seat limit exceeds your vehicle or existing members'; end if;
 if tg_op='UPDATE' and members>0 and (new.departure_time<>old.departure_time or not(new.days @> old.days) or new.route::text<>old.route::text or new.destination::text<>old.destination::text) then raise exception 'Existing agreements must be ended before changing the departure, route or covered days'; end if;
 if new.route_distance_m<=0 or new.route_duration_s<=0 or cardinality(new.days)=0 then raise exception 'A valid route and weekdays are required'; end if;
 if new.monthly_contribution>public.contribution_cap(new.route_distance_m,cardinality(new.days),capacity) then raise exception 'Contribution exceeds the cost-sharing limit'; end if;
 if auth.uid() is not null and not public.account_active() then raise exception 'Account suspended'; end if;
 return new;
end $$;
create trigger validate_driver_leg before insert or update on public.driver_legs for each row execute function lifty_private.validate_leg();
revoke update(seats_open,max_deviation_min,monthly_contribution,active,departure_time,days) on public.driver_legs from authenticated;
revoke update(paused) on public.club_members from authenticated;
create or replace function public.save_driver_settings(p_leg uuid,p_seats int,p_deviation int,p_contribution int,p_departure time default null,p_days smallint[] default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs; used int;
begin
 select * into l from public.driver_legs where id=p_leg for update;
 if l.driver_id is distinct from auth.uid() or not public.account_active() then raise exception 'Not your commute'; end if;
 select count(*) into used from public.club_members where leg_id=p_leg and active;
 if p_seats<used then raise exception 'Seats cannot be less than existing members'; end if;
 update public.driver_legs set seats_open=p_seats-used,max_deviation_min=p_deviation,monthly_contribution=p_contribution,departure_time=coalesce(p_departure,departure_time),days=coalesce(p_days,days) where id=p_leg;
 perform public.reconcile_commutes();
end $$;

create table public.pickup_changes(id uuid primary key default gen_random_uuid(),leg_id uuid not null references public.driver_legs on delete cascade,
 passenger_id uuid not null references public.profiles on delete cascade,service_date date not null,pickup_label text not null,pickup extensions.geography(point,4326) not null,
 status text not null default 'pending' check(status in ('pending','approved','declined')),created_at timestamptz not null default now(),reviewed_at timestamptz);
create unique index pickup_change_pending on public.pickup_changes(leg_id,passenger_id,service_date) where status='pending';
alter table public.pickup_changes enable row level security;
grant select on public.pickup_changes to authenticated;
revoke all on public.pickup_changes from anon;
create policy pickup_changes_read on public.pickup_changes for select to authenticated using(passenger_id=(select auth.uid()) or public.is_leg_driver(leg_id));
create or replace function public.request_pickup_change(p_leg uuid,p_date date,p_label text,p_lng float8,p_lat float8) returns void language plpgsql security definer set search_path='' as $$
declare driver uuid;
begin
 if not public.account_active() or not exists(select 1 from public.club_members where leg_id=p_leg and passenger_id=auth.uid() and active) then raise exception 'Not your club'; end if;
 if p_date<(now() at time zone 'Africa/Johannesburg')::date or abs(p_lat)>90 or abs(p_lng)>180 or length(trim(p_label)) not between 1 and 200 then raise exception 'Invalid pickup date or coordinates'; end if;
 if exists(select 1 from public.commute_instances where leg_id=p_leg and service_date=p_date and sharing_starts_at<=now()) then raise exception 'Pickup changes must be approved before sharing begins'; end if;
 insert into public.pickup_changes(leg_id,passenger_id,service_date,pickup_label,pickup) values(p_leg,auth.uid(),p_date,p_label,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography);
 select driver_id into driver from public.driver_legs where id=p_leg;
 perform public.notify(driver,'pickup_change','Pickup change requested','Review the proposed pickup before it replaces the agreed point.','/d/exceptions');
end $$;
create or replace function public.review_pickup_change(p_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.pickup_changes;
begin
 select * into c from public.pickup_changes where id=p_id for update;
 if not public.is_leg_driver(c.leg_id) or not public.account_active() then raise exception 'Only the driver can approve'; end if;
 if c.status<>'pending' or c.service_date<(now() at time zone 'Africa/Johannesburg')::date or exists(select 1 from public.commute_instances where leg_id=c.leg_id and service_date=c.service_date and sharing_starts_at<=now()) then raise exception 'Pickup request is no longer open'; end if;
 update public.pickup_changes set status=case when p_approve then 'approved' else 'declined' end,reviewed_at=now() where id=p_id;
 perform public.reconcile_commutes();
 perform public.notify(c.passenger_id,'pickup_change','Pickup change reviewed',case when p_approve then 'Your temporary pickup was approved.' else 'Continue using your agreed pickup.' end,'/p/commute');
end $$;





-- ASSEMBLED FRAGMENTS
create table lifty_private.holidays(service_date date primary key,name text not null);
insert into lifty_private.holidays values ('2025-01-01','New Year’s Day'),
('2025-03-21','Human Rights Day'),
('2025-04-27','Freedom Day'),
('2025-04-28','Freedom Day (observed)'),
('2025-05-01','Workers’ Day'),
('2025-06-16','Youth Day'),
('2025-08-09','National Women’s Day'),
('2025-09-24','Heritage Day'),
('2025-12-16','Day of Reconciliation'),
('2025-12-25','Christmas Day'),
('2025-12-26','Day of Goodwill'),
('2025-04-18','Good Friday'),
('2025-04-21','Family Day'),
('2026-01-01','New Year’s Day'),
('2026-03-21','Human Rights Day'),
('2026-04-27','Freedom Day'),
('2026-05-01','Workers’ Day'),
('2026-06-16','Youth Day'),
('2026-08-09','National Women’s Day'),
('2026-08-10','National Women’s Day (observed)'),
('2026-09-24','Heritage Day'),
('2026-12-16','Day of Reconciliation'),
('2026-12-25','Christmas Day'),
('2026-12-26','Day of Goodwill'),
('2026-04-03','Good Friday'),
('2026-04-06','Family Day'),
('2027-01-01','New Year’s Day'),
('2027-03-21','Human Rights Day'),
('2027-03-22','Human Rights Day (observed)'),
('2027-04-27','Freedom Day'),
('2027-05-01','Workers’ Day'),
('2027-06-16','Youth Day'),
('2027-08-09','National Women’s Day'),
('2027-09-24','Heritage Day'),
('2027-12-16','Day of Reconciliation'),
('2027-12-25','Christmas Day'),
('2027-12-26','Day of Goodwill'),
('2027-12-27','Day of Goodwill (observed)'),
('2027-03-26','Good Friday'),
('2027-03-29','Family Day'),
('2028-01-01','New Year’s Day'),
('2028-03-21','Human Rights Day'),
('2028-04-27','Freedom Day'),
('2028-05-01','Workers’ Day'),
('2028-06-16','Youth Day'),
('2028-08-09','National Women’s Day'),
('2028-09-24','Heritage Day'),
('2028-09-25','Heritage Day (observed)'),
('2028-12-16','Day of Reconciliation'),
('2028-12-25','Christmas Day'),
('2028-12-26','Day of Goodwill'),
('2028-04-14','Good Friday'),
('2028-04-17','Family Day'),
('2029-01-01','New Year’s Day'),
('2029-03-21','Human Rights Day'),
('2029-04-27','Freedom Day'),
('2029-05-01','Workers’ Day'),
('2029-06-16','Youth Day'),
('2029-08-09','National Women’s Day'),
('2029-09-24','Heritage Day'),
('2029-12-16','Day of Reconciliation'),
('2029-12-17','Day of Reconciliation (observed)'),
('2029-12-25','Christmas Day'),
('2029-12-26','Day of Goodwill'),
('2029-03-30','Good Friday'),
('2029-04-02','Family Day'),
('2030-01-01','New Year’s Day'),
('2030-03-21','Human Rights Day'),
('2030-04-27','Freedom Day'),
('2030-05-01','Workers’ Day'),
('2030-06-16','Youth Day'),
('2030-06-17','Youth Day (observed)'),
('2030-08-09','National Women’s Day'),
('2030-09-24','Heritage Day'),
('2030-12-16','Day of Reconciliation'),
('2030-12-25','Christmas Day'),
('2030-12-26','Day of Goodwill'),
('2030-04-19','Good Friday'),
('2030-04-22','Family Day'),
('2031-01-01','New Year’s Day'),
('2031-03-21','Human Rights Day'),
('2031-04-27','Freedom Day'),
('2031-04-28','Freedom Day (observed)'),
('2031-05-01','Workers’ Day'),
('2031-06-16','Youth Day'),
('2031-08-09','National Women’s Day'),
('2031-09-24','Heritage Day'),
('2031-12-16','Day of Reconciliation'),
('2031-12-25','Christmas Day'),
('2031-12-26','Day of Goodwill'),
('2031-04-11','Good Friday'),
('2031-04-14','Family Day'),
('2032-01-01','New Year’s Day'),
('2032-03-21','Human Rights Day'),
('2032-03-22','Human Rights Day (observed)'),
('2032-04-27','Freedom Day'),
('2032-05-01','Workers’ Day'),
('2032-06-16','Youth Day'),
('2032-08-09','National Women’s Day'),
('2032-09-24','Heritage Day'),
('2032-12-16','Day of Reconciliation'),
('2032-12-25','Christmas Day'),
('2032-12-26','Day of Goodwill'),
('2032-12-27','Day of Goodwill (observed)'),
('2032-03-26','Good Friday'),
('2032-03-29','Family Day'),
('2033-01-01','New Year’s Day'),
('2033-03-21','Human Rights Day'),
('2033-04-27','Freedom Day'),
('2033-05-01','Workers’ Day'),
('2033-05-02','Workers’ Day (observed)'),
('2033-06-16','Youth Day'),
('2033-08-09','National Women’s Day'),
('2033-09-24','Heritage Day'),
('2033-12-16','Day of Reconciliation'),
('2033-12-25','Christmas Day'),
('2033-12-26','Day of Goodwill'),
('2033-04-15','Good Friday'),
('2033-04-18','Family Day'),
('2034-01-01','New Year’s Day'),
('2034-01-02','New Year’s Day (observed)'),
('2034-03-21','Human Rights Day'),
('2034-04-27','Freedom Day'),
('2034-05-01','Workers’ Day'),
('2034-06-16','Youth Day'),
('2034-08-09','National Women’s Day'),
('2034-09-24','Heritage Day'),
('2034-09-25','Heritage Day (observed)'),
('2034-12-16','Day of Reconciliation'),
('2034-12-25','Christmas Day'),
('2034-12-26','Day of Goodwill'),
('2034-04-07','Good Friday'),
('2034-04-10','Family Day'),
('2035-01-01','New Year’s Day'),
('2035-03-21','Human Rights Day'),
('2035-04-27','Freedom Day'),
('2035-05-01','Workers’ Day'),
('2035-06-16','Youth Day'),
('2035-08-09','National Women’s Day'),
('2035-09-24','Heritage Day'),
('2035-12-16','Day of Reconciliation'),
('2035-12-17','Day of Reconciliation (observed)'),
('2035-12-25','Christmas Day'),
('2035-12-26','Day of Goodwill'),
('2035-03-23','Good Friday'),
('2035-03-26','Family Day'),
('2036-01-01','New Year’s Day'),
('2036-03-21','Human Rights Day'),
('2036-04-27','Freedom Day'),
('2036-04-28','Freedom Day (observed)'),
('2036-05-01','Workers’ Day'),
('2036-06-16','Youth Day'),
('2036-08-09','National Women’s Day'),
('2036-09-24','Heritage Day'),
('2036-12-16','Day of Reconciliation'),
('2036-12-25','Christmas Day'),
('2036-12-26','Day of Goodwill'),
('2036-04-11','Good Friday'),
('2036-04-14','Family Day');
create or replace function public.commute_booked_on(c public.passenger_commutes,p_date date) returns boolean language sql stable security definer set search_path='' as $$
 select p_date>=c.start_date and (c.end_date is null or p_date<=c.end_date)
 and case when c.specific_dates is not null then p_date=any(c.specific_dates) else (extract(isodow from p_date)::int-1)=any(c.days) end
 and not(c.skip_holidays and exists(select 1 from lifty_private.holidays where service_date=p_date));
$$;
create or replace function lifty_private.agreed_on(a jsonb,p_date date) returns boolean language sql stable security definer set search_path='' as $$
 select a is not null and p_date>=(a->>'startDate')::date and (nullif(a->>'endDate','') is null or p_date<=(a->>'endDate')::date)
 and case when a->>'scheduleMode'='dates' then coalesce(a->'dates','[]') @> to_jsonb(array[p_date::text])
 else coalesce(a->'days','[]') @> to_jsonb(array[extract(isodow from p_date)::int-1]) end
 and not(coalesce((a->>'skipHolidays')::boolean,false) and exists(select 1 from lifty_private.holidays where service_date=p_date));
$$;
-- Backfill legacy memberships from the saved request once; later searches cannot change them.
update public.join_requests r set agreement=jsonb_build_object('scheduleMode',case when c.specific_dates is null then 'weekly' else 'dates' end,
 'days',to_jsonb(array(select unnest(c.days) intersect select unnest(l.days))),
 'dates',to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[]))d where (extract(isodow from d)::int-1)=any(l.days))),
 'startDate',r.start_date,'endDate',c.end_date,'skipHolidays',c.skip_holidays,'monthlyContribution',r.monthly_contribution,
 'perDayContribution',public.per_day_contribution(l.monthly_contribution,cardinality(l.days)))
 from public.passenger_commutes c,public.driver_legs l where c.id=r.commute_id and l.id=r.leg_id and r.agreement is null;
update public.club_members m set agreement=r.agreement,match_snapshot=r.match_snapshot from public.join_requests r where r.id=m.request_id and m.agreement is null;
update public.club_members m set agreement=jsonb_build_object('scheduleMode','weekly','days',to_jsonb(l.days),'dates','[]'::jsonb,'startDate',m.start_date,'skipHolidays',false,'monthlyContribution',m.monthly_contribution)
 from public.driver_legs l where l.id=m.leg_id and m.agreement is null;

create or replace function public.generate_commute_instances(p_date date) returns int language plpgsql security definer set search_path='' as $$
declare n int;
begin
 insert into public.commute_instances(leg_id,service_date,departs_at,sharing_starts_at,sharing_ends_at)
 select l.id,p_date,(p_date+l.departure_time) at time zone 'Africa/Johannesburg',
 ((p_date+l.departure_time) at time zone 'Africa/Johannesburg')-interval '20 minutes',
 ((p_date+l.departure_time) at time zone 'Africa/Johannesburg')+make_interval(secs=>l.route_duration_s)+interval '60 minutes'
 from public.driver_legs l join public.profiles p on p.id=l.driver_id
 where l.active and p.suspended_at is null and (extract(isodow from p_date)::int-1)=any(l.days)
 and exists(select 1 from public.club_members m join public.profiles q on q.id=m.passenger_id where m.leg_id=l.id and m.active and not m.paused and q.suspended_at is null and lifty_private.agreed_on(m.agreement,p_date))
 and not exists(select 1 from public.schedule_exceptions e where e.user_id=l.driver_id and (e.leg_id is null or e.leg_id=l.id) and e.kind<>'pickup-change' and (e.date=p_date or (e.kind='pause' and e.date is null)))
 on conflict(leg_id,service_date) do update set departs_at=excluded.departs_at,sharing_starts_at=excluded.sharing_starts_at,sharing_ends_at=excluded.sharing_ends_at,
 status=case when public.commute_instances.status='cancelled' then 'scheduled'::public.instance_status else public.commute_instances.status end
 where public.commute_instances.sharing_starts_at>now() and public.commute_instances.status in ('scheduled','cancelled');
 get diagnostics n=row_count;
 update public.instance_riders r set status='absent' from public.commute_instances i where r.instance_id=i.id and i.service_date=p_date and i.status in('scheduled','sharing','underway') and r.status in('expected','at_pickup')
 and (not exists(select 1 from public.club_members m where m.leg_id=i.leg_id and m.passenger_id=r.passenger_id and m.active and not m.paused)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=r.passenger_id and (e.leg_id is null or e.leg_id=i.leg_id) and e.kind<>'pickup-change' and (e.date=p_date or(e.kind='pause' and e.date is null))));
 -- Reconcile only future, unstarted trips. Preserve actual pickup history.
 update public.commute_instances i set status='cancelled' from public.driver_legs l where i.leg_id=l.id and i.service_date=p_date and i.sharing_starts_at>now() and i.status='scheduled'
 and (not l.active or not (extract(isodow from p_date)::int-1)=any(l.days)
 or exists(select 1 from public.profiles p where p.id=l.driver_id and p.suspended_at is not null)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=l.driver_id and (e.leg_id is null or e.leg_id=l.id) and e.kind<>'pickup-change' and (e.date=p_date or (e.kind='pause' and e.date is null))));
 insert into public.instance_riders(instance_id,passenger_id,status,pickup_label,pickup,pickup_time)
 select i.id,m.passenger_id,case when m.paused or not m.active or p.suspended_at is not null or not lifty_private.agreed_on(m.agreement,p_date)
 or exists(select 1 from public.schedule_exceptions e where e.user_id=m.passenger_id and (e.leg_id is null or e.leg_id=i.leg_id) and e.kind<>'pickup-change' and (e.date=p_date or(e.kind='pause' and e.date is null))) then 'absent'::public.rider_status else 'expected'::public.rider_status end,
 coalesce(c.pickup_label,m.pickup_label),coalesce(c.pickup,m.pickup),m.pickup_time
 from public.commute_instances i join public.club_members m on m.leg_id=i.leg_id join public.profiles p on p.id=m.passenger_id
 left join lateral(select x.* from public.pickup_changes x where x.leg_id=m.leg_id and x.passenger_id=m.passenger_id and x.service_date=p_date and x.status='approved' order by reviewed_at desc limit 1)c on true
 where i.service_date=p_date and i.status='scheduled' and (i.sharing_starts_at>now() or not exists(select 1 from public.instance_riders r where r.instance_id=i.id))
 on conflict(instance_id,passenger_id) do update set status=excluded.status,pickup_label=excluded.pickup_label,pickup=excluded.pickup,pickup_time=excluded.pickup_time
 where public.instance_riders.status in ('expected','absent') and exists(select 1 from public.commute_instances z where z.id=excluded.instance_id and z.sharing_starts_at>now());
 return n;
end $$;
create or replace function public.generate_contributions() returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.contributions(leg_id,passenger_id,period,amount,status)
 select m.leg_id,m.passenger_id,b.period,
 case when m.agreement->>'scheduleMode'='dates' then coalesce((m.agreement->>'perDayContribution')::int,0)*(select count(*) from jsonb_array_elements_text(m.agreement->'dates')d where d.value::date>=b.period and d.value::date<b.period+interval '1 month' and lifty_private.agreed_on(m.agreement,d.value::date))
 else m.monthly_contribution end,
 case when b.period<=(now() at time zone 'Africa/Johannesburg')::date then 'due'::public.contribution_status else 'upcoming'::public.contribution_status end
 from public.club_members m cross join lateral(select generate_series(greatest(date_trunc('month',m.start_date)::date,date_trunc('month',now() at time zone 'Africa/Johannesburg')::date),date_trunc('month',now() at time zone 'Africa/Johannesburg')+interval '1 month',interval '1 month')::date period)b
 where m.active and (nullif(m.agreement->>'endDate','') is null or b.period<=(m.agreement->>'endDate')::date)
 and (m.agreement->>'scheduleMode'<>'dates' or exists(select 1 from jsonb_array_elements_text(m.agreement->'dates')d where date_trunc('month',d.value::date)::date=b.period))
 on conflict(leg_id,passenger_id,period) do update set amount=excluded.amount where public.contributions.reported_at is null and public.contributions.status<>'paid';
 update public.contributions set status='due' where status='upcoming' and period<=(now() at time zone 'Africa/Johannesburg')::date;
end $$;
create or replace function public.reconcile_commutes() returns void language plpgsql security definer set search_path='' as $$
declare d date;
begin
 for d in select generate_series((now() at time zone 'Africa/Johannesburg')::date,(now() at time zone 'Africa/Johannesburg')::date+7,interval '1 day')::date union select service_date from public.commute_instances where sharing_starts_at>now() loop
  perform public.generate_commute_instances(d);
 end loop;
 update public.commute_instances set status='cancelled' where status in('scheduled','sharing','underway') and sharing_ends_at<now();
 perform public.generate_contributions();
end $$;
create or replace function lifty_private.exception_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.schedule_exceptions; other uuid;
begin
 e:=case when tg_op='DELETE' then old else new end;
 if e.kind='pause' then update public.club_members set paused=(tg_op<>'DELETE') where passenger_id=e.user_id and (e.leg_id is null or leg_id=e.leg_id);end if;
 if tg_op='INSERT' and e.kind='pickup-change' then raise exception 'Use an approved pickup change with coordinates'; end if;
 perform public.reconcile_commutes();
 for other in select distinct m.passenger_id from public.club_members m join public.driver_legs l on l.id=m.leg_id where m.active and (m.passenger_id=e.user_id or l.driver_id=e.user_id) and (e.leg_id is null or m.leg_id=e.leg_id)
 union select distinct l.driver_id from public.driver_legs l join public.club_members m on m.leg_id=l.id where m.active and m.passenger_id=e.user_id and (e.leg_id is null or l.id=e.leg_id) loop
  if other<>e.user_id then perform public.notify(other,'schedule','Schedule updated',case when tg_op='DELETE' then 'A schedule exception was undone.' else 'A member updated their availability.' end,case when exists(select 1 from public.profiles where id=other and role='driver') then '/d/exceptions' else '/p/commute' end); end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger exceptions_reconcile after insert or delete on public.schedule_exceptions for each row execute function lifty_private.exception_changed();
create or replace function public.set_club_pause(p_leg uuid,p_paused boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() or not exists(select 1 from public.club_members where leg_id=p_leg and passenger_id=auth.uid() and active) then raise exception 'Not your arrangement'; end if;
 update public.club_members set paused=p_paused where leg_id=p_leg and passenger_id=auth.uid();
 if p_paused then
  if not exists(select 1 from public.schedule_exceptions where user_id=auth.uid() and leg_id=p_leg and kind='pause' and date is null) then insert into public.schedule_exceptions(user_id,leg_id,kind) values(auth.uid(),p_leg,'pause'); end if;
 else delete from public.schedule_exceptions where user_id=auth.uid() and leg_id=p_leg and kind='pause' and date is null; end if;
 perform public.reconcile_commutes();
end $$;
create or replace function public.report_contribution(p_id uuid,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() then raise exception 'Account unavailable'; end if;
 update public.contributions set reported_at=now(),report_note=left(p_note,200) where id=p_id and passenger_id=auth.uid() and status<>'paid';
 if not found then raise exception 'Contribution is unavailable'; end if;
 perform public.notify(l.driver_id,'contribution','Payment reported','Confirm receipt in your contribution ledger.','/d/contributions') from public.contributions c join public.driver_legs l on l.id=c.leg_id where c.id=p_id;
end $$;
create or replace function public.confirm_contribution(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() then raise exception 'Account unavailable'; end if;
 update public.contributions c set status='paid',paid_at=now(),confirmed_by=auth.uid() where id=p_id and public.is_leg_driver(c.leg_id) and c.reported_at is not null and c.status<>'paid';
 if not found then raise exception 'Only the driver can confirm a reported payment'; end if;
 perform public.notify(c.passenger_id,'contribution','Receipt confirmed','Your driver confirmed receipt of your contribution.','/p/payments') from public.contributions c where id=p_id;
end $$;
create or replace function public.mark_contribution_paid(p_leg uuid,p_passenger uuid,p_period date) returns void language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 select id into v from public.contributions where leg_id=p_leg and passenger_id=p_passenger and period=date_trunc('month',p_period)::date;
 perform public.confirm_contribution(v);
end $$;
create or replace function lifty_private.validate_rating() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.instance_id is null or new.rater_id= new.ratee_id or not exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.instance_riders r on r.instance_id=i.id
 where i.id=new.instance_id and i.leg_id=new.leg_id and i.status='completed' and r.status='dropped_off'
 and ((l.driver_id=new.ratee_id and r.passenger_id=new.rater_id) or (l.driver_id=new.rater_id and r.passenger_id=new.ratee_id))) then raise exception 'Rate only an actual participant in a completed commute'; end if;
 return new;
end $$;
create trigger rating_completed_trip before insert on public.ratings for each row execute function lifty_private.validate_rating();

CREATE OR REPLACE FUNCTION public.find_matches(p_commute uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c passenger_commutes;
  v_dated boolean;
begin
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  if not found then
    raise exception 'Commute not found';
  end if;
  v_dated := c.specific_dates is not null and cardinality(c.specific_dates) > 0;

  return query
  select x.m from (
  with legs as (
    select l.*, l.route::geometry as g
    from driver_legs l
    where public.account_active() and public.driver_approved(l.driver_id) and l.active and l.direction = c.direction and l.seats_open > 0 and l.driver_id <> c.passenger_id
      and l.days && c.days
      and st_dwithin(l.route, c.destination, 1500)
      and st_dwithin(l.route, c.origin, c.max_walk_m + 1200)
      and not exists (select 1 from club_members m where m.leg_id = l.id and m.passenger_id = c.passenger_id and m.active)
      and (not v_dated or exists (select 1 from unnest(c.specific_dates) d where d >= current_date and (extract(isodow from d)::int - 1) = any (l.days)))
  ),
  candidates as (
    select l.id as leg_id, pp.name as label, pp.location as pt
    from legs l
    join pickup_points pp on st_dwithin(pp.location, c.origin, c.max_walk_m) and st_dwithin(pp.location, l.route, 800)
    union all
    select l.id, 'On ' || split_part(l.destination_label, ',', 1) || ' route', st_closestpoint(l.g, c.origin::geometry)::geography
    from legs l where c.max_walk_m > 0 and st_dwithin(l.route, c.origin, c.max_walk_m)
    union all
    select l.id, 'Your street', c.origin from legs l where c.max_walk_m = 0
  ),
  scored as (
    select k.leg_id, k.label, k.pt,
           round(st_distance(k.pt, c.origin) * 1.25)::int as walk_m,
           st_distance(k.pt, l.route) as off_m,
           st_linelocatepoint(l.g, k.pt::geometry) as fa,
           st_linelocatepoint(l.g, st_closestpoint(l.g, c.destination::geometry)) as fb
    from candidates k join legs l on l.id = k.leg_id
  ),
  best as (
    select distinct on (s.leg_id) s.* from scored s
    where s.fb > s.fa
    order by s.leg_id, s.walk_m + 3 * s.off_m
  ),
  metrics as (
    select b.*, l.driver_id, l.g, l.departure_time, l.route_duration_s, l.route_distance_m, l.days as leg_days,
           l.seats_open, l.max_deviation_min, l.monthly_contribution, l.destination_label as leg_destination,
           ceil(b.walk_m / 70.0)::int as walk_min,
           (ceil((2 * b.off_m * 1.3) / 500.0) + case when b.off_m > 30 then 1 else 0 end)::int as dev_min,
           least(100, round(100 * (b.fb - b.fa) * l.route_distance_m / nullif(st_distance(c.origin, c.destination) * 1.3, 0)))::int as overlap,
           cardinality(array(select unnest(l.days) intersect select unnest(c.days))) as shared_days,
           (select count(*) from unnest(coalesce(c.specific_dates, '{}'::date[])) d
             where d >= current_date and (extract(isodow from d)::int - 1) = any (l.days)
               and date_trunc('month', d) = date_trunc('month', (select min(x) from unnest(c.specific_dates) x where x >= current_date)))::int as booked_days
    from best b join legs l on l.id = b.leg_id
  ),
  timed as (
    select m.*,
           m.departure_time + make_interval(secs => m.fa * m.route_duration_s + m.dev_min * 30) as pickup_time,
           m.departure_time + make_interval(secs => m.fb * m.route_duration_s + m.dev_min * 60) as arrival_time,
           per_day_contribution(m.monthly_contribution, cardinality(m.leg_days)) as per_day
    from metrics m
    where m.dev_min <= m.max_deviation_min
  ),
  ok as (
    select t.* from timed t
    where (c.direction = 'to_work'
             and t.arrival_time <= c.arrive_by
             and t.arrival_time >= c.arrive_by - make_interval(mins => c.window_min + 45))
       or (c.direction = 'to_home'
             and t.pickup_time >= c.arrive_by
             and t.pickup_time <= c.arrive_by + make_interval(mins => 45))
  )
  select jsonb_build_object(
    'id', o.leg_id,
    'legId', o.leg_id,
    'commuteId', c.id,
    'direction', c.direction,
    'driver', jsonb_build_object(
      'id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
      'rating', p.rating, 'ratingCount', p.rating_count, 'reliability', p.reliability,
      'completedArrangements', p.completed_arrangements, 'memberSince', p.created_at::date, 'about', p.about,
      'identityStatus', coalesce(p.identity_status::text, 'pending'), 'verification', public.driver_verification(p.id)),
    'vehicle', jsonb_build_object(
      'make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
      'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path,
      'status', v.status),
    'origin', jsonb_build_object('label', c.origin_label, 'lng', st_x(c.origin::geometry), 'lat', st_y(c.origin::geometry)),
    'pickup', jsonb_build_object('label', o.label, 'lng', st_x(o.pt::geometry), 'lat', st_y(o.pt::geometry)),
    'destination', jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
    'geometry', jsonb_build_object(
      'path', st_asgeojson(st_linesubstring(o.g, greatest(0, o.fa - 2500.0 / o.route_distance_m), o.fb), 6)::jsonb,
      'deviation', st_asgeojson(st_makeline(array[
          st_lineinterpolatepoint(o.g, greatest(0, o.fa - 300.0 / o.route_distance_m)),
          o.pt::geometry,
          st_lineinterpolatepoint(o.g, least(1, o.fa + 300.0 / o.route_distance_m))]), 6)::jsonb,
      'walking', st_asgeojson(st_makeline(c.origin::geometry, o.pt::geometry), 6)::jsonb),
    'routeOverlap', o.overlap,
    'walkingDistanceM', o.walk_m,
    'walkingMinutes', o.walk_min,
    'driverDeviationMinutes', o.dev_min,
    'additionalDistanceKm', round((2 * o.off_m * 1.3 / 1000)::numeric, 1),
    'departureTime', to_char(o.departure_time, 'HH24:MI'),
    'pickupEta', to_char(o.pickup_time, 'HH24:MI'),
    'arrivalEta', to_char(o.arrival_time, 'HH24:MI'),
    'days', to_jsonb(array(select unnest(o.leg_days) intersect select unnest(c.days))),
    'coveredDays', to_jsonb(array(select unnest(o.leg_days) intersect select unnest(c.days))),
    'uncoveredDays', to_jsonb(array(select unnest(c.days) except select unnest(o.leg_days))),
    'coveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
    'uncoveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates,'{}'::date[])) d where not (extract(isodow from d)::int-1)=any(o.leg_days) and public.commute_booked_on(c,d))),
    'availableSeats', o.seats_open,
    'pricing', case when v_dated then 'per_day' else 'monthly' end,
    'perDayContribution', o.per_day,
    'bookedDays', o.booked_days,
    'monthlyContribution', case when v_dated then o.per_day * o.booked_days else o.monthly_contribution end,
    'currentCommuteMinutes', round(o.route_duration_s / 60.0),
    'members', coalesce((select jsonb_agg(jsonb_build_object('firstName', mp.first_name, 'avatarPath', mp.avatar_path))
                         from club_members cm join profiles mp on mp.id = cm.passenger_id
                         where cm.leg_id = o.leg_id and cm.active), '[]'::jsonb),
    'compatibility', round(o.overlap * 0.45
                          + greatest(0, 100 - o.walk_m::numeric / greatest(c.max_walk_m, 250) * 60) * 0.2
                          + greatest(0, 100 - o.dev_min * 9) * 0.2
                          + (o.shared_days::numeric / greatest(cardinality(c.days), 1)) * 100 * 0.15)
  ) as m
  from ok o
  join profiles p on p.id = o.driver_id
  join vehicles v on v.driver_id = o.driver_id
  ) x
  order by (x.m ->> 'compatibility')::numeric desc
  limit 20;
end $function$;

CREATE OR REPLACE FUNCTION public.request_to_join(p_commute uuid, p_leg uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  m jsonb;
  c passenger_commutes;
  v_id uuid;
  v_driver uuid;
  v_start date;
begin
  if not public.account_active() or not public.driver_approved((select driver_id from public.driver_legs where id=p_leg)) then raise exception 'An approved driver is required'; end if;
  select * into c from passenger_commutes where id = p_commute and passenger_id = auth.uid();
  m := get_match(p_commute, p_leg);
  if m is null or c.id is null then
    raise exception 'This lift club is no longer a match for your commute';
  end if;
  v_start := greatest(current_date + 1,
                      case when c.specific_dates is not null and cardinality(c.specific_dates) > 0
                           then (select min(d) from unnest(c.specific_dates) d where d > current_date)
                           else c.start_date end);
  insert into join_requests (passenger_id, leg_id, commute_id, pickup_label, pickup, walking_m, walking_min,
                             deviation_min, route_overlap, pickup_time, monthly_contribution, start_date)
  values (auth.uid(), p_leg, p_commute, m -> 'pickup' ->> 'label',
          st_setsrid(st_makepoint((m -> 'pickup' ->> 'lng')::float8, (m -> 'pickup' ->> 'lat')::float8), 4326)::geography,
          (m ->> 'walkingDistanceM')::int, (m ->> 'walkingMinutes')::int, (m ->> 'driverDeviationMinutes')::int,
          (m ->> 'routeOverlap')::int, (m ->> 'pickupEta')::time, (m ->> 'monthlyContribution')::int, coalesce(v_start, current_date + 1))
  returning id into v_id;
  update public.join_requests set match_snapshot=m,agreement=jsonb_build_object(
      'scheduleMode',case when c.specific_dates is null then 'weekly' else 'dates' end,
      'days',m->'coveredDays','dates',coalesce(m->'coveredDates','[]'::jsonb),
      'startDate',coalesce(v_start,(now() at time zone 'Africa/Johannesburg')::date+1),'endDate',c.end_date,
      'skipHolidays',c.skip_holidays,'monthlyContribution',(m->>'monthlyContribution')::int,
      'perDayContribution',(m->>'perDayContribution')::int) where id=v_id;
  select driver_id into v_driver from driver_legs where id = p_leg;
  perform notify(v_driver, 'request', 'New lift club request',
                 (select first_name from profiles where id = auth.uid()) || ' would like to join your commute.', '/d/request/' || v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.respond_to_request(p_request uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r join_requests;
  l driver_legs;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request is no longer open';
  end if;
  select * into l from driver_legs where id = r.leg_id for update;
  if l.driver_id is distinct from auth.uid() or not public.account_active() then
    raise exception 'Not your lift club';
  end if;

  if p_accept then
    if not public.driver_approved(l.driver_id) then raise exception 'All four current documents must be approved'; end if;
    if not exists(select 1 from public.profiles where id=r.passenger_id and suspended_at is null) then raise exception 'Passenger is suspended'; end if;
    if exists(select 1 from public.club_members where leg_id=l.id and passenger_id=r.passenger_id and active) then raise exception 'Passenger already belongs to this club'; end if;
    if l.seats_open <= 0 then
      raise exception 'You have no open seats';
    end if;
    insert into club_members (leg_id, passenger_id, request_id, pickup_label, pickup, pickup_time, monthly_contribution, start_date)
    values (r.leg_id, r.passenger_id, r.id, r.pickup_label, r.pickup, r.pickup_time, r.monthly_contribution, r.start_date)
    on conflict (leg_id, passenger_id) do update set active = true, paused = false, pickup_label = excluded.pickup_label,
      pickup = excluded.pickup, pickup_time = excluded.pickup_time, monthly_contribution = excluded.monthly_contribution;
    update public.club_members set agreement=r.agreement,match_snapshot=r.match_snapshot,start_date=r.start_date,request_id=r.id where leg_id=l.id and passenger_id=r.passenger_id;
    update driver_legs set seats_open = seats_open - 1 where id = l.id;
    insert into contributions (leg_id, passenger_id, period, amount, status)
    values (l.id, r.passenger_id, date_trunc('month', r.start_date)::date, r.monthly_contribution, 'upcoming')
    on conflict do nothing;
    perform public.generate_contributions();
    perform public.reconcile_commutes();
    update join_requests set status = 'accepted', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'accepted', 'You’re in!',
                   (select first_name from profiles where id = l.driver_id) || ' accepted your request to join the lift club.', '/p/accepted');
  else
    update join_requests set status = 'declined', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'declined', 'Not a fit this time',
                   'That lift club can’t take you right now. We’ll keep looking for other matches.', '/p/find');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_clubs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'asPassenger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'paused', m.paused, 'startDate', m.start_date,
        'pickup', jsonb_build_object('label', m.pickup_label, 'lng', st_x(m.pickup::geometry), 'lat', st_y(m.pickup::geometry)),
        'pickupTime', to_char(m.pickup_time, 'HH24:MI'),
        'destination', coalesce(m.match_snapshot->'destination',jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry))),
        'days', coalesce(m.agreement->'days',to_jsonb(l.days)), 'schedule',m.agreement,'monthlyContribution', m.monthly_contribution,
        'paymentStatus', coalesce((select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = m.passenger_id order by ct.period desc limit 1), 'upcoming'),
        'driver', jsonb_build_object('id', dp.id, 'firstName', dp.first_name, 'lastInitial', dp.last_initial, 'avatarPath', dp.avatar_path,
                                     'rating', dp.rating, 'ratingCount', dp.rating_count, 'identityStatus', coalesce(dp.identity_status::text, 'pending'),'verification',public.driver_verification(dp.id)),
        'vehicle', jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
                                      'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path),
        'seatsTaken', (select count(*) from club_members x where x.leg_id = l.id and x.active),
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial, 'avatarPath', xp.avatar_path))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from club_members m
      join driver_legs l on l.id = m.leg_id
      join profiles dp on dp.id = l.driver_id
      join vehicles v on v.driver_id = l.driver_id
      where m.passenger_id = auth.uid() and m.active), '[]'::jsonb),
    'asDriver', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'originLabel', l.origin_label, 'destinationLabel', l.destination_label,
        'departureTime', to_char(l.departure_time, 'HH24:MI'), 'days', to_jsonb(l.days), 'seatsOpen', l.seats_open,
        'maxDeviationMin', l.max_deviation_min, 'monthlyContribution', l.monthly_contribution,
        'routeDistanceM', l.route_distance_m, 'routeDurationS', l.route_duration_s,
        'route', st_asgeojson(l.route::geometry, 6)::jsonb,
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial,
                                                        'avatarPath', xp.avatar_path, 'pickupLabel', x.pickup_label,
                                                        'pickupTime', to_char(x.pickup_time, 'HH24:MI'),
                                                        'paymentStatus', (select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = x.passenger_id order by ct.period desc limit 1)))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from driver_legs l where l.driver_id = auth.uid()), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_current_instance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  i commute_instances;
  l driver_legs;
  v_me uuid := auth.uid();
begin
  if not public.account_active() then raise exception 'Not authenticated or suspended'; end if;
  perform generate_commute_instances(v_today);
  select ci.* into i from commute_instances ci
  join driver_legs dl on dl.id = ci.leg_id
  where ci.service_date = v_today
    and ci.status not in ('completed', 'cancelled') and ci.sharing_ends_at>now()
    and (dl.driver_id = v_me or exists (select 1 from instance_riders r where r.instance_id = ci.id and r.passenger_id = v_me and r.status not in ('absent','no_show','dropped_off')))
  order by ci.departs_at
  limit 1;
  if not found then
    return null;
  end if;
  select * into l from driver_legs where id = i.leg_id;
  return jsonb_build_object(
    'id', i.id, 'legId', l.id, 'direction',l.direction, 'status', i.status, 'serviceDate', i.service_date,
    'departsAt', i.departs_at, 'sharingStartsAt', i.sharing_starts_at, 'sharingEndsAt', i.sharing_ends_at,
    'driverArrivedAt', i.driver_arrived_at, 'isDriver', l.driver_id = v_me,
    'destination', jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry)),
    'route', case when l.driver_id = v_me then st_asgeojson(l.route::geometry, 6)::jsonb
                  else st_asgeojson(st_linesubstring(l.route::geometry,
                         greatest(0, coalesce((select min(st_linelocatepoint(l.route::geometry, m.pickup::geometry)) from club_members m where m.leg_id = l.id and m.active), 0) - 2500.0 / l.route_distance_m), 1), 6)::jsonb end,
    'routeDurationS', l.route_duration_s,
    'riders', (select jsonb_agg(jsonb_build_object(
                 'passengerId', r.passenger_id, 'status', r.status, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                 'avatarPath', p.avatar_path, 'driverArrivedAt',r.driver_arrived_at,'passengerAtPickup',r.at_pickup_at is not null,'collectedAt',r.collected_at,'noShowAt',r.no_show_at,
                 'pickup', jsonb_build_object('label',coalesce(r.pickup_label,m.pickup_label),'lng',st_x(coalesce(r.pickup,m.pickup)::geometry),'lat',st_y(coalesce(r.pickup,m.pickup)::geometry)),
                 'pickupTime', to_char(m.pickup_time, 'HH24:MI')))
               from instance_riders r join profiles p on p.id = r.passenger_id
               join club_members m on m.leg_id = l.id and m.passenger_id = r.passenger_id
               where r.instance_id = i.id
                 and (l.driver_id = v_me or r.passenger_id = v_me)),
    'driver', (select jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
                                         'rating', p.rating, 'ratingCount', p.rating_count,'verification',public.driver_verification(p.id))
               from profiles p where p.id = l.driver_id),
    'vehicle', (select jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'bodyType', v.body_type,
                                          'registrationSummary', v.registration_summary, 'photoPath', v.photo_path)
                from vehicles v where v.driver_id = l.driver_id)
  );
end $function$;

create or replace function public.can_track(p_instance uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.account_active() and exists(select 1 from public.profile_private where id=auth.uid() and location_consent_at is not null)
 and exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id where i.id=p_instance and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and l.active
 and (l.driver_id=auth.uid() or exists(select 1 from public.instance_riders r join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id where r.instance_id=i.id and r.passenger_id=auth.uid() and r.status in('expected','at_pickup') and m.active and not m.paused)));
$$;
create or replace function public.can_receive_location(p_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare instance uuid; passenger uuid;
begin
 if p_topic !~ '^commute:[0-9a-f-]{36}:[0-9a-f-]{36}$' or not public.account_active() then return false; end if;
 instance:=split_part(p_topic,':',2)::uuid; passenger:=split_part(p_topic,':',3)::uuid;
 return exists(select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.instance_riders r on r.instance_id=i.id
 join public.club_members m on m.leg_id=i.leg_id and m.passenger_id=r.passenger_id
 where i.id=instance and r.passenger_id=passenger and m.active and not m.paused and r.status in('expected','at_pickup','collected')
 and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at and (l.driver_id=auth.uid() or passenger=auth.uid()));
exception when invalid_text_representation then return false;
end $$;
drop policy "commute members receive live location" on realtime.messages;
drop policy "commute members send live location" on realtime.messages;
create policy "authorized pair receives server location" on realtime.messages for select to authenticated using(public.can_receive_location(realtime.topic()));
drop policy pings_read on public.location_pings;
create policy pings_owner_or_safety_reviewer on public.location_pings for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
drop policy riders_read on public.instance_riders;
create policy riders_participant on public.instance_riders for select to authenticated using(passenger_id=(select auth.uid()) or exists(select 1 from public.commute_instances i where i.id=instance_id and public.is_leg_driver(i.leg_id)));
create or replace function public.publish_location(p_instance uuid,p_lng float8,p_lat float8,p_heading real default null,p_speed real default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.driver_legs; passenger uuid; payload jsonb;
begin
 if not public.can_track(p_instance) then raise exception 'Location sharing is not authorized'; end if;
 if p_lat is null or p_lng is null or not p_lat between -90 and 90 or not p_lng between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 select dl.* into l from public.driver_legs dl join public.commute_instances i on i.leg_id=dl.id where i.id=p_instance;
 payload:=jsonb_build_object('from',auth.uid(),'lat',p_lat,'lng',p_lng,'heading',p_heading,'speed',p_speed,'at',floor(extract(epoch from clock_timestamp())*1000));
 if l.driver_id=auth.uid() then
  for passenger in select r.passenger_id from public.instance_riders r join public.club_members m on m.leg_id=l.id and m.passenger_id=r.passenger_id join public.profiles p on p.id=r.passenger_id
    where r.instance_id=p_instance and r.status in('expected','at_pickup','collected') and m.active and not m.paused and p.suspended_at is null loop
   perform realtime.send(payload,'loc','commute:'||p_instance||':'||passenger,true);
  end loop;
 else
  perform realtime.send(payload,'loc','commute:'||p_instance||':'||auth.uid(),true);
 end if;
 if not exists(select 1 from public.location_pings where instance_id=p_instance and user_id=auth.uid() and recorded_at>now()-interval '25 seconds') then
  insert into public.location_pings(instance_id,user_id,location,heading,speed) values(p_instance,auth.uid(),extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_heading,p_speed);
 end if;
end $$;
create or replace function public.record_location(p_instance uuid,p_lng float8,p_lat float8,p_heading real default null,p_speed real default null) returns void language plpgsql security definer set search_path='' as $$
begin perform public.publish_location(p_instance,p_lng,p_lat,p_heading,p_speed); end $$;
create or replace function public.mark_driver_arrived(p_instance uuid,p_passenger uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.account_active() or not exists(select 1 from public.commute_instances i where i.id=p_instance and public.is_leg_driver(i.leg_id) and i.status in('scheduled','sharing','underway') and now() between i.sharing_starts_at and i.sharing_ends_at) then raise exception 'Only the driver can mark arrival during the trip'; end if;
 update public.instance_riders set driver_arrived_at=coalesce(driver_arrived_at,now()) where instance_id=p_instance and passenger_id=p_passenger and status in('expected','at_pickup');
 if not found then raise exception 'Rider is unavailable'; end if;
 update public.commute_instances set status='sharing',driver_arrived_at=coalesce(driver_arrived_at,now()) where id=p_instance and status='scheduled';
end $$;
create or replace function public.mark_driver_arrived(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'Select the passenger whose pickup you have reached'; end $$;
create or replace function public.mark_rider_status(p_instance uuid,p_passenger uuid,p_status public.rider_status) returns void language plpgsql security definer set search_path='' as $$
declare i public.commute_instances; r public.instance_riders; driver boolean;
begin
 select * into i from public.commute_instances where id=p_instance for update;
 select * into r from public.instance_riders where instance_id=p_instance and passenger_id=p_passenger for update;
 driver:=public.is_leg_driver(i.leg_id);
 if not public.account_active() or i.id is null or r.passenger_id is null or i.status not in('scheduled','sharing','underway') or now() not between i.sharing_starts_at and i.sharing_ends_at or not exists(select 1 from public.club_members where leg_id=i.leg_id and passenger_id=p_passenger and active and not paused) then raise exception 'Rider or trip is unavailable'; end if;
 if not(driver or p_passenger=auth.uid()) then raise exception 'Not allowed'; end if;
 if p_status not in('at_pickup','collected','no_show','absent') then raise exception 'Unsupported status'; end if;
 if r.status not in('expected','at_pickup') then raise exception 'Rider pickup is already resolved'; end if;
 if p_status in('collected','no_show') and not driver then raise exception 'Only the driver can collect or mark no-show'; end if;
 if p_status='no_show' and (r.driver_arrived_at is null or r.driver_arrived_at>now()-interval '3 minutes') then raise exception 'Wait the full three-minute grace period for this passenger'; end if;
 update public.instance_riders set status=p_status,at_pickup_at=case when p_status='at_pickup' then now() else at_pickup_at end,collected_at=case when p_status='collected' then now() else collected_at end,no_show_at=case when p_status='no_show' then now() else no_show_at end where instance_id=p_instance and passenger_id=p_passenger;
 if p_status='no_show' then perform public.notify(p_passenger,'no_show','Pickup missed','Your driver waited three minutes at your pickup.','/p/commute'); end if;
 if not exists(select 1 from public.instance_riders where instance_id=p_instance and status in('expected','at_pickup')) and exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then update public.commute_instances set status='underway',started_at=coalesce(started_at,now()) where id=p_instance; end if;
end $$;
create or replace function public.stop_my_sharing(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instance_member(p_instance) then raise exception 'Not your trip'; end if;
 -- Withdrawal is durable and blocks future device publications for this trip.
 update public.profile_private set location_consent_at=null where id=auth.uid();
end $$;
create or replace function public.get_commute_history() returns setof jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'legId',i.leg_id,'direction',l.direction,'date',i.service_date,'departsAt',i.departs_at,
 'status',case when r.status='no_show' then 'missed' else i.status::text end,'driverId',l.driver_id,'driverName',p.first_name,
 'pickupLabel',coalesce(r.pickup_label,m.pickup_label,l.origin_label),'destinationLabel',l.destination_label,
 'canRate',i.status='completed' and r.status='dropped_off' and r.passenger_id=auth.uid(),
 'rated',exists(select 1 from public.ratings x where x.instance_id=i.id and x.rater_id=auth.uid() and x.ratee_id=l.driver_id))
 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id join public.profiles p on p.id=l.driver_id
 left join public.instance_riders r on r.instance_id=i.id and r.passenger_id=auth.uid()
 left join public.club_members m on m.leg_id=l.id and m.passenger_id=auth.uid()
 where l.driver_id=auth.uid() or r.passenger_id=auth.uid() order by i.service_date desc,i.departs_at desc limit 100;
$$;

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

create or replace function public.complete_instance(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.commute_instances;
begin
 select * into i from public.commute_instances where id=p_instance for update;
 if not public.account_active() or not public.is_leg_driver(i.leg_id) then raise exception 'Only the driver can complete the commute'; end if;
 if i.status='completed' then return;end if;
 if i.status not in('sharing','underway') or exists(select 1 from public.instance_riders where instance_id=p_instance and status in('expected','at_pickup')) then raise exception 'Resolve each passenger pickup before completing the commute'; end if;
 update public.commute_instances set status=case when exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then 'completed'::public.instance_status else 'cancelled'::public.instance_status end,completed_at=now() where id=p_instance;
 update public.instance_riders set status='dropped_off' where instance_id=p_instance and status='collected';
 perform public.notify(r.passenger_id,'completed','Commute completed','Rate your completed commute.','/p/rate?instance='||p_instance) from public.instance_riders r where r.instance_id=p_instance and r.status='dropped_off';
end $$;
drop policy ratings_write on public.ratings;
create policy ratings_write on public.ratings for insert to authenticated with check(rater_id=(select auth.uid()) and public.account_active());
-- A membership removal also reconciles current riders before another location is published.
create or replace function lifty_private.membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.active,new.paused) is distinct from (old.active,old.paused) then perform public.reconcile_commutes();end if;
 return new;
end $$;
create trigger memberships_reconcile after update of active,paused on public.club_members for each row execute function lifty_private.membership_changed();
-- Restrict new operational fields to the owner snapshot and admin RPCs.
revoke select on public.profiles from authenticated;
grant select(id,role,first_name,last_initial,avatar_path,about,rating,rating_count,reliability,completed_arrangements,identity_status,is_demo,created_at) on public.profiles to authenticated;
revoke all on function lifty_private.membership_changed() from public,anon,authenticated;
