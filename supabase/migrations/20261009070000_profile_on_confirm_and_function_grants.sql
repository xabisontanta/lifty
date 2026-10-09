-- 1. The database creates the profile itself the moment a phone number is CONFIRMED.
--    Until now the app created it with a second call (bootstrap_account) after the code was verified; if the app closed
--    in between, the account existed without a profile. bootstrap_account stays as a harmless fallback (it returns early
--    when the profile exists).
--    - Fires only when phone_confirmed_at is set (insert of an already-confirmed user, or the update that confirms it):
--      never for someone who merely asked for a code.
--    - Reads the name and role the sign-up screen passes as user metadata; anything missing or odd falls back to a safe default.
--    - Must NEVER block a sign-in: any failure here is logged as a warning and swallowed.
create or replace function lifty_private.create_profile_on_confirm() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  full_name text := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  chosen text := new.raw_user_meta_data ->> 'role';
  first text;
  last text;
begin
  if new.phone is null or new.phone_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.phone_confirmed_at is not null then return new; end if; -- was already confirmed
  if exists (select 1 from public.profiles where id = new.id) then return new; end if;
  begin
    first := nullif(left(split_part(full_name, ' ', 1), 60), '');
    last := trim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1));
    insert into public.profiles (id, role, first_name, last_initial)
    values (new.id, case when chosen = 'driver' then 'driver'::public.user_role else 'passenger'::public.user_role end, coalesce(first, 'Member'), upper(left(last, 1)));
    insert into public.profile_private (id, last_name, phone, terms_accepted_at)
    values (new.id, last, new.phone, case when new.raw_user_meta_data ->> 'terms_accepted' = 'true' then now() end)
    on conflict (id) do nothing;
  exception when others then
    raise warning 'create_profile_on_confirm failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function lifty_private.create_profile_on_confirm() from public, anon, authenticated;

drop trigger if exists create_profile_on_confirm on auth.users;
create trigger create_profile_on_confirm
  after insert or update of phone_confirmed_at on auth.users
  for each row execute function lifty_private.create_profile_on_confirm();

-- 2. Server-side helpers that signed-in users must not be able to call directly. Every caller is a SECURITY DEFINER function
--    (runs as the owner), none is used by a policy, view, cron job or the app. In particular request_to_join(commute, leg)
--    let a user skip the "this offer is still valid" check that request_to_join_quote enforces.
revoke execute on function public.request_to_join(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.find_matches(uuid) from public, anon, authenticated;
revoke execute on function public.record_location(uuid, double precision, double precision, real, real) from public, anon, authenticated;
revoke execute on function public.driver_approved(uuid) from public, anon, authenticated;
revoke execute on function public.commute_booked_on(public.passenger_commutes, date) from public, anon, authenticated;

-- 3. Two internal tables are reached only by server-side functions. They already deny everyone (RLS on, no policy); say so
--    explicitly so the intent is visible and the security advisor stops flagging them.
create policy no_client_access on public.admins for all to anon, authenticated using (false) with check (false);
create policy no_client_access on public.match_quotes for all to anon, authenticated using (false) with check (false);
