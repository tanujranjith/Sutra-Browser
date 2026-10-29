#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const migrationDir = join(root, 'supabase', 'migrations');
const migrationNames = readdirSync(migrationDir)
  .filter(name => name.endsWith('.sql'))
  .sort();
const expectedChain = [
  '20260716_device_revoke_wipe.sql',
  '20260718_sync_account_isolation.sql',
  '20260730_sync_storage_path_and_function_permissions.sql',
  '20260731_backup_index_authenticated_permissions.sql'
];
const failures = [];
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

for (const name of expectedChain) {
  if (!migrationNames.includes(name)) failures.push(`missing Supabase migration: ${name}`);
}
const chainPositions = expectedChain.map(name => migrationNames.indexOf(name));
if (!chainPositions.every((position, index) => position >= 0 && (index === 0 || position > chainPositions[index - 1]))) {
  failures.push(`Supabase migration order is incorrect: ${migrationNames.join(', ')}`);
}

const fresh = readFileSync(join(root, 'supabase', 'sync-schema.sql'), 'utf8');
const hardening = readFileSync(join(migrationDir, '20260730_sync_storage_path_and_function_permissions.sql'), 'utf8');
const backupSchema = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8');
const backupPermissions = readFileSync(join(migrationDir, '20260731_backup_index_authenticated_permissions.sql'), 'utf8');
const exactPath = /name\s*~\s*\(\s*'\^'\s*\|\|\s*auth\.uid\(\)::text\s*\|\|\s*'\/\[0-9a-f\]\{64\}\$'\s*\)/gi;
const policyNames = [
  'Sutra sync assets: read active own',
  'Sutra sync assets: insert active own',
  'Sutra sync assets: update active own',
  'Sutra sync assets: delete active own'
];

for (const [label, source] of [['fresh schema', fresh], ['20260730 migration', hardening]]) {
  for (const policyName of policyNames) {
    requireMatch(source, new RegExp(`create policy "${policyName}"`, 'i'), `${label} is missing ${policyName}`);
  }
  if ((source.match(exactPath) || []).length < 5) {
    failures.push(`${label} does not enforce the exact anchored path in every USING/WITH CHECK clause`);
  }
  if ((source.match(/public\.sync_session_active\(\)/gi) || []).length < 5) {
    failures.push(`${label} does not retain the active-session predicate in every policy clause`);
  }
  requireMatch(source, /to_regprocedure\('public\.rls_auto_enable\(\)'\)\s+is not null/i,
    `${label} does not safely guard the optional rls_auto_enable helper`);
  requireMatch(source, /revoke execute on function public\.rls_auto_enable\(\)\s+from public, anon, authenticated;/i,
    `${label} does not revoke rls_auto_enable from browser roles`);
  requireMatch(source, /grant execute on function public\.rls_auto_enable\(\)\s+to postgres;/i,
    `${label} does not preserve postgres execution`);
}

if (/delete\s+from\s+|drop\s+table|truncate\s+|drop\s+bucket/i.test(hardening)) {
  failures.push('20260730 migration contains a destructive data/schema operation');
}
if (/(?:revoke|grant)[^;]*function public\.sync_/i.test(hardening)) {
  failures.push('20260730 migration changes a Sutra Sync RPC permission');
}
if (/Sutra backups:|backup_index/i.test(hardening)) {
  failures.push('20260730 migration changes the backup schema or policies');
}

for (const [label, source] of [['fresh backup schema', backupSchema], ['20260731 migration', backupPermissions]]) {
  requireMatch(source,
    /revoke all on table public\.backup_index from public, anon, authenticated;/i,
    `${label} does not deny backup_index table access before applying least privilege`);
  requireMatch(source,
    /grant select, insert, delete on table public\.backup_index to authenticated;/i,
    `${label} does not grant the authenticated backup adapter its required operations`);
  if (/grant[^;]*update[^;]*backup_index|grant[^;]*backup_index[^;]*update/i.test(source)) {
    failures.push(`${label} grants unnecessary backup_index UPDATE access`);
  }
}

if (/delete\s+from\s+|drop\s+table|truncate\s+/i.test(backupPermissions)) {
  failures.push('20260731 migration contains a destructive data/schema operation');
}

if (failures.length) {
  console.error('Supabase schema check FAILED:');
  failures.forEach(failure => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`Supabase schema check passed — ${expectedChain.length} ordered migrations and final Storage/function ACL contracts verified.`);
