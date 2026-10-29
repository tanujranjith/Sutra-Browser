-- ============================================================================
-- Sutra Cloud — database + storage schema (run once per project)
-- ----------------------------------------------------------------------------
-- Sutra Cloud is an OPTIONAL, consent-first, end-to-end-encrypted backup of the
-- workspace. The server only ever stores ciphertext (the SUTRAENC envelope) plus
-- a little non-sensitive metadata. It never sees plaintext notes/tasks/etc.
--
-- How to apply:
--   • Supabase Dashboard → SQL Editor → paste this file → Run, OR
--   • supabase db push  (if you use the Supabase CLI)
--
-- This script is idempotent: safe to run more than once.
-- ============================================================================

-- 1) Private bucket holding each user's encrypted .sutra backups.
--    Object path convention:  <auth.uid()>/<timestamp>-<label>.sutra
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- 2) Storage Row Level Security — a user may only touch objects inside their own
--    "<uid>/" folder. (storage.objects already has RLS enabled by Supabase.)
drop policy if exists "Sutra backups: read own"   on storage.objects;
drop policy if exists "Sutra backups: insert own" on storage.objects;
drop policy if exists "Sutra backups: update own" on storage.objects;
drop policy if exists "Sutra backups: delete own" on storage.objects;

create policy "Sutra backups: read own"
  on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Sutra backups: insert own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Sutra backups: update own"
  on storage.objects for update to authenticated
  using      (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Sutra backups: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Tiny metadata index (NO workspace content — labels/sizes/timestamps only).
--    Lets the app list a user's backups quickly and enforce keep-last-N.
create table if not exists public.backup_index (
  id          uuid primary key default gen_random_uuid(),
  -- Defaults to the caller's id from their JWT, so the client never sends it and
  -- the RLS "insert own" check below always matches.
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path        text not null,
  label       text,
  size_bytes  bigint,
  device_id   text,
  created_at  timestamptz not null default now()
);

create index if not exists backup_index_user_created
  on public.backup_index (user_id, created_at desc);

alter table public.backup_index enable row level security;

drop policy if exists "backup_index: read own"   on public.backup_index;
drop policy if exists "backup_index: insert own" on public.backup_index;
drop policy if exists "backup_index: delete own" on public.backup_index;

create policy "backup_index: read own"
  on public.backup_index for select to authenticated
  using (user_id = auth.uid());

create policy "backup_index: insert own"
  on public.backup_index for insert to authenticated
  with check (user_id = auth.uid());

create policy "backup_index: delete own"
  on public.backup_index for delete to authenticated
  using (user_id = auth.uid());

-- RLS policies do not grant table privileges. Keep the metadata index
-- unavailable to anonymous callers while granting the authenticated browser
-- only the operations used by the Supabase backup adapter.
revoke all on table public.backup_index from public, anon, authenticated;
grant select, insert, delete on table public.backup_index to authenticated;
