import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sql = readFileSync(path.join(root, 'supabase', 'sync-schema.sql'), 'utf8');
const accountIsolationMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260718_sync_account_isolation.sql'),
  'utf8'
);
const productionHardeningMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260730_sync_storage_path_and_function_permissions.sql'),
  'utf8'
);
const revokeWipeMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260716_device_revoke_wipe.sql'),
  'utf8'
);
const pruningMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260825_sync_pruning_durable_ack.sql'),
  'utf8'
);
const assetRpcMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830_sync_put_asset_ambiguity.sql'),
  'utf8'
);
const pruneFloorMigration = readFileSync(
  path.join(root, 'supabase', 'migrations', '20260830_sync_z_prune_floor_reference.sql'),
  'utf8'
);

const tables = ['sync_ops', 'sync_devices', 'sync_vault_keys', 'sync_snapshots', 'sync_asset_index'];
const exposedFunctions = [
  'sync_ping', 'sync_touch_device', 'sync_pull', 'sync_push',
  'sync_get_vault_key', 'sync_put_vault_key', 'sync_get_snapshot',
  'sync_put_snapshot', 'sync_put_asset', 'sync_has_asset',
  'sync_list_assets', 'sync_list_devices', 'sync_revoke_device',
  'sync_get_device_status', 'sync_acknowledge_device_wipe',
  'sync_prune_ops', 'sync_delete_vault'
];

function applySyncAssetPolicyDdl(initial, source) {
  const policies = new Set(initial);
  const statements = source.matchAll(
    /(drop policy if exists|create policy)\s+"(Sutra sync assets: [^"]+)"\s+on storage\.objects/gi
  );
  for (const [, verb, name] of statements) {
    if (/^drop/i.test(verb)) policies.delete(name);
    else policies.add(name);
  }
  return policies;
}

test('every sync table enables RLS, denies direct access, and revokes table grants', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'));
    assert.match(sql, new RegExp(`create policy "${table}_deny_direct"`, 'i'));
  }
  assert.match(sql, /revoke all on table public\.sync_ops,[\s\S]*from public, anon, authenticated;/i);
});

test('all browser RPCs are authenticated-only security-definer functions with a fixed path', () => {
  for (const name of exposedFunctions) {
    const start = sql.indexOf(`function public.${name}`);
    assert.ok(start >= 0, `missing ${name}`);
    const body = sql.slice(start, sql.indexOf('$$;', start) + 3);
    assert.match(body, /security definer/i, `${name} must not depend on direct table grants`);
    assert.match(body, /set search_path = pg_catalog, public/i, `${name} needs a fixed safe search_path`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon(?:, authenticated)?;`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+to authenticated;`, 'i'));
    const signature = sql.slice(start, sql.indexOf('returns ', start));
    assert.doesNotMatch(signature, /\b(user_id|userId|owner(?:Id)?)\b/i,
      `${name} must not accept caller-supplied ownership`);
    assert.match(body, /auth\.uid\(\)|sync_authorize_device\(/i,
      `${name} must derive authority from the authenticated server identity`);
  }
});

test('device revocation binds the JWT session and protects the dedicated asset bucket', () => {
  assert.match(sql, /auth_session_id\s+text/i);
  assert.match(sql, /auth\.jwt\(\) ->> 'session_id'/i);
  assert.match(sql, /sync_session_active\(\)/i);
  assert.match(sql, /values \('sync-assets', 'sync-assets', false\)/i);
  assert.match(sql, /bucket_id = 'sync-assets'[\s\S]*public\.sync_session_active\(\)/i);
  assert.match(sql, /wipe_required\s+boolean\s+not null default false/i);
  assert.match(sql, /wipe_acknowledged_at\s+timestamptz/i);
  assert.match(sql, /'code', 'DEVICE_REVOKED'[\s\S]*'contract', 'sutra-device-status-v1'/i);
  assert.match(sql, /auth_session_id = v_session[\s\S]*revoked_at is not null[\s\S]*wipe_required = true/i);
});

test('sync asset Storage policies enforce an exact authenticated opaque path and the additive migration preserves that hardening', () => {
  const exactPath = /name\s*~\s*\(\s*'\^'\s*\|\|\s*auth\.uid\(\)::text\s*\|\|\s*'\/\[0-9a-f\]\{64\}\$'\s*\)/i;
  for (const policy of [
    'read active own', 'insert active own', 'update active own', 'delete active own'
  ]) {
    const policyBlock = new RegExp(`create policy "Sutra sync assets: ${policy}"[\\s\\S]*?(?=drop policy|-- -|$)`, 'i');
    const canonical = sql.match(policyBlock)?.[0] || '';
    const migration = productionHardeningMigration.match(policyBlock)?.[0] || '';
    assert.match(canonical, /bucket_id = 'sync-assets'/i);
    assert.match(canonical, exactPath, `canonical policy ${policy} must scope exact account/hash paths`);
    assert.match(canonical, /public\.sync_session_active\(\)/i);
    assert.match(migration, /bucket_id = 'sync-assets'/i);
    assert.match(migration, exactPath, `production reconciliation must recreate hardened ${policy} policy`);
    assert.match(migration, /public\.sync_session_active\(\)/i);
  }
  assert.match(productionHardeningMigration, /drop policy if exists "Sutra sync assets: read active own"/i);
  assert.doesNotMatch(productionHardeningMigration, /delete\s+from\s+|drop\s+table|truncate\s+|drop\s+bucket/i,
    'the hardening migration must not destroy encrypted sync data');
});

test('rls_auto_enable is database-only while required authenticated sync RPC grants remain unchanged', () => {
  for (const source of [sql, productionHardeningMigration]) {
    assert.match(source, /to_regprocedure\('public\.rls_auto_enable\(\)'\)\s+is not null/i);
    assert.match(source, /revoke execute on function public\.rls_auto_enable\(\)\s+from public, anon, authenticated;/i);
    assert.match(source, /grant execute on function public\.rls_auto_enable\(\)\s+to postgres;/i);
    assert.doesNotMatch(source, /grant execute on function public\.rls_auto_enable\(\)\s+to (?:public|anon|authenticated)/i);
    assert.doesNotMatch(source, /drop\s+(?:event\s+trigger|function)\s+.*rls_auto_enable/i,
      'ACL hardening must leave the event-trigger function installed');
  }
  assert.match(sql, /revoke all on function public\.sync_authorize_device\(text, boolean\) from public, anon, authenticated;/i);
  assert.doesNotMatch(sql, /grant execute on function public\.sync_authorize_device/i);
  for (const name of exposedFunctions) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+to authenticated;`, 'i'));
  }
  assert.doesNotMatch(productionHardeningMigration, /(?:revoke|grant)[^;]*function public\.sync_/i,
    'the production reconciliation must not change Sutra Sync RPC ACLs');
});

test('sensitive sync rows are written only from auth.uid and browser payloads contain no owner argument', () => {
  assert.match(sql, /insert into public\.sync_ops[\s\S]*?values \([\s\S]*?auth\.uid\(\)/i);
  assert.match(sql, /insert into public\.sync_vault_keys[\s\S]*?values \(auth\.uid\(\)/i);
  assert.match(sql, /insert into public\.sync_snapshots[\s\S]*?values \(auth\.uid\(\)/i);
  assert.match(sql, /insert into public\.sync_asset_index[\s\S]*?values \(auth\.uid\(\)/i);
  assert.match(sql, /update public\.sync_devices[\s\S]*?where user_id = auth\.uid\(\)/i);
  assert.match(sql, /where user_id = v_uid[\s\S]*?device_id = "deviceId"[\s\S]*?auth_session_id = v_session/i);
});

test('operation and vault-key contracts enforce idempotency and split-brain safety', () => {
  assert.match(sql, /sync_ops_user_device_seq/i);
  assert.match(sql, /last_pushed_sequence\s+bigint\s+not null default -1/i);
  assert.match(sql, /v_seq <= coalesce\(v_device_sequence_floor, -1\)/i);
  assert.match(sql, /op-id-collision/i);
  assert.match(sql, /device-sequence-collision/i);
  assert.match(sql, /expectedWrapped/i);
  assert.match(sql, /key-conflict/i);
  assert.match(sql, /v_current->>'keyId'[^\n]+v_key_id/i);
});

test('schema is ordered after backup setup and exposes no elevated browser credential', () => {
  assert.match(sql, /Run AFTER supabase\/schema\.sql/i);
  assert.doesNotMatch(sql, /service_role|sb_secret_/i);
});

test('additive migration chain is ordered, non-destructive, and folded into the fresh schema', () => {
  assert.ok('20260716_device_revoke_wipe.sql' < '20260718_sync_account_isolation.sql');
  assert.ok('20260718_sync_account_isolation.sql' < '20260730_sync_storage_path_and_function_permissions.sql');
  assert.ok('20260730_sync_storage_path_and_function_permissions.sql' < '20260825_sync_pruning_durable_ack.sql');
  assert.ok('20260825_sync_pruning_durable_ack.sql' < '20260830_sync_put_asset_ambiguity.sql');
  assert.ok('20260830_sync_put_asset_ambiguity.sql' < '20260830_sync_z_prune_floor_reference.sql');
  for (const [name, migration] of [
    ['device revoke/wipe', revokeWipeMigration],
    ['account isolation', accountIsolationMigration],
    ['production hardening reconciliation', productionHardeningMigration],
    ['asset RPC ambiguity reconciliation', assetRpcMigration]
  ]) {
    assert.doesNotMatch(migration, /delete\s+from\s+public\.sync_|drop\s+table|truncate\s+/i,
      `${name} migration must preserve encrypted sync state`);
  }
  for (const pattern of [
    /wipe_required\s+boolean\s+not null default false/i,
    /wipe_acknowledged_at\s+timestamptz/i,
    /function public\.sync_get_device_status/i,
    /function public\.sync_acknowledge_device_wipe/i
  ]) {
    assert.match(revokeWipeMigration, pattern);
    assert.match(sql, pattern, 'fresh sync schema must include the additive revoke/wipe contract');
  }
  assert.match(accountIsolationMigration, /array_length\(storage\.foldername\(name\), 1\) = 2/i);
  assert.match(productionHardeningMigration, /name\s*~\s*\(/i);
  assert.match(sql, /name\s*~\s*\(/i,
    'fresh sync schema must include the final production exact-path policy');
  assert.match(productionHardeningMigration, /^\s*--[\s\S]*\bbegin;\s/i);
  assert.match(productionHardeningMigration, /\bcommit;\s*$/i);

  const expectedPolicies = new Set([
    'Sutra sync assets: read active own',
    'Sutra sync assets: insert active own',
    'Sutra sync assets: update active own',
    'Sutra sync assets: delete active own'
  ]);
  const freshPolicies = applySyncAssetPolicyDdl(new Set(), sql);
  assert.deepEqual(freshPolicies, expectedPolicies, 'fresh installation must end with exactly four policies');
  const upgradedOnce = applySyncAssetPolicyDdl(
    applySyncAssetPolicyDdl(new Set(), accountIsolationMigration),
    productionHardeningMigration
  );
  assert.deepEqual(upgradedOnce, expectedPolicies, 'older installation must upgrade to exactly four policies');
  const upgradedTwice = applySyncAssetPolicyDdl(upgradedOnce, productionHardeningMigration);
  assert.deepEqual(upgradedTwice, expectedPolicies, 're-running the final migration must not duplicate policies');
});

test('op-log retention prunes only below the snapshot-and-devices floor', () => {
  assert.match(sql, /create or replace function public\.sync_prune_ops\(/);
  // Retention is pinned by the SLOWEST active device, never the snapshot alone.
  assert.match(sql, /least\(v_snapshot_cursor, coalesce\(v_min_device_cursor, 0\)\)/);
  assert.match(sql, /revoked_at is null[\s\S]*?min\(last_seen_cursor\)/);
  assert.match(sql, /sync_pull[\s\S]*?set last_seen_at = now\(\)[\s\S]*?sync_push/,
    'pull delivery must not advance the durable device cursor');
  assert.doesNotMatch(
    sql.match(/create or replace function public\.sync_pull\([\s\S]*?\n\$\$;/)?.[0] || '',
    /set last_seen_cursor/,
    'pull must leave last_seen_cursor for the post-commit acknowledgement RPC'
  );
  assert.match(sql, /sync_touch_device\.cursor < 0 or sync_touch_device\.cursor > v_head/,
    'cursor acknowledgements cannot claim an unseen server position');
  assert.ok((sql.match(/hashtextextended\('sutra-sync-push:' \|\| auth\.uid\(\)::text, 0\)/g) || []).length >= 2,
    'push and prune must share the account-scoped transaction lock');
  assert.match(sql, /sync_push[\s\S]*?greatest\([\s\S]*?sync_snapshots/,
    'the snapshot cursor preserves the logical head after covered ops are deleted');
  // Authenticated-only grant, like every other data-bearing RPC.
  assert.match(sql, /revoke all on function public\.sync_prune_ops\(text\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.sync_prune_ops\(text\) to authenticated;/);
  assert.match(pruningMigration, /^\s*--[\s\S]*\bbegin;\s/i);
  assert.match(pruningMigration, /create or replace function public\.sync_touch_device\(/);
  assert.match(pruningMigration, /create or replace function public\.sync_pull\(/);
  assert.match(pruningMigration, /create or replace function public\.sync_push\(/);
  assert.match(pruningMigration, /create or replace function public\.sync_prune_ops\(/);
  assert.match(pruningMigration, /add column if not exists last_pushed_sequence bigint not null default -1/);
  assert.match(pruningMigration, /select max\(o\.device_seq\)[\s\S]*?where o\.user_id = d\.user_id and o\.device_id = d\.device_id/,
    'the migration must preserve the replay high-water before pruning can delete operation rows');
  assert.match(pruningMigration, /v_seq <= coalesce\(v_device_sequence_floor, -1\)/,
    'a pruned operation sequence must never be accepted as fresh');
  assert.match(pruningMigration, /sync_touch_device\.cursor < 0 or sync_touch_device\.cursor > v_head/);
  assert.ok((pruningMigration.match(/hashtextextended\('sutra-sync-push:' \|\| auth\.uid\(\)::text, 0\)/g) || []).length >= 2);
  assert.match(pruningMigration, /\bcommit;\s*$/i);
});

test('positive pruning floors use a local scalar instead of a missing table qualifier', () => {
  for (const source of [sql, pruningMigration, pruneFloorMigration]) {
    const start = source.indexOf('function public.sync_prune_ops');
    assert.ok(start >= 0, 'missing sync_prune_ops');
    const body = source.slice(start, source.indexOf('$$;', start) + 3);
    assert.match(body, /v_prune_floor\s+bigint/i);
    assert.match(body, /and id <= v_prune_floor/i);
    assert.doesNotMatch(body, /sync_prune_ops\.v_floor/i);
  }
  assert.match(pruneFloorMigration, /^\s*--[\s\S]*\bbegin;\s/i);
  assert.match(pruneFloorMigration, /grant execute on function public\.sync_prune_ops\(text\) to authenticated;/i);
  assert.equal((pruneFloorMigration.match(/delete\s+from\s+public\.sync_ops/gi) || []).length, 1,
    'the replacement function retains exactly one account-scoped pruning statement');
  assert.doesNotMatch(pruneFloorMigration, /drop\s+table|truncate\s+|delete\s+from\s+public\.(?!sync_ops)/i,
    'applying the reconciliation must not add destructive migration statements');
  assert.match(pruneFloorMigration, /\bcommit;\s*$/i);
});

test('sync_put_asset upserts through its named key without PL/pgSQL hash ambiguity', () => {
  for (const source of [sql, assetRpcMigration]) {
    const start = source.indexOf('function public.sync_put_asset');
    assert.ok(start >= 0, 'missing sync_put_asset');
    const body = source.slice(start, source.indexOf('$$;', start) + 3);
    assert.match(body, /on conflict on constraint sync_asset_index_pkey/i);
    assert.doesNotMatch(body, /on conflict\s*\(\s*user_id\s*,\s*hash\s*\)/i);
    assert.match(source, /grant execute on function public\.sync_put_asset\(text, bigint, text\) to authenticated;/i);
  }
  assert.match(assetRpcMigration, /^\s*--[\s\S]*\bbegin;\s/i);
  assert.match(assetRpcMigration, /\bcommit;\s*$/i);
});
