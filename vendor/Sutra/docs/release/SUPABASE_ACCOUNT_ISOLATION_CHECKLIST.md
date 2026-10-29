# Sutra Sync — manual Account A/B isolation checklist

For a fresh empty project, apply in order:

1. [`supabase/schema.sql`](../../supabase/schema.sql);
2. [`supabase/sync-schema.sql`](../../supabase/sync-schema.sql);

The current `sync-schema.sql` already contains revoke/wipe and exact asset-path
definitions. For an existing project created from an older sync schema, apply
(or safely re-run) these additive migrations in order:

3. [`supabase/migrations/20260716_device_revoke_wipe.sql`](../../supabase/migrations/20260716_device_revoke_wipe.sql);
4. [`supabase/migrations/20260718_sync_account_isolation.sql`](../../supabase/migrations/20260718_sync_account_isolation.sql);
5. [`supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql`](../../supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql).

The July 30 migration reproduces the policy/ACL state applied manually to the
production project: four anchored exact-path policies plus no browser-role
`EXECUTE` on `public.rls_auto_enable()`. It does not change the authenticated
Sutra Sync RPC grants.

This is intentionally an operator-run checklist. Use two disposable accounts
and synthetic markers only. Keep OTPs, browser bearer tokens, passphrases, and
recovery material in the browser or Supabase Dashboard; do not paste them into
source code, test output, issue trackers, or chat.

## Evidence to retain

For every denial, retain the request method/path, HTTP status or structured RPC
code, authenticated account label (A or B), and a redacted screenshot or HAR
that contains no token, passphrase, ciphertext body, or workspace content.
Any successful read/write of Account A data while authenticated as Account B is
a release-blocking security failure.

## 1. Establish isolated synthetic state

1. In an Account A browser profile, enable sync and create one synthetic note,
   task, Assistant message, and encrypted attachment. Use one unique marker
   such as `ACCOUNT-A-ISOLATION-<date>` in the note only.
2. Wait for **Synced**, then record Account A's visible device ID, one opaque
   asset hash/path, and the browser request names used for sync. Do not record
   plaintext content in evidence.
3. In a clean Account B profile, sign in independently and register a B device.
   Do not unlock, import, or intentionally merge Account A's vault.

Expected: A and B have distinct device rows and no shared workspace. A marker
or A device appearing in B is a failure.

## 2. Direct REST table isolation

Using each account's own authenticated browser session, replay or issue direct
PostgREST requests to `sync_ops`, `sync_devices`, `sync_vault_keys`,
`sync_snapshots`, and `sync_asset_index`.

- As anonymous: list/read/insert attempts must be denied.
- As Account B: reads of each table must return no Account A row; inserts,
  updates, and deletes carrying Account A's `user_id`, device ID, operation ID,
  snapshot, key, or asset hash must be denied.
- As Account A: direct table access is intentionally denied too; normal access
  must be through the `sync_*` RPCs.

Capture status/code only. A response that exposes any Account A row, accepts an
Account A-owned write from B, or allows direct table mutation is a failure.

## 3. RPC ownership and device controls

Use Account B's authenticated session to invoke the normal `sync_*` endpoints
with B's caller `deviceId` and forged Account A identifiers where the endpoint
accepts them.

- `sync_list_devices` must list B's devices only.
- `sync_revoke_device` targeting A's device must return `not-found`/denied and
  must not change A's row.
- `sync_acknowledge_device_wipe` targeting A's device must return
  `not-found`/denied and must not acknowledge A's wipe.
- `sync_pull`, `sync_push`, `sync_get_vault_key`, `sync_put_vault_key`,
  `sync_get_snapshot`, `sync_put_snapshot`, `sync_put_asset`,
  `sync_has_asset`, and `sync_list_assets` must operate only inside B's
  `auth.uid()` namespace. A caller-supplied `userId`/`user_id` must not change
  the result.
- A B operation with an A device ID must be rejected as an invalid/mismatched
  device, not appended to A's log.

After each request, check from Account A that its device status, vault key,
snapshot cursor, operations, and assets are unchanged. Any changed A state is
a failure.

## 4. Storage isolation and path validation

With Account B's session, try the private `sync-assets` bucket against:

- Account A's exact opaque path: `<A-user-id>/<64-char-hash>`;
- Account A's prefix with a guessed hash;
- B's prefix with an extra component, e.g. `<B-user-id>/<hash>/extra`;
- B's prefix with a non-hash filename, e.g. `<B-user-id>/report.pdf`;
- 63- and 65-character hashes, uppercase/mixed-case/non-hex hashes;
- leading/trailing slashes, filename extensions, query-like text, whitespace,
  and percent-encoded traversal-like text.

Test list, download, upload/overwrite, and delete as applicable. Expected:
Account B cannot observe or alter any A object, and malformed/nested paths are
denied even under B's own prefix. The only permitted asset form is B's exact
`<B-user-id>/<lowercase-64-char-sha256>` object while its device/session is
active. Any accepted crafted path or cross-account object access is a failure.

Then revoke a B device from B's controller device and repeat one Storage read
and one upload from the revoked browser. Both must be denied; record the
status without copying content.

## 5. Payload and metadata inspection

In Account A's Network panel and (where authorized) the project Dashboard,
inspect the synthetic marker's operation, snapshot, and attachment transfer.

Expected remote plaintext is limited to account/device/operation identifiers,
protocol/schema versions, cursors, timestamps, sizes, IVs/tags/ciphertext, and
the passphrase-wrapped vault-key envelope. Verify that none of the following
appears in an operation envelope, snapshot envelope, Storage object path, or
object metadata:

- the synthetic note/task/Assistant marker or title;
- Assistant text, Canvas/course content, or attachment bytes;
- attachment filename;
- passphrase, recovery material, unwrapped vault key, derived key, OAuth token,
  access token, or refresh token.

Any marker or secret visible remotely is a failure. Do not export/download a
full ciphertext payload merely to prove this check.

## 6. Wrapped-key and anonymous behavior

1. From Account B, confirm `sync_get_vault_key` returns B's wrapped blob only
   (or no blob) and cannot replace A's blob through `sync_put_vault_key`.
2. Repeat protected RPC and Storage requests without an authenticated session.
   Expected: unauthenticated requests are denied and cannot register a device.
3. Confirm an expired/malformed session receives denial only. It must not
   produce a workspace wipe; wipe remains reserved for the exact authenticated
   `sutra-device-status-v1` `DEVICE_REVOKED` response.

## 7. Same-profile account switching

In a disposable profile that previously used Account A sync, sign out and then
sign in as Account B. Expected: Sutra preserves the local-first workspace on
disk but enters **Account change needs a separate profile** for cloud sync;
it must not pull/push/merge A's queue, device identity, wrapped key, baseline,
or refresh state using B's session. Use a separate browser profile for B rather
than treating the preserved local workspace as B's cloud workspace.

Capture the Sync status and confirm no cloud request was sent while the guard
was active. A B sync request carrying A operational state, or an automatic
remote bootstrap that merges accounts, is a failure.

For a browser profile upgraded from the pre-account-namespace implementation
that already has sync enabled, the first post-update sign-in is intentionally
also guarded because the legacy operational state has no trustworthy owner
marker. Expected: no automatic adoption. First make an encrypted local backup,
then bootstrap the intended account from a fresh browser profile. Treat an
automatic legacy outbox upload to either account as a failure.

## Certification boundary

Passing this checklist is live Account A/B evidence. It is separate from the
repository's static SQL inspection, mock transport tests, and the already
reported manual multi-device, Assistant, conflict-cleanup, and revoke-and-wipe
workflows. Record date, build URL/version, migration completion, and outcomes
in the release record without copying secrets.
