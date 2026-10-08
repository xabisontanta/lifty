create table lifty_private.holidays(service_date date primary key,name text not null);
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
