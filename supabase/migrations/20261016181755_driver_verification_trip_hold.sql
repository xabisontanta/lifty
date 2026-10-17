-- A verification hold preserves arrangements and trip history. It prevents new
-- pickups, while allowing passengers already in the vehicle to finish safely.
create table lifty_private.driver_leg_holds (
 leg_id uuid primary key references public.driver_legs(id) on delete cascade,
 reason text check(reason in('expired','suspended','unapproved')),
 episode bigint not null default 0, updated_at timestamptz not null default now()
);
create table lifty_private.driver_hold_notices (
 leg_id uuid not null references public.driver_legs(id) on delete cascade,
 episode bigint not null, user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in('verification_hold','verification_restored')),
 primary key(leg_id,episode,user_id,kind)
);
alter table lifty_private.driver_leg_holds enable row level security;
alter table lifty_private.driver_hold_notices enable row level security;
revoke all on lifty_private.driver_leg_holds,lifty_private.driver_hold_notices from public,anon,authenticated;

create or replace function lifty_private.driver_hold_reason(p_driver uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
 when not exists(select 1 from public.profiles where id=p_driver and role='driver' and suspended_at is null) then 'suspended'
 when exists(select 1 from jsonb_each_text(lifty_private.raw_driver_verification(p_driver)) v where v.value='expired') then 'expired'
 when not exists(select 1 from public.vehicles where driver_id=p_driver and status='verified')
   or exists(select 1 from jsonb_each_text(lifty_private.raw_driver_verification(p_driver)) v where v.value<>'verified') then 'unapproved'
 else null end;
$$;

-- A suspended account gets this narrow safe-closure permission, never general
-- membership, GPS or pickup permission. Test-environment admission still applies.
create or replace function lifty_private.owns_trip_for_closure(p_instance uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.commute_instances i join public.driver_legs l on l.id=i.leg_id
  join public.profiles p on p.id=l.driver_id
  where i.id=p_instance and p.id=auth.uid() and p.role='driver'
  and (not p.is_test or exists(select 1 from lifty_private.test_environment e where e.id and
   (e.mode='local' or (e.mode='staging' and exists(select 1 from lifty_private.testers t where t.user_id=p.id))))));
$$;

create or replace function lifty_private.reconcile_driver_holds(p_driver uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare l public.driver_legs; h lifty_private.driver_leg_holds; v_reason text; recipient uuid; notice_kind text;
begin
 for l in select x.* from public.driver_legs x where (p_driver is null or x.driver_id=p_driver)
 and (exists(select 1 from public.club_members m where m.leg_id=x.id and m.active)
   or exists(select 1 from lifty_private.driver_leg_holds s where s.leg_id=x.id)) order by x.id loop
  insert into lifty_private.driver_leg_holds(leg_id) values(l.id) on conflict do nothing;
  select * into h from lifty_private.driver_leg_holds where leg_id=l.id for update;
  v_reason:=lifty_private.driver_hold_reason(l.driver_id);
  if v_reason is distinct from h.reason then
   update lifty_private.driver_leg_holds set reason=v_reason,episode=episode+case when v_reason is not null then 1 else 0 end,updated_at=now()
    where leg_id=l.id returning * into h;
  end if;
  if h.episode=0 then continue;end if;
  notice_kind:=case when v_reason is null then 'verification_restored' else 'verification_hold' end;
  for recipient in select l.driver_id union select m.passenger_id from public.club_members m
   where m.leg_id=l.id and m.active and (nullif(m.agreement->>'endDate','') is null or (m.agreement->>'endDate')::date>=(now() at time zone 'Africa/Johannesburg')::date) loop
   insert into lifty_private.driver_hold_notices(leg_id,episode,user_id,kind) values(l.id,h.episode,recipient,notice_kind) on conflict do nothing;
   if found then
    insert into public.notifications(user_id,kind,title,body,link,source_leg_id)
    values(recipient,notice_kind,case when v_reason is null then 'Driver approval restored' else 'Future pickups on hold' end,
     case when v_reason is null then 'Driver approval is current again. Check your agreed departure before travelling.'
      else 'Driver approval needs review. No new pickups can start until approval is restored. Your arrangement is saved; check with your lift club before travelling.' end,
     case when recipient=l.driver_id then '/d/today' else '/p/commute' end,l.id);
   end if;
  end loop;
 end loop;
end $$;

create or replace function lifty_private.document_hold_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin perform lifty_private.reconcile_driver_holds(new.user_id);return new;end $$;
-- Run after verification_latest has recomputed the vehicle approval.
create trigger zz_document_hold_changed after insert or update on public.verification_documents for each row execute function lifty_private.document_hold_changed();
create or replace function lifty_private.driver_suspension_hold_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.suspended_at is distinct from old.suspended_at then perform lifty_private.reconcile_driver_holds(new.id);end if;return new;end $$;
create trigger zz_driver_suspension_hold after update of suspended_at on public.profiles for each row when(new.role='driver') execute function lifty_private.driver_suspension_hold_changed();

-- Public JSON contract: preserve the selected instance and compute the current
-- hold dynamically, even when the scheduled reminder has not run yet.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.get_current_instance()'::regprocedure);
 if position('return lifty_private.label_test_driver(j);' in d)=0 then raise exception 'Current-instance hold patch requires review';end if;
 d:=replace(d,'if j is not null and not public.can_view_test_leg((j->>''legId'')::uuid) then return null;end if;',
  'if j is not null and not public.can_view_test_leg((j->>''legId'')::uuid) and not lifty_private.owns_trip_for_closure((j->>''id'')::uuid) then return null;end if;');
 execute replace(d,'return lifty_private.label_test_driver(j);',
  'if j is not null then'||chr(10)||
  ' perform lifty_private.reconcile_driver_holds((select driver_id from public.driver_legs where id=(j->>''legId'')::uuid));'||chr(10)||
  ' j:=j||jsonb_build_object(''verificationHold'',lifty_private.driver_hold_reason((j->''driver''->>''id'')::uuid) is not null,''verificationHoldReason'',lifty_private.driver_hold_reason((j->''driver''->>''id'')::uuid));'||chr(10)||
  'end if;'||chr(10)||'return lifty_private.label_test_driver(j);');
 d:=pg_get_functiondef('lifty_private.raw_get_current_instance()'::regprocedure);
 if position('if not public.account_active() then' in d)=0 then raise exception 'Suspended closure snapshot patch requires review';end if;
 execute replace(d,'if not public.account_active() then',
  'if not public.account_active() and not exists(select 1 from public.commute_instances ci where lifty_private.owns_trip_for_closure(ci.id) and ci.status in(''sharing'',''underway'') and exists(select 1 from public.instance_riders r where r.instance_id=ci.id and r.status=''collected'')) then');
end $$;

-- Generator reconciliation must not cancel or rewrite an in-progress commute
-- merely because the driver was suspended. Holds are computed separately.
do $$ declare f text;d text;needle text:='or exists(select 1 from public.profiles p where p.id=l.driver_id and p.suspended_at is not null)';begin
 foreach f in array array['public.generate_commute_instances(date)','lifty_private.generate_leg_instances(uuid,date)'] loop
  d:=pg_get_functiondef(f::regprocedure);
  if position(needle in d)=0 then raise exception 'Verification hold generator patch requires review: %',f;end if;
  execute replace(d,needle,'');
 end loop;
 d:=pg_get_functiondef('public.mark_driver_arrived(uuid,uuid)'::regprocedure);
 if position('update public.instance_riders' in d)=0 then raise exception 'Arrival hold patch requires review';end if;
 execute replace(d,'update public.instance_riders',
  'if lifty_private.driver_hold_reason(auth.uid()) is not null then raise exception ''Driver approval is on hold. No new pickups can start.'';end if;'||chr(10)||' update public.instance_riders');
 d:=pg_get_functiondef('public.mark_rider_status(uuid,uuid,public.rider_status)'::regprocedure);
 if position('if p_status not in(''at_pickup'',''collected'',''no_show'',''absent'')' in d)=0 then raise exception 'Rider hold patch requires review';end if;
 execute replace(d,'if p_status not in(''at_pickup'',''collected'',''no_show'',''absent'')',
  'if p_status<>''absent'' and lifty_private.driver_hold_reason((select driver_id from public.driver_legs where id=i.leg_id)) is not null then raise exception ''Driver approval is on hold. No new pickups can start.'';end if;'||chr(10)||
  ' if p_status not in(''at_pickup'',''collected'',''no_show'',''absent'')');
end $$;

create or replace function public.complete_instance(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.commute_instances; held boolean;
begin
 select * into i from public.commute_instances where id=p_instance for update;
 if not lifty_private.owns_trip_for_closure(p_instance) then raise exception 'Only the driver can complete the commute';end if;
 if i.status='completed' then return;end if;
 held:=lifty_private.driver_hold_reason(auth.uid()) is not null;
 if i.status not in('sharing','underway') then raise exception 'Resolve each passenger pickup before completing the commute';end if;
 -- Close unresolved pickups without punishing riders when a hold interrupts a
 -- run. Actual collected riders and completed history are preserved.
 if held and exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then
  update public.instance_riders set status='absent' where instance_id=p_instance and status in('expected','at_pickup');
 elsif exists(select 1 from public.instance_riders where instance_id=p_instance and status in('expected','at_pickup')) then
  raise exception 'Resolve each passenger pickup before completing the commute';
 end if;
 if not public.account_active() and not (held and exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected')) then raise exception 'Only the driver can complete the commute';end if;
 update public.commute_instances set status=case when exists(select 1 from public.instance_riders where instance_id=p_instance and status='collected') then 'completed'::public.instance_status else 'cancelled'::public.instance_status end,completed_at=now() where id=p_instance;
 update public.instance_riders set status='dropped_off' where instance_id=p_instance and status='collected';
 perform public.notify(r.passenger_id,'completed','Commute completed','Rate your completed commute.','/p/rate?instance='||p_instance) from public.instance_riders r where r.instance_id=p_instance and r.status='dropped_off';
end $$;
create or replace function public.stop_my_sharing(p_instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instance_member(p_instance) and not lifty_private.owns_trip_for_closure(p_instance) then raise exception 'Not your trip';end if;
 insert into lifty_private.location_withdrawals(instance_id,user_id) values(p_instance,auth.uid()) on conflict do nothing;
end $$;

-- Dynamic RPC checks are immediate. These jobs additionally notify idle clubs
-- without requiring anybody to open the app. Reapproval triggers recovery above.
do $$ declare f text;d text;begin
 foreach f in array array['public.reconcile_commutes()','lifty_private.queue_document_expiry_reminders()'] loop
  d:=pg_get_functiondef(f::regprocedure);
  if position('end $function$' in d)=0 then raise exception 'Scheduled hold patch requires review: %',f;end if;
  execute replace(d,'end $function$',' perform lifty_private.reconcile_driver_holds();'||chr(10)||'end $function$');
 end loop;
end $$;
revoke all on function lifty_private.driver_hold_reason(uuid),lifty_private.owns_trip_for_closure(uuid),lifty_private.reconcile_driver_holds(uuid),
 lifty_private.document_hold_changed(),lifty_private.driver_suspension_hold_changed() from public,anon,authenticated;
