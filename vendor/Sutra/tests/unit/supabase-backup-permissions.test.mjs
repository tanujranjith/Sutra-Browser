import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sources = new Map([
  ['fresh backup schema', readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8')],
  ['20260731 reconciliation migration', readFileSync(
    path.join(root, 'supabase', 'migrations', '20260731_backup_index_authenticated_permissions.sql'),
    'utf8'
  )]
]);

for (const [label, source] of sources) {
  test(`${label}: backup_index uses explicit least-privilege table grants`, () => {
    assert.match(source, /revoke all on table public\.backup_index from public, anon, authenticated;/i);
    assert.match(source, /grant select, insert, delete on table public\.backup_index to authenticated;/i);
    assert.doesNotMatch(source, /grant[^;]*update[^;]*backup_index|grant[^;]*backup_index[^;]*update/i);
  });
}

test('fresh backup schema keeps ownership RLS and the Storage bucket private', () => {
  const source = sources.get('fresh backup schema');
  assert.match(source, /values\s*\(\s*'backups'\s*,\s*'backups'\s*,\s*false\s*\)/i);
  assert.match(source, /create policy "backup_index: read own"[\s\S]*using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i);
  assert.match(source, /create policy "backup_index: insert own"[\s\S]*with check\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i);
  assert.match(source, /create policy "backup_index: delete own"[\s\S]*using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i);
});

test('backup permission migration is data-preserving', () => {
  const source = sources.get('20260731 reconciliation migration');
  assert.doesNotMatch(source, /delete\s+from\s+|drop\s+table|truncate\s+/i);
  assert.doesNotMatch(source, /storage\.objects|storage\.buckets/i);
});
