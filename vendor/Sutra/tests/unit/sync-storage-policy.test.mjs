import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sources = new Map([
  ['fresh sync schema', readFileSync(path.join(root, 'supabase', 'sync-schema.sql'), 'utf8')],
  ['20260730 reconciliation migration', readFileSync(
    path.join(root, 'supabase', 'migrations', '20260730_sync_storage_path_and_function_permissions.sql'),
    'utf8'
  )]
]);

const policyNames = new Map([
  ['select', 'Sutra sync assets: read active own'],
  ['insert', 'Sutra sync assets: insert active own'],
  ['update', 'Sutra sync assets: update active own'],
  ['delete', 'Sutra sync assets: delete active own']
]);

function extractParenthesized(block, marker, offset = 0) {
  const markerAt = block.toLowerCase().indexOf(marker.toLowerCase(), offset);
  assert.notEqual(markerAt, -1, `missing ${marker}`);
  const openAt = block.indexOf('(', markerAt + marker.length);
  assert.notEqual(openAt, -1, `missing opening parenthesis after ${marker}`);
  let depth = 0;
  let quoted = false;
  for (let i = openAt; i < block.length; i += 1) {
    const char = block[i];
    if (char === "'" && block[i - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { body: block.slice(openAt + 1, i), end: i + 1 };
    }
  }
  assert.fail(`unterminated ${marker} clause`);
}

function parsePolicies(sql) {
  const starts = [...sql.matchAll(/create policy "([^"]+)"\s+on storage\.objects\s+for\s+(select|insert|update|delete)\s+to\s+authenticated/gi)];
  const parsed = new Map();
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index];
    if (!match[1].startsWith('Sutra sync assets:')) continue;
    const end = starts[index + 1]?.index ?? sql.length;
    const block = sql.slice(match.index, end);
    const operation = match[2].toLowerCase();
    const using = operation === 'insert' ? null : extractParenthesized(block, 'using').body;
    const checkStart = using ? block.toLowerCase().indexOf('with check') : 0;
    const check = ['insert', 'update'].includes(operation)
      ? extractParenthesized(block, 'with check', Math.max(0, checkStart)).body
      : null;
    parsed.set(operation, { name: match[1], operation, role: 'authenticated', using, check });
  }
  return parsed;
}

function compilePredicate(sqlPredicate) {
  assert.match(sqlPredicate, /bucket_id\s*=\s*'sync-assets'/i);
  assert.match(sqlPredicate, /public\.sync_session_active\(\)/i);
  const pathMatch = sqlPredicate.match(
    /name\s*~\s*\(\s*'\^'\s*\|\|\s*auth\.uid\(\)::text\s*\|\|\s*'([^']+)'\s*\)/i
  );
  assert.ok(pathMatch, 'policy must build one anchored regex from auth.uid() and a fixed suffix');
  assert.equal(pathMatch[1], '/[0-9a-f]{64}$');
  return (row, context) => {
    const uid = String(context.uid || '');
    const sessionId = String(context.sessionId || '');
    const activeSession = uid !== '' && sessionId !== '' && context.devices.some(device =>
      device.userId === uid
      && device.sessionId === sessionId
      && device.revokedAt == null
    );
    const uidPattern = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return row.bucketId === 'sync-assets'
      && new RegExp(`^${uidPattern}/[0-9a-f]{64}$`).test(row.name)
      && activeSession;
  };
}

function compilePolicy(policy) {
  const using = policy.using ? compilePredicate(policy.using) : null;
  const check = policy.check ? compilePredicate(policy.check) : null;
  return ({ oldRow, newRow, context }) => {
    if (policy.role !== 'authenticated' || context.role !== 'authenticated' || !context.uid) return false;
    if (policy.operation === 'select' || policy.operation === 'delete') return using(oldRow, context);
    if (policy.operation === 'insert') return check(newRow, context);
    return using(oldRow, context) && check(newRow, context);
  };
}

function evaluate(policy, row, context, newRow = row) {
  return compilePolicy(policy)({ oldRow: row, newRow, context });
}

const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';
const lowerHash = 'a'.repeat(64);
const validName = `${accountA}/${lowerHash}`;
const activeA = {
  role: 'authenticated',
  uid: accountA,
  sessionId: 'session-a',
  devices: [{ userId: accountA, sessionId: 'session-a', revokedAt: null }]
};

const rejectedPaths = new Map([
  ['another user UUID', `${accountB}/${lowerHash}`],
  ['missing user prefix', lowerHash],
  ['empty hash', `${accountA}/`],
  ['63-character hash', `${accountA}/${'a'.repeat(63)}`],
  ['65-character hash', `${accountA}/${'a'.repeat(65)}`],
  ['uppercase hexadecimal', `${accountA}/${'A'.repeat(64)}`],
  ['mixed-case hexadecimal', `${accountA}/${'a'.repeat(63)}A`],
  ['non-hexadecimal characters', `${accountA}/${'g'.repeat(64)}`],
  ['filename extension', `${validName}.txt`],
  ['.sutra suffix', `${validName}.sutra`],
  ['extra directory segment', `${accountA}/extra/${lowerHash}`],
  ['trailing slash', `${validName}/`],
  ['leading slash', `/${validName}`],
  ['query-like object text', `${validName}?download=1`],
  ['encoded traversal-like object text', `${accountA}/%2e%2e%2f${lowerHash}`],
  ['whitespace', `${accountA}/ ${lowerHash}`]
]);

for (const [sourceName, source] of sources) {
  test(`${sourceName}: parsed SELECT/INSERT/UPDATE/DELETE policies accept only the exact active-session path`, () => {
    const policies = parsePolicies(source);
    assert.deepEqual([...policies.keys()].sort(), ['delete', 'insert', 'select', 'update']);
    for (const [operation, expectedName] of policyNames) {
      const policy = policies.get(operation);
      assert.equal(policy.name, expectedName);
      assert.equal(evaluate(policy, { bucketId: 'sync-assets', name: validName }, activeA), true,
        `${operation} should accept the canonical path`);
      for (const [label, objectName] of rejectedPaths) {
        assert.equal(evaluate(policy, { bucketId: 'sync-assets', name: objectName }, activeA), false,
          `${operation} accepted ${label}`);
      }
      assert.equal(evaluate(policy, { bucketId: 'backups', name: validName }, activeA), false,
        `${operation} accepted another bucket`);
    }
  });

  test(`${sourceName}: policy execution rejects anonymous, inactive, unregistered, and revoked sessions`, () => {
    const policies = parsePolicies(source);
    const contexts = new Map([
      ['anonymous request', { role: 'anon', uid: '', sessionId: '', devices: [] }],
      ['inactive session', { role: 'authenticated', uid: accountA, sessionId: '', devices: [] }],
      ['unregistered session', { role: 'authenticated', uid: accountA, sessionId: 'missing', devices: [] }],
      ['revoked session', {
        role: 'authenticated',
        uid: accountA,
        sessionId: 'session-a',
        devices: [{ userId: accountA, sessionId: 'session-a', revokedAt: '2026-07-30T00:00:00Z' }]
      }]
    ]);
    for (const [operation, policy] of policies) {
      for (const [label, context] of contexts) {
        assert.equal(evaluate(policy, { bucketId: 'sync-assets', name: validName }, context), false,
          `${operation} accepted ${label}`);
      }
    }
  });

  test(`${sourceName}: UPDATE checks both the existing row and replacement row`, () => {
    const update = parsePolicies(source).get('update');
    const ownRow = { bucketId: 'sync-assets', name: validName };
    assert.equal(evaluate(update, ownRow, activeA, {
      bucketId: 'sync-assets',
      name: `${accountB}/${lowerHash}`
    }), false, 'cross-account replacement path must fail WITH CHECK');
    assert.equal(evaluate(update, {
      bucketId: 'sync-assets',
      name: `${accountB}/${lowerHash}`
    }, activeA, ownRow), false, 'cross-account existing row must fail USING');
  });
}
