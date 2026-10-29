-- Additive, idempotent device revoke-and-wipe migration.
-- Safe to run on an existing Sutra Sync schema; encrypted vault data is untouched.

alter table public.sync_devices add column if not exists revoked_by uuid references auth.users(id) on delete set null;
alter table public.sync_devices add column if not exists wipe_required boolean not null default false;
alter table public.sync_devices add column if not exists wipe_acknowledged_at timestamptz;

create or replace function public.sync_list_devices("deviceId" text default null)
returns jsonb language plpgsql security definer
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
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_code text;
begin
  v_code := public.sync_authorize_device("deviceId", true);
  if v_code <> 'ok' then return jsonb_build_object('ok', false, 'code', v_code); end if;
  if "targetDeviceId" = "deviceId" then return jsonb_build_object('ok', false, 'code', 'cannot-revoke-current'); end if;
  update public.sync_devices set
      revoked_at = now(), revoked_by = auth.uid(), wipe_required = true, wipe_acknowledged_at = null
   where user_id = auth.uid() and device_id = "targetDeviceId" and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not-found'); end if;
  return jsonb_build_object('ok', true, 'wipeRequired', true);
end;
$$;

create or replace function public.sync_get_device_status("deviceId" text)
returns jsonb language plpgsql security definer
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
      'ok', false, 'code', 'DEVICE_REVOKED', 'contract', 'sutra-device-status-v1',
      'userId', v_uid, 'deviceId', v_device.device_id,
      'wipeRequired', v_device.wipe_required, 'revokedAt', v_device.revoked_at,
      'wipeAcknowledgedAt', v_device.wipe_acknowledged_at
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'contract', 'sutra-device-status-v1', 'userId', v_uid,
    'deviceId', v_device.device_id, 'wipeRequired', false, 'state', 'active'
  );
end;
$$;

create or replace function public.sync_acknowledge_device_wipe("deviceId" text, "at" timestamptz default now())
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := nullif(auth.jwt() ->> 'session_id', '');
  v_ack timestamptz := least(coalesce("at", now()), now());
begin
  if v_uid is null or v_session is null then return jsonb_build_object('ok', false, 'code', 'unauthorized'); end if;
  update public.sync_devices set wipe_acknowledged_at = coalesce(wipe_acknowledged_at, v_ack)
   where user_id = v_uid and device_id = "deviceId" and auth_session_id = v_session
     and revoked_at is not null and wipe_required = true;
  if not found then return jsonb_build_object('ok', false, 'code', 'not-found'); end if;
  return jsonb_build_object('ok', true, 'acknowledgedAt', (
    select d.wipe_acknowledged_at from public.sync_devices d
     where d.user_id = v_uid and d.device_id = "deviceId"
  ));
end;
$$;

revoke all on function public.sync_list_devices(text) from public, anon, authenticated;
revoke all on function public.sync_revoke_device(text, text) from public, anon, authenticated;
revoke all on function public.sync_get_device_status(text) from public, anon, authenticated;
revoke all on function public.sync_acknowledge_device_wipe(text, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_list_devices(text) to authenticated;
grant execute on function public.sync_revoke_device(text, text) to authenticated;
grant execute on function public.sync_get_device_status(text) to authenticated;
grant execute on function public.sync_acknowledge_device_wipe(text, timestamptz) to authenticated;
