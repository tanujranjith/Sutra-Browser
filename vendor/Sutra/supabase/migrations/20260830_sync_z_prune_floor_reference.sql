-- Existing-project reconciliation for the Sync pruning floor reference.
-- The original pruning function qualified its local v_floor variable with the
-- function name inside DELETE. PostgreSQL parsed that qualifier as a missing
-- table reference only when a positive floor reached the delete branch. This
-- replacement uses a uniquely named local variable and preserves all data.

begin;

create or replace function public.sync_prune_ops("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_snapshot_cursor bigint;
  v_min_device_cursor bigint;
  v_prune_floor bigint;
  v_deleted bigint;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;

  perform pg_advisory_xact_lock(hashtextextended('sutra-sync-push:' || auth.uid()::text, 0));

  select max(cursor) into v_snapshot_cursor
    from public.sync_snapshots
   where user_id = auth.uid();
  if v_snapshot_cursor is null then
    return jsonb_build_object('ok', true, 'pruned', 0, 'reason', 'no-snapshot');
  end if;

  select min(last_seen_cursor) into v_min_device_cursor
    from public.sync_devices
   where user_id = auth.uid()
     and revoked_at is null;

  v_prune_floor := least(v_snapshot_cursor, coalesce(v_min_device_cursor, 0));
  if v_prune_floor is null or v_prune_floor <= 0 then
    return jsonb_build_object('ok', true, 'pruned', 0, 'reason', 'no-floor');
  end if;

  delete from public.sync_ops
   where user_id = auth.uid()
     and id <= v_prune_floor;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'pruned', v_deleted, 'floor', v_prune_floor);
end;
$$;

revoke all on function public.sync_prune_ops(text) from public, anon;
grant execute on function public.sync_prune_ops(text) to authenticated;

commit;
