-- Reconcile the repository with the Supabase hardening applied in production
-- on 2026-07-30.
--
-- Run AFTER:
--   1. 20260716_device_revoke_wipe.sql
--   2. 20260718_sync_account_isolation.sql
--
-- Safe to rerun. This migration replaces only the four sync-assets policies
-- and adjusts only the EXECUTE ACL of public.rls_auto_enable(). It does not
-- recreate tables or buckets and does not delete rows or Storage objects.

begin;

drop policy if exists "Sutra sync assets: read active own"
  on storage.objects;

drop policy if exists "Sutra sync assets: insert active own"
  on storage.objects;

drop policy if exists "Sutra sync assets: update active own"
  on storage.objects;

drop policy if exists "Sutra sync assets: delete active own"
  on storage.objects;

create policy "Sutra sync assets: read active own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'sync-assets'
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{64}$'
  )
  and public.sync_session_active()
);

create policy "Sutra sync assets: insert active own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sync-assets'
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{64}$'
  )
  and public.sync_session_active()
);

create policy "Sutra sync assets: update active own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'sync-assets'
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{64}$'
  )
  and public.sync_session_active()
)
with check (
  bucket_id = 'sync-assets'
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{64}$'
  )
  and public.sync_session_active()
);

create policy "Sutra sync assets: delete active own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sync-assets'
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{64}$'
  )
  and public.sync_session_active()
);

-- rls_auto_enable() is a platform/database event-trigger helper, not a browser
-- RPC. Some fresh/local schemas do not define it, so guard the ACL statement
-- while preserving the exact production boundary wherever it exists.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated;';
    execute 'grant execute on function public.rls_auto_enable() to postgres;';
  end if;
end;
$$;

commit;
