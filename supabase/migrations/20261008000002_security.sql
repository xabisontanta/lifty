-- Row level security, column privileges and helper predicates.

-- ---------- helpers (security definer so they can be used inside policies without recursion) ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.is_leg_driver(p_leg uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.driver_legs l where l.id = p_leg and l.driver_id = (select auth.uid()));
$$;

create or replace function public.is_leg_member(p_leg uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_leg_driver(p_leg)
      or exists (select 1 from public.club_members m
                 where m.leg_id = p_leg and m.passenger_id = (select auth.uid()) and m.active);
$$;

create or replace function public.is_instance_member(p_instance uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.commute_instances i
    where i.id = p_instance
      and (public.is_leg_driver(i.leg_id)
           or exists (select 1 from public.instance_riders r
                      where r.instance_id = i.id and r.passenger_id = (select auth.uid())))
  );
$$;

-- Live location may only flow inside the commute window and while the commute is open.
create or replace function public.can_track(p_instance uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.commute_instances i
    where i.id = p_instance
      and now() between i.sharing_starts_at and i.sharing_ends_at
      and i.status in ('scheduled', 'sharing', 'underway')
  ) and public.is_instance_member(p_instance);
$$;

-- ---------- enable RLS everywhere ----------
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.admins enable row level security;
alter table public.vehicles enable row level security;
alter table public.verification_documents enable row level security;
alter table public.pickup_points enable row level security;
alter table public.driver_legs enable row level security;
alter table public.passenger_commutes enable row level security;
alter table public.join_requests enable row level security;
alter table public.club_members enable row level security;
alter table public.commute_instances enable row level security;
alter table public.instance_riders enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.messages enable row level security;
alter table public.ratings enable row level security;
alter table public.contributions enable row level security;
alter table public.reports enable row level security;
alter table public.location_pings enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

-- ---------- column privileges: clients may only write user-editable columns ----------
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, role, first_name, last_initial, avatar_path, about) on public.profiles to authenticated;
grant update (first_name, last_initial, avatar_path, about) on public.profiles to authenticated;

revoke insert, update on public.vehicles from anon, authenticated;
grant insert (driver_id, make, model, colour, year, body_type, registration_summary, seats_total, photo_path) on public.vehicles to authenticated;
grant update (make, model, colour, year, body_type, registration_summary, seats_total, photo_path) on public.vehicles to authenticated;

revoke insert, update on public.verification_documents from anon, authenticated;
grant insert (user_id, kind, storage_path, detail) on public.verification_documents to authenticated;

revoke insert, update, delete on public.driver_legs from anon, authenticated;
grant update (seats_open, max_deviation_min, monthly_contribution, active, departure_time, days) on public.driver_legs to authenticated;

revoke insert, update, delete on public.join_requests, public.club_members, public.commute_instances,
  public.instance_riders, public.contributions, public.location_pings, public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (paused) on public.club_members to authenticated;

revoke update, delete on public.ratings, public.reports, public.messages from anon, authenticated;

-- ---------- policies ----------
-- profiles: public-safe columns readable by any signed-in user
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy private_own on public.profile_private for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy vehicles_read on public.vehicles for select to authenticated using (true);
create policy vehicles_insert_own on public.vehicles for insert to authenticated with check (driver_id = (select auth.uid()));
create policy vehicles_update_own on public.vehicles for update to authenticated using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));

create policy docs_read on public.verification_documents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy docs_insert_own on public.verification_documents for insert to authenticated with check (user_id = (select auth.uid()));

create policy pickup_read on public.pickup_points for select to authenticated using (true);
create policy pickup_admin on public.pickup_points for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- driver_legs: owner only (contains home location). Others use RPCs.
create policy legs_owner_read on public.driver_legs for select to authenticated using (driver_id = (select auth.uid()));
create policy legs_owner_update on public.driver_legs for update to authenticated using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));

create policy commutes_own on public.passenger_commutes for all to authenticated
  using (passenger_id = (select auth.uid())) with check (passenger_id = (select auth.uid()));

create policy requests_read on public.join_requests for select to authenticated
  using (passenger_id = (select auth.uid()) or (select public.is_leg_driver(leg_id)));

create policy members_read on public.club_members for select to authenticated
  using (passenger_id = (select auth.uid()) or (select public.is_leg_member(leg_id)));
create policy members_pause_own on public.club_members for update to authenticated
  using (passenger_id = (select auth.uid())) with check (passenger_id = (select auth.uid()));

create policy instances_read on public.commute_instances for select to authenticated using ((select public.is_instance_member(id)));
create policy riders_read on public.instance_riders for select to authenticated using ((select public.is_instance_member(instance_id)));

create policy exceptions_read on public.schedule_exceptions for select to authenticated
  using (user_id = (select auth.uid()) or (leg_id is not null and (select public.is_leg_member(leg_id))));
create policy exceptions_write on public.schedule_exceptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (leg_id is null or (select public.is_leg_member(leg_id))));
create policy exceptions_delete on public.schedule_exceptions for delete to authenticated using (user_id = (select auth.uid()));

create policy messages_read on public.messages for select to authenticated using ((select public.is_leg_member(leg_id)));
create policy messages_send on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select public.is_leg_member(leg_id)));

create policy ratings_read on public.ratings for select to authenticated using (true);
create policy ratings_write on public.ratings for insert to authenticated
  with check (rater_id = (select auth.uid()) and rater_id <> ratee_id and (select public.is_leg_member(leg_id)));

create policy contributions_read on public.contributions for select to authenticated
  using (passenger_id = (select auth.uid()) or (select public.is_leg_driver(leg_id)));

create policy reports_read on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));
create policy reports_write on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));

create policy pings_read on public.location_pings for select to authenticated using ((select public.is_instance_member(instance_id)));

create policy notifications_own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy push_own on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- realtime: private broadcast channel per commute instance ----------
-- Topic format: commute:<instance uuid>. Only instance members, only inside the window.
create policy "commute members receive live location" on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'commute:%'
    and public.can_track(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
  );
create policy "commute members send live location" on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'commute:%'
    and public.can_track(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
  );

-- row-change streams the app listens to
alter publication supabase_realtime add table public.messages, public.commute_instances, public.instance_riders,
  public.join_requests, public.notifications;
