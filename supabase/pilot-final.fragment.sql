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
