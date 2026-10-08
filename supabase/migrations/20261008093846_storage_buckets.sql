insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
  ('vehicle-photos', 'vehicle-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('kyc', 'kyc', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Files live under <user id>/... ; owners write their own folder.
create policy "own avatar upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'vehicle-photos') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own avatar update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos') and (storage.foldername(name))[1] = (select auth.uid())::text);

-- KYC: private; owner can upload and read their own, admins can read all.
create policy "own kyc upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own or admin kyc read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
