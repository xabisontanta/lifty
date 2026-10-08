-- Pickup points as JSON for the client (applied).
create or replace function public.list_pickup_points(p_lng float8 default null, p_lat float8 default null, p_radius_m int default 5000)
returns setof jsonb language sql stable security invoker set search_path = public, extensions as $$
  select jsonb_build_object('id', id, 'label', name, 'area', area, 'kind', kind,
                            'lng', st_x(location::geometry), 'lat', st_y(location::geometry))
  from pickup_points
  where p_lng is null or st_dwithin(location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  order by case when p_lng is null then 0 else st_distance(location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) end
  limit 30;
$$;
revoke execute on function public.list_pickup_points(float8, float8, int) from public, anon;
grant execute on function public.list_pickup_points(float8, float8, int) to authenticated;

-- Storage buckets (applied): avatars + vehicle-photos are public-read, kyc is private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
  ('vehicle-photos', 'vehicle-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('kyc', 'kyc', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy "own avatar upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'vehicle-photos') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own avatar update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own kyc upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own or admin kyc read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
