-- Sutra Sync asset-index RPC ambiguity reconciliation (2026-08-30)
--
-- Existing projects only. Run after 20260825_sync_pruning_durable_ack.sql.
-- This is additive/idempotent: it replaces one RPC body without deleting or
-- rewriting encrypted operations, snapshots, vault keys, devices, or assets.
--
-- Why: the RPC parameter must remain named `hash` for the browser/PostgREST
-- contract, but `on conflict (user_id, hash)` is ambiguous inside PL/pgSQL.
-- Naming the existing primary-key constraint removes that ambiguity.

begin;

create or replace function public.sync_put_asset(hash text, size_bytes bigint default 0, "deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if hash is null or hash !~ '^[0-9a-f]{64}$' or coalesce(size_bytes, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'bad-request');
  end if;
  insert into public.sync_asset_index (user_id, hash, size_bytes)
  values (auth.uid(), hash, coalesce(size_bytes, 0))
  on conflict on constraint sync_asset_index_pkey
  do update set size_bytes = excluded.size_bytes;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sync_put_asset(text, bigint, text) from public, anon;
grant execute on function public.sync_put_asset(text, bigint, text) to authenticated;

commit;
