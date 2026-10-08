-- ⚠️ NOT YET APPLIED — the automated tool blocks statements that delete data.
-- Run this once in the Supabase dashboard → SQL Editor for project "Lifty".
--
-- POPIA: right to erasure (user-initiated) + 30-day retention of live-location breadcrumbs.

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  update driver_legs set seats_open = seats_open + 1
  where id in (select leg_id from club_members where passenger_id = auth.uid() and active);
  delete from auth.users where id = auth.uid();
end $$;

create or replace function public.purge_location_pings()
returns void language sql security definer set search_path = public as $$
  delete from location_pings where recorded_at < now() - interval '30 days';
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.purge_location_pings() from public, anon, authenticated;

select cron.schedule('lifty-purge-location', '30 1 * * *', $c$select public.purge_location_pings()$c$);
