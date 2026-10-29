-- Sutra Sync additive account-isolation hardening.
-- Run AFTER supabase/sync-schema.sql and 20260716_device_revoke_wipe.sql.
-- Safe to rerun. It does not touch encrypted vault rows, operations, keys,
-- snapshots, device registrations, or stored asset objects.
--
-- The sync client has always written objects as <auth.uid()>/<sha256>. Tighten
-- Storage RLS to enforce that exact two-segment opaque path server-side, so a
-- crafted nested prefix cannot be listed, uploaded, overwritten, or deleted.

alter table storage.objects enable row level security;

drop policy if exists "Sutra sync assets: read active own" on storage.objects;
create policy "Sutra sync assets: read active own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sync-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{64}$'
    and public.sync_session_active()
  );

drop policy if exists "Sutra sync assets: insert active own" on storage.objects;
create policy "Sutra sync assets: insert active own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sync-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{64}$'
    and public.sync_session_active()
  );

drop policy if exists "Sutra sync assets: update active own" on storage.objects;
create policy "Sutra sync assets: update active own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'sync-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{64}$'
    and public.sync_session_active()
  )
  with check (
    bucket_id = 'sync-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{64}$'
    and public.sync_session_active()
  );

drop policy if exists "Sutra sync assets: delete active own" on storage.objects;
create policy "Sutra sync assets: delete active own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sync-assets'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{64}$'
    and public.sync_session_active()
  );
