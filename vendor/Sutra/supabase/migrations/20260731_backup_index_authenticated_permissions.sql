-- Reconcile Sutra Cloud backup metadata permissions with the operations used
-- by the authenticated browser adapter.
--
-- RLS remains authoritative for row ownership. This migration only restores
-- SELECT, INSERT, and DELETE table privileges required for listing, creating,
-- and deleting the caller's own backup_index rows. It grants no anonymous or
-- UPDATE access and does not modify existing rows or Storage objects.

begin;

revoke all on table public.backup_index from public, anon, authenticated;
grant select, insert, delete on table public.backup_index to authenticated;

commit;
