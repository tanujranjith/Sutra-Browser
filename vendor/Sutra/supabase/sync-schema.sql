-- ============================================================================
-- Sutra Sync — incremental E2E-encrypted multi-device sync schema
-- ============================================================================
-- Run AFTER supabase/schema.sql. Idempotent: safe to rerun.
--
-- The database stores encrypted envelopes plus bounded routing metadata only.
-- All client access goes through authenticated RPCs. Direct table access is
-- denied even to authenticated users so a revoked device cannot bypass the
-- device/session checks with PostgREST table endpoints.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.sync_ops (
  id               bigserial primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  op_id            text not null,
  device_id        text not null,
  device_seq       bigint,
  record_key       text,
  kind             text,
  protocol_version integer,
  schema_version   integer,
  envelope         jsonb not null,
  created_at       timestamptz not null default now(),
  unique (user_id, op_id)
);
alter table public.sync_ops add column if not exists device_seq bigint;
alter table public.sync_ops add column if not exists record_key text;
alter table public.sync_ops add column if not exists kind text;
alter table public.sync_ops add column if not exists protocol_version integer;
alter table public.sync_ops add column if not exists schema_version integer;
create index if not exists sync_ops_user_seq on public.sync_ops (user_id, id);
create unique index if not exists sync_ops_user_device_seq
  on public.sync_ops (user_id, device_id, device_seq) where device_seq is not null;

create table if not exists public.sync_devices (
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id        text not null,
  auth_session_id  text,
  label            text not null default '',
  last_seen_cursor bigint not null default 0,
  last_pushed_sequence bigint not null default -1,
  last_seen_at     timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id) on delete set null,
  wipe_required    boolean not null default false,
  wipe_acknowledged_at timestamptz,
  primary key (user_id, device_id)
);
alter table public.sync_devices add column if not exists auth_session_id text;
alter table public.sync_devices add column if not exists last_pushed_sequence bigint not null default -1;
alter table public.sync_devices add column if not exists revoked_by uuid references auth.users(id) on delete set null;
alter table public.sync_devices add column if not exists wipe_required boolean not null default false;
alter table public.sync_devices add column if not exists wipe_acknowledged_at timestamptz;
create unique index if not exists sync_devices_user_session
  on public.sync_devices (user_id, auth_session_id) where auth_session_id is not null;

-- Preserve the per-device replay barrier before any covered sync_ops rows are
-- pruned. The operation table alone cannot provide idempotency after deletion.
update public.sync_devices d
   set last_pushed_sequence = greatest(
     d.last_pushed_sequence,
     coalesce((
       select max(o.device_seq)
         from public.sync_ops o
        where o.user_id = d.user_id and o.device_id = d.device_id
     ), -1)
   );

create table if not exists public.sync_vault_keys (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  key_id     text,
  wrapped    jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.sync_vault_keys add column if not exists key_id text;

create table if not exists public.sync_snapshots (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  envelope   jsonb not null,
  cursor     bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_asset_index (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hash       text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, hash)
);

-- ---------------------------------------------------------------------------
-- RLS + direct-access denial
-- ---------------------------------------------------------------------------

alter table public.sync_ops         enable row level security;
alter table public.sync_devices     enable row level security;
alter table public.sync_vault_keys  enable row level security;
alter table public.sync_snapshots   enable row level security;
alter table public.sync_asset_index enable row level security;

drop policy if exists "sync_ops_select_own" on public.sync_ops;
drop policy if exists "sync_ops_insert_own" on public.sync_ops;
drop policy if exists "sync_devices_all_own" on public.sync_devices;
drop policy if exists "sync_vault_keys_all_own" on public.sync_vault_keys;
drop policy if exists "sync_snapshots_all_own" on public.sync_snapshots;
drop policy if exists "sync_asset_index_all_own" on public.sync_asset_index;

drop policy if exists "sync_ops_deny_direct" on public.sync_ops;
create policy "sync_ops_deny_direct" on public.sync_ops
  for all to authenticated using (false) with check (false);
drop policy if exists "sync_devices_deny_direct" on public.sync_devices;
create policy "sync_devices_deny_direct" on public.sync_devices
  for all to authenticated using (false) with check (false);
drop policy if exists "sync_vault_keys_deny_direct" on public.sync_vault_keys;
create policy "sync_vault_keys_deny_direct" on public.sync_vault_keys
  for all to authenticated using (false) with check (false);
drop policy if exists "sync_snapshots_deny_direct" on public.sync_snapshots;
create policy "sync_snapshots_deny_direct" on public.sync_snapshots
  for all to authenticated using (false) with check (false);
drop policy if exists "sync_asset_index_deny_direct" on public.sync_asset_index;
create policy "sync_asset_index_deny_direct" on public.sync_asset_index
  for all to authenticated using (false) with check (false);

revoke all on table public.sync_ops, public.sync_devices, public.sync_vault_keys,
  public.sync_snapshots, public.sync_asset_index from public, anon, authenticated;
revoke all on sequence public.sync_ops_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Device/session authorization
-- ---------------------------------------------------------------------------

create or replace function public.sync_authorize_device(p_device_id text, p_register boolean default true)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := nullif(auth.jwt() ->> 'session_id', '');
  v_device public.sync_devices%rowtype;
begin
  if v_uid is null or v_session is null then return 'unauthorized'; end if;
  if p_device_id is null or length(p_device_id) < 8 or length(p_device_id) > 128 or position(':' in p_device_id) > 0 then
    return 'bad-request';
  end if;

  if exists (
    select 1 from public.sync_devices d
    where d.user_id = v_uid and d.auth_session_id = v_session and d.revoked_at is not null
  ) then
    return 'revoked';
  end if;

  select * into v_device from public.sync_devices d
  where d.user_id = v_uid and d.device_id = p_device_id;

  if found then
    if v_device.revoked_at is not null then return 'revoked'; end if;
    begin
      update public.sync_devices
         set auth_session_id = v_session, last_seen_at = now()
       where user_id = v_uid and device_id = p_device_id;
    exception when unique_violation then
      return 'device-session-mismatch';
    end;
    return 'ok';
  end if;

  if not p_register then return 'not-found'; end if;
  if exists (
    select 1 from public.sync_devices d
    where d.user_id = v_uid and d.auth_session_id = v_session
  ) then
    return 'device-session-mismatch';
  end if;

  insert into public.sync_devices (user_id, device_id, auth_session_id, last_seen_at)
  values (v_uid, p_device_id, v_session, now());
  return 'ok';
end;
$$;

create or replace function public.sync_session_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and nullif(auth.jwt() ->> 'session_id', '') is not null
    and exists (
      select 1 from public.sync_devices d
      where d.user_id = auth.uid()
        and d.auth_session_id = (auth.jwt() ->> 'session_id')
        and d.revoked_at is null
    );
$$;

-- Dedicated private asset bucket. The path is <uid>/<sha256>; filenames never
-- appear. Storage RLS checks both account ownership and the active auth session.
insert into storage.buckets (id, name, public)
values ('sync-assets', 'sync-assets', false)
on conflict (id) do update set public = false;

drop policy if exists "Sutra sync assets: read active own" on storage.objects;
create policy "Sutra sync assets: read active own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sync-assets'
    and name ~ (
      '^'
      || auth.uid()::text
      || '/[0-9a-f]{64}$'
    )
    and public.sync_session_active()
  );
drop policy if exists "Sutra sync assets: insert active own" on storage.objects;
create policy "Sutra sync assets: insert active own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sync-assets'
    and name ~ (
      '^'
      || auth.uid()::text
      || '/[0-9a-f]{64}$'
    )
    and public.sync_session_active()
  );
drop policy if exists "Sutra sync assets: update active own" on storage.objects;
create policy "Sutra sync assets: update active own"
  on storage.objects for update to authenticated
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
drop policy if exists "Sutra sync assets: delete active own" on storage.objects;
create policy "Sutra sync assets: delete active own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sync-assets'
    and name ~ (
      '^'
      || auth.uid()::text
      || '/[0-9a-f]{64}$'
    )
    and public.sync_session_active()
  );

-- ---------------------------------------------------------------------------
-- Core RPCs
-- ---------------------------------------------------------------------------

create or replace function public.sync_ping("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true);
end;
$$;

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

  -- Delivery is not durable incorporation. The client advances
  -- last_seen_cursor through sync_touch_device only after its atomic local
  -- baseline/outbox commit and workspace readback have succeeded.
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

-- ---------------------------------------------------------------------------
-- Vault key, snapshot, assets, devices, deletion
-- ---------------------------------------------------------------------------

drop function if exists public.sync_put_vault_key(jsonb, text);

create or replace function public.sync_get_vault_key("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true, 'wrapped',
    (select wrapped from public.sync_vault_keys where user_id = auth.uid()));
end;
$$;

create or replace function public.sync_put_vault_key(
  wrapped jsonb,
  "expectedWrapped" jsonb default null,
  "deviceId" text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text;
  v_current jsonb;
  v_key_id text := wrapped ->> 'keyId';
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if wrapped is null or (wrapped->>'v') is distinct from '1'
     or v_key_id is null or v_key_id !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad-request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sutra-sync-key:' || auth.uid()::text, 0));
  select k.wrapped into v_current from public.sync_vault_keys k where k.user_id = auth.uid();

  if not found then
    if "expectedWrapped" is not null then return jsonb_build_object('ok', false, 'code', 'key-conflict'); end if;
    insert into public.sync_vault_keys (user_id, key_id, wrapped)
    values (auth.uid(), v_key_id, wrapped);
    return jsonb_build_object('ok', true);
  end if;

  if v_current = wrapped then return jsonb_build_object('ok', true); end if;
  if "expectedWrapped" is null or v_current <> "expectedWrapped"
     or (v_current->>'keyId') <> v_key_id then
    return jsonb_build_object('ok', false, 'code', 'key-conflict');
  end if;

  update public.sync_vault_keys
     set wrapped = sync_put_vault_key.wrapped, key_id = v_key_id, updated_at = now()
   where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sync_get_snapshot("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return coalesce(
    (select jsonb_build_object('ok', true, 'snapshot', envelope, 'cursor', cursor)
       from public.sync_snapshots where user_id = auth.uid()),
    jsonb_build_object('ok', true, 'snapshot', null, 'cursor', 0)
  );
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

-- Retention (2026-08 audit): ops are prunable only when BOTH of the following
-- hold, so no device can ever miss an incremental record it still needs:
--   1. a compaction snapshot exists whose cursor covers them (new devices
--      bootstrap from the snapshot, never from those ops); and
--   2. every ACTIVE (non-revoked) device has acknowledged pulling past them
--      via last_seen_cursor — an offline or stale device pins retention at
--      its own cursor.
-- The floor is therefore least(snapshot_cursor, min_active_device_cursor).
-- Called opportunistically by clients after a compaction cycle; it is safe to
-- call any time and from any number of devices.
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

  -- Serialize with push so pruning cannot make the computed server head
  -- transiently disappear between a push cursor check and its inserts.
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

create or replace function public.sync_has_asset(hash text, "deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true, 'present',
    exists (select 1 from public.sync_asset_index a where a.user_id = auth.uid() and a.hash = sync_has_asset.hash));
end;
$$;

create or replace function public.sync_list_assets("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true, 'hashes', coalesce(
    (select jsonb_agg(a.hash order by a.hash) from public.sync_asset_index a where a.user_id = auth.uid()),
    '[]'::jsonb
  ));
end;
$$;

create or replace function public.sync_list_devices("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  return jsonb_build_object('ok', true, 'devices', coalesce((
    select jsonb_agg(jsonb_build_object(
      'deviceId', d.device_id,
      'label', d.label,
      'lastSeenCursor', d.last_seen_cursor,
      'lastSeenAt', d.last_seen_at,
      'revokedAt', d.revoked_at,
      'wipeRequired', d.wipe_required,
      'wipeAcknowledgedAt', d.wipe_acknowledged_at
    ) order by d.device_id)
    from public.sync_devices d where d.user_id = auth.uid()
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sync_revoke_device("targetDeviceId" text, "deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if "targetDeviceId" = "deviceId" then return jsonb_build_object('ok', false, 'code', 'cannot-revoke-current'); end if;
  update public.sync_devices set
      revoked_at = now(),
      revoked_by = auth.uid(),
      wipe_required = true,
      wipe_acknowledged_at = null
   where user_id = auth.uid() and device_id = "targetDeviceId" and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not-found'); end if;
  return jsonb_build_object('ok', true, 'wipeRequired', true);
end;
$$;

-- Dedicated status channel for a revoked device. Unlike every data-bearing
-- RPC, this deliberately does not call sync_authorize_device: it returns only
-- a bounded status object and requires the exact auth user + JWT session +
-- device tuple that was registered before revocation.
create or replace function public.sync_get_device_status("deviceId" text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := nullif(auth.jwt() ->> 'session_id', '');
  v_device public.sync_devices%rowtype;
begin
  if v_uid is null or v_session is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'contract', 'sutra-device-status-v1');
  end if;
  select * into v_device from public.sync_devices d
   where d.user_id = v_uid and d.device_id = "deviceId" and d.auth_session_id = v_session;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'DEVICE_UNKNOWN', 'contract', 'sutra-device-status-v1');
  end if;
  if v_device.revoked_at is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEVICE_REVOKED',
      'contract', 'sutra-device-status-v1',
      'userId', v_uid,
      'deviceId', v_device.device_id,
      'wipeRequired', v_device.wipe_required,
      'revokedAt', v_device.revoked_at,
      'wipeAcknowledgedAt', v_device.wipe_acknowledged_at
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'contract', 'sutra-device-status-v1',
    'userId', v_uid,
    'deviceId', v_device.device_id,
    'wipeRequired', false,
    'state', 'active'
  );
end;
$$;

create or replace function public.sync_acknowledge_device_wipe("deviceId" text, "at" timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := nullif(auth.jwt() ->> 'session_id', '');
  v_ack timestamptz := least(coalesce("at", now()), now());
begin
  if v_uid is null or v_session is null then return jsonb_build_object('ok', false, 'code', 'unauthorized'); end if;
  update public.sync_devices set wipe_acknowledged_at = coalesce(wipe_acknowledged_at, v_ack)
   where user_id = v_uid
     and device_id = "deviceId"
     and auth_session_id = v_session
     and revoked_at is not null
     and wipe_required = true;
  if not found then return jsonb_build_object('ok', false, 'code', 'not-found'); end if;
  return jsonb_build_object('ok', true, 'acknowledgedAt', (
    select d.wipe_acknowledged_at from public.sync_devices d
     where d.user_id = v_uid and d.device_id = "deviceId"
  ));
end;
$$;

create or replace function public.sync_delete_vault("deviceId" text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", false);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  delete from public.sync_ops         where user_id = auth.uid();
  delete from public.sync_vault_keys  where user_id = auth.uid();
  delete from public.sync_snapshots   where user_id = auth.uid();
  delete from public.sync_asset_index where user_id = auth.uid();
  delete from public.sync_devices     where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.sync_authorize_device(text, boolean) from public, anon, authenticated;
revoke all on function public.sync_session_active() from public, anon;
revoke all on function public.sync_ping(text) from public, anon;
revoke all on function public.sync_touch_device(text, text, bigint) from public, anon;
revoke all on function public.sync_pull(bigint, text, integer) from public, anon;
revoke all on function public.sync_push(jsonb, bigint, text) from public, anon;
revoke all on function public.sync_get_vault_key(text) from public, anon;
revoke all on function public.sync_put_vault_key(jsonb, jsonb, text) from public, anon;
revoke all on function public.sync_get_snapshot(text) from public, anon;
revoke all on function public.sync_put_snapshot(jsonb, bigint, text) from public, anon;
revoke all on function public.sync_put_asset(text, bigint, text) from public, anon;
revoke all on function public.sync_has_asset(text, text) from public, anon;
revoke all on function public.sync_list_assets(text) from public, anon;
revoke all on function public.sync_list_devices(text) from public, anon;
revoke all on function public.sync_revoke_device(text, text) from public, anon;
revoke all on function public.sync_get_device_status(text) from public, anon, authenticated;
revoke all on function public.sync_acknowledge_device_wipe(text, timestamptz) from public, anon, authenticated;
revoke all on function public.sync_delete_vault(text) from public, anon;
revoke all on function public.sync_prune_ops(text) from public, anon;

grant execute on function public.sync_session_active() to authenticated;
grant execute on function public.sync_ping(text) to authenticated;
grant execute on function public.sync_touch_device(text, text, bigint) to authenticated;
grant execute on function public.sync_pull(bigint, text, integer) to authenticated;
grant execute on function public.sync_push(jsonb, bigint, text) to authenticated;
grant execute on function public.sync_get_vault_key(text) to authenticated;
grant execute on function public.sync_put_vault_key(jsonb, jsonb, text) to authenticated;
grant execute on function public.sync_get_snapshot(text) to authenticated;
grant execute on function public.sync_put_snapshot(jsonb, bigint, text) to authenticated;
grant execute on function public.sync_put_asset(text, bigint, text) to authenticated;
grant execute on function public.sync_has_asset(text, text) to authenticated;
grant execute on function public.sync_list_assets(text) to authenticated;
grant execute on function public.sync_list_devices(text) to authenticated;
grant execute on function public.sync_revoke_device(text, text) to authenticated;
grant execute on function public.sync_get_device_status(text) to authenticated;
grant execute on function public.sync_acknowledge_device_wipe(text, timestamptz) to authenticated;
grant execute on function public.sync_delete_vault(text) to authenticated;
grant execute on function public.sync_prune_ops(text) to authenticated;

-- rls_auto_enable() is a database/event-trigger helper, never a browser RPC.
-- Supabase projects may provide it outside this schema, so harden its ACL only
-- when present. Revoking EXECUTE does not remove or disable its event trigger.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated;';
    execute 'grant execute on function public.rls_auto_enable() to postgres;';
  end if;
end;
$$;
