-- Existing-project reconciliation for durable Sync pruning acknowledgements.
--
-- Delivery of an encrypted op is not proof that the browser durably merged,
-- applied, readback-verified, and committed it. This migration stops pull/push
-- from advancing sync_devices.last_seen_cursor. The browser advances that
-- pruning acknowledgement explicitly with sync_touch_device only after its
-- atomic local cycle commit succeeds.
--
-- Covered operations may all be deleted. The encrypted snapshot cursor is
-- therefore part of the logical server head so a fully pruned log does not
-- make the next valid push look stale.

begin;

alter table public.sync_devices
  add column if not exists last_pushed_sequence bigint not null default -1;

-- This backfill must run before pruning is enabled. Once covered operation
-- rows are deleted, their per-device sequence cannot be reconstructed.
update public.sync_devices d
   set last_pushed_sequence = greatest(
     d.last_pushed_sequence,
     coalesce((
       select max(o.device_seq)
         from public.sync_ops o
        where o.user_id = d.user_id and o.device_id = d.device_id
     ), -1)
   );

create or replace function public.sync_touch_device("deviceId" text, label text default null, cursor bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_head bigint;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  select greatest(
      coalesce(max(o.id), 0),
      coalesce((select s.cursor from public.sync_snapshots s where s.user_id = auth.uid()), 0)
    ) into v_head
    from public.sync_ops o
   where o.user_id = auth.uid();
  if sync_touch_device.cursor is not null
     and (sync_touch_device.cursor < 0 or sync_touch_device.cursor > v_head) then
    return jsonb_build_object('ok', false, 'code', 'bad-cursor');
  end if;
  update public.sync_devices d
     set label = coalesce(sync_touch_device.label, d.label),
         last_seen_cursor = greatest(d.last_seen_cursor, coalesce(sync_touch_device.cursor, d.last_seen_cursor)),
         last_seen_at = now()
   where d.user_id = auth.uid() and d.device_id = "deviceId";
  return jsonb_build_object('ok', true, 'cursor', coalesce(sync_touch_device.cursor, v_head));
end;
$$;

create or replace function public.sync_pull(cursor bigint default 0, "deviceId" text default null, max_rows integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_rows jsonb;
  v_last bigint;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if coalesce(sync_pull.cursor, 0) < 0 then return jsonb_build_object('ok', false, 'code', 'bad-cursor'); end if;

  select coalesce(jsonb_agg(o.envelope order by o.id), '[]'::jsonb), max(o.id)
    into v_rows, v_last
    from (
      select id, envelope from public.sync_ops
      where user_id = auth.uid() and id > coalesce(sync_pull.cursor, 0)
      order by id
      limit least(greatest(coalesce(max_rows, 500), 1), 1000)
    ) o;

  update public.sync_devices
     set last_seen_at = now()
   where user_id = auth.uid() and device_id = "deviceId";

  return jsonb_build_object('ok', true, 'ops', v_rows, 'cursor', coalesce(v_last, sync_pull.cursor, 0));
end;
$$;

create or replace function public.sync_push(ops jsonb, cursor bigint default 0, "deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_head bigint;
  v_fresh jsonb[] := array[]::jsonb[];
  v_env jsonb;
  v_op_id text;
  v_seq bigint;
  v_record_key text;
  v_kind text;
  v_protocol integer;
  v_schema integer;
  v_acked_max bigint;
  v_existing jsonb;
  v_device_sequence_floor bigint;
  v_fresh_sequence_max bigint := 0;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if jsonb_typeof(coalesce(ops, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(ops, '[]'::jsonb)) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid-envelope');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sutra-sync-push:' || auth.uid()::text, 0));
  select greatest(
      coalesce(max(o.id), 0),
      coalesce((select s.cursor from public.sync_snapshots s where s.user_id = auth.uid()), 0)
    ) into v_head
    from public.sync_ops o
   where o.user_id = auth.uid();
  select d.last_pushed_sequence into v_device_sequence_floor
    from public.sync_devices d
   where d.user_id = auth.uid() and d.device_id = "deviceId"
   for update;

  for v_env in select * from jsonb_array_elements(coalesce(ops, '[]'::jsonb)) loop
    v_op_id := v_env #>> '{meta,opId}';
    v_seq := nullif(v_env #>> '{meta,lamport}', '')::bigint;
    v_record_key := v_env #>> '{meta,recordKey}';
    v_kind := v_env #>> '{meta,kind}';
    v_protocol := nullif(v_env #>> '{meta,protocolVersion}', '')::integer;
    v_schema := nullif(v_env #>> '{meta,schemaVersion}', '')::integer;

    if (v_env->>'v') is distinct from '1' or (v_env->>'alg') is distinct from 'A256GCM'
       or v_env->>'ct' is null or length(v_env->>'ct') < 24 or length(v_env->>'ct') > 16777216
       or v_env->>'iv' is null or length(v_env->>'iv') <> 16
       or v_op_id is null or length(v_op_id) > 200
       or (v_env #>> '{meta,deviceId}') <> "deviceId"
       or v_seq is null or v_seq < 0
       or v_op_id <> ("deviceId" || ':' || v_seq::text)
       or v_record_key is null or length(v_record_key) > 1024 or v_record_key !~ '^(a|c|o)/'
       or v_kind is null or v_kind not in ('upsert', 'delete')
       or v_protocol is null or v_protocol <> 1 or v_schema is null or v_schema < 1 then
      return jsonb_build_object('ok', false, 'code', 'invalid-envelope');
    end if;

    select o.envelope into v_existing from public.sync_ops o
      where o.user_id = auth.uid() and o.op_id = v_op_id;
    if found then
      if v_existing <> v_env then return jsonb_build_object('ok', false, 'code', 'op-id-collision'); end if;
    else
      if v_seq <= coalesce(v_device_sequence_floor, -1) then
        return jsonb_build_object('ok', false, 'code', 'device-sequence-collision');
      end if;
      v_fresh := array_append(v_fresh, v_env);
      v_fresh_sequence_max := greatest(v_fresh_sequence_max, v_seq);
    end if;
  end loop;

  if coalesce(array_length(v_fresh, 1), 0) = 0 then
    select coalesce(max(o.id), coalesce(sync_push.cursor, 0)) into v_acked_max
      from public.sync_ops o
      where o.user_id = auth.uid()
        and o.op_id in (
          select e #>> '{meta,opId}' from jsonb_array_elements(coalesce(ops, '[]'::jsonb)) e
        );
    update public.sync_devices set last_seen_at = now()
      where user_id = auth.uid() and device_id = "deviceId";
    return jsonb_build_object('ok', true, 'cursor', v_acked_max);
  end if;

  if coalesce(sync_push.cursor, 0) <> v_head then
    return jsonb_build_object('ok', false, 'code', 'stale-cursor', 'cursor', v_head);
  end if;

  foreach v_env in array v_fresh loop
    insert into public.sync_ops (
      user_id, op_id, device_id, device_seq, record_key, kind,
      protocol_version, schema_version, envelope
    ) values (
      auth.uid(),
      v_env #>> '{meta,opId}',
      v_env #>> '{meta,deviceId}',
      (v_env #>> '{meta,lamport}')::bigint,
      v_env #>> '{meta,recordKey}',
      v_env #>> '{meta,kind}',
      (v_env #>> '{meta,protocolVersion}')::integer,
      (v_env #>> '{meta,schemaVersion}')::integer,
      v_env
    );
  end loop;

  select coalesce(max(id), 0) into v_head from public.sync_ops where user_id = auth.uid();
  update public.sync_devices
     set last_seen_at = now(),
         last_pushed_sequence = greatest(last_pushed_sequence, v_fresh_sequence_max)
    where user_id = auth.uid() and device_id = "deviceId";
  return jsonb_build_object('ok', true, 'cursor', v_head);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'code', 'invalid-envelope');
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'device-sequence-collision');
end;
$$;

create or replace function public.sync_put_snapshot(snapshot jsonb, cursor bigint default 0, "deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_head bigint;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  select greatest(
      coalesce(max(o.id), 0),
      coalesce((select s.cursor from public.sync_snapshots s where s.user_id = auth.uid()), 0)
    ) into v_head
    from public.sync_ops o
   where o.user_id = auth.uid();
  if snapshot is null
     or (snapshot->>'v') is distinct from '1'
     or (snapshot->>'alg') is distinct from 'A256GCM'
     or (snapshot #>> '{meta,type}') is distinct from 'snapshot'
     or (snapshot #>> '{meta,protocolVersion}') is distinct from '1'
     or snapshot->>'iv' is null or length(snapshot->>'iv') <> 16
     or snapshot->>'ct' is null or length(snapshot->>'ct') < 24 or length(snapshot->>'ct') > 67108864
     or (snapshot #>> '{meta,cursor}') is null
     or (snapshot #>> '{meta,cursor}')::bigint <> coalesce(sync_put_snapshot.cursor, 0)
     or coalesce(sync_put_snapshot.cursor, 0) < 0
     or coalesce(sync_put_snapshot.cursor, 0) > v_head then
    return jsonb_build_object('ok', false, 'code', 'invalid-snapshot-cursor');
  end if;

  insert into public.sync_snapshots as s (user_id, envelope, cursor, updated_at)
  values (auth.uid(), snapshot, coalesce(sync_put_snapshot.cursor, 0), now())
  on conflict (user_id) do update
    set envelope = excluded.envelope, cursor = excluded.cursor, updated_at = now()
    where excluded.cursor >= s.cursor;
  return jsonb_build_object('ok', true);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'code', 'invalid-snapshot');
end;
$$;

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

revoke all on function public.sync_touch_device(text, text, bigint) from public, anon;
revoke all on function public.sync_pull(bigint, text, integer) from public, anon;
revoke all on function public.sync_push(jsonb, bigint, text) from public, anon;
revoke all on function public.sync_put_snapshot(jsonb, bigint, text) from public, anon;
revoke all on function public.sync_prune_ops(text) from public, anon;
grant execute on function public.sync_touch_device(text, text, bigint) to authenticated;
grant execute on function public.sync_pull(bigint, text, integer) to authenticated;
grant execute on function public.sync_push(jsonb, bigint, text) to authenticated;
grant execute on function public.sync_put_snapshot(jsonb, bigint, text) to authenticated;
grant execute on function public.sync_prune_ops(text) to authenticated;

commit;
