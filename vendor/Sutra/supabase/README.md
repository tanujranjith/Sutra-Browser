# Sutra Cloud backup and Sutra Sync — Supabase setup

> **Supabase is now one *advanced* Sutra Cloud destination — not Sutra's central
> backend.** Sutra Cloud is provider-based: most users pick a recommended
> destination (Google Drive / OneDrive / Dropbox) or Manual export. Supabase is an
> advanced option for people comfortable with Supabase Auth, Storage, and RLS.
> Overview of all destinations: [`docs/SUTRA_CLOUD_PROVIDERS.md`](../docs/SUTRA_CLOUD_PROVIDERS.md).

This directory contains two independent optional systems:

- **Sutra Cloud backup** (`schema.sql`) stores point-in-time encrypted `.sutra`
  files. It is backup/restore, not incremental sync.
- **Sutra Sync** (`sync-schema.sql`) stores encrypted record operations,
  snapshots, and assets for automatic multi-device convergence.

Both are off by default. Local IndexedDB saving does not depend on either one,
and a cold start with sync disabled makes no Supabase request.

For backup, Supabase receives the encrypted `.sutra` blob plus bounded backup
metadata. For sync, it receives AES-GCM ciphertext plus bounded routing metadata
(operation/device ids, record keys, sizes, and timing). It never receives
plaintext notes, tasks, course names, grades, attachment bytes, vault keys, or
passphrases.

There are **two backends**:

| | Official Sutra Cloud | Bring Your Own Supabase |
|---|---|---|
| Who it's for | **Most users (recommended)** | Advanced/technical users |
| Backend | Sutra's configured Supabase project | **Your own** Supabase project |
| Setup | None (just sign in) | You create + configure a project |
| Who's responsible | The Sutra app owner | **You** (billing, uptime, RLS, security) |
| Hosted build | Works | May require a **self-hosted build** (see CSP note) |

Both backends use the **same** encryption, passphrase, retention (last 10), and
restore-overwrite behavior. The choice is only *whose* Supabase project stores the
encrypted files. **Custom Supabase is more user-controlled, not automatically
safer.**

> **Never paste a `service_role` (secret) key into Sutra.** It bypasses Row Level
> Security and must stay server-side. Sutra only ever needs the **public anon
> key**, and refuses keys that look like service-role keys.

---

## Path A — Official Sutra Cloud (for the app owner)

This is the shared backend that normal Sutra Cloud users sign into. Do this once,
as the person deploying Sutra.

### 1. Create the official Supabase project
- Sign up at <https://supabase.com> and create a project (free tier is fine for a
  start; see costs below).

### 2. Apply the schema
- **SQL Editor** → paste [`schema.sql`](./schema.sql) → **Run**. This creates the
  private `backups` bucket, the `backup_index` table, and the RLS policies that
  isolate each user's data. (Idempotent — safe to re-run.)
- To also enable **Sutra Sync** (encrypted multi-device sync, distinct from
  backups): paste [`sync-schema.sql`](./sync-schema.sql) → **Run**. It adds the
  append-only encrypted op log, device registry, wrapped vault keys, compaction
  snapshots, the private `sync-assets` bucket, and authenticated `sync_*` RPCs.
  Direct sync-table grants are revoked; each RPC/asset request binds
  `auth.uid()` and the current auth `session_id` to a non-revoked device. (Also
  idempotent.) User guide: [`docs/features/CLOUD_SYNC.md`](../docs/features/CLOUD_SYNC.md).
- **Existing Sutra Sync project (including the configured production project):**
  do not recreate tables or erase vault rows. Paste
  [`migrations/20260716_device_revoke_wipe.sql`](./migrations/20260716_device_revoke_wipe.sql)
  into SQL Editor first, then paste
  [`migrations/20260718_sync_account_isolation.sql`](./migrations/20260718_sync_account_isolation.sql),
  then
  [`migrations/20260730_sync_storage_path_and_function_permissions.sql`](./migrations/20260730_sync_storage_path_and_function_permissions.sql).
  Finally, apply
  [`migrations/20260825_sync_pruning_durable_ack.sql`](./migrations/20260825_sync_pruning_durable_ack.sql),
  followed by
  [`migrations/20260830_sync_put_asset_ambiguity.sql`](./migrations/20260830_sync_put_asset_ambiguity.sql),
  then
  [`migrations/20260830_sync_z_prune_floor_reference.sql`](./migrations/20260830_sync_z_prune_floor_reference.sql).
  All six are additive/idempotent and safe to rerun: existing encrypted ops,
  snapshots, keys, assets, and devices are preserved. The storage migration
  recreates only the four `sync-assets` Storage policies with the exact anchored
  `^<auth.uid()>/[0-9a-f]{64}$` form and removes browser-role execution of
  `public.rls_auto_enable()` while retaining `postgres`. It creates no
  table/bucket, changes no Sync RPC grant, and never deletes an object. The
  pruning migration makes device cursor acknowledgement post-commit, exposes
  authenticated conservative compaction pruning, and preserves the snapshot
  cursor as the logical head after covered ops are removed. Applying the
  migration does not itself prune rows; pruning remains client-triggered after
  a successful encrypted snapshot. The final asset-RPC migration preserves the
  browser's `hash` argument while making the asset-index upsert unambiguous to
  PL/pgSQL. The final pruning-floor reconciliation repairs the positive-floor
  delete branch without changing its conservative snapshot/active-device floor
  or deleting any row merely by applying the migration.

Expected sync tables: `sync_ops`, `sync_devices`, `sync_vault_keys`,
`sync_snapshots`, `sync_asset_index`. Expected private Storage buckets after
both files: `backups`, `sync-assets`. Expected browser RPCs: `sync_ping`,
`sync_touch_device`, `sync_pull`, `sync_push`, `sync_get_vault_key`,
`sync_put_vault_key`, `sync_get_snapshot`, `sync_put_snapshot`,
`sync_put_asset`, `sync_has_asset`, `sync_list_assets`, `sync_list_devices`,
`sync_prune_ops`,
`sync_revoke_device`, `sync_get_device_status`,
`sync_acknowledge_device_wipe`, and `sync_delete_vault`.

The device table additionally has `revoked_by`, `wipe_required`, and
`wipe_acknowledged_at`. Verify the migration in SQL Editor with:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'sync_devices'
  and column_name in ('revoked_by','wipe_required','wipe_acknowledged_at')
order by column_name;

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('sync_get_device_status','sync_acknowledge_device_wipe')
order by routine_name;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'sync_get_device_status',
    'sync_acknowledge_device_wipe',
    'rls_auto_enable'
  )
order by routine_name, grantee;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('sync_ops','sync_devices','sync_vault_keys','sync_snapshots','sync_asset_index')
order by tablename;

select schemaname, tablename, policyname
from pg_policies
where (schemaname = 'public' and tablename like 'sync_%')
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

select id, name, public
from storage.buckets
where id in ('backups','sync-assets')
order by id;
```

Expected: three column rows; two `SECURITY DEFINER` revoke/wipe routines;
authenticated-only `EXECUTE` for browser-facing `sync_*` routines;
`rls_auto_enable()` has no `PUBLIC`, `anon`, or `authenticated` execute grant
(`postgres`/the database owner may appear); five sync tables with
`rowsecurity = true`;
the existing deny-direct table policies plus four active-device `sync-assets`
policies; and private `backups` / `sync-assets` buckets. No new bucket/table
or policy is created by this migration. Rollback is normally unnecessary; do
not drop the columns while
clients use Revoke & wipe. If an RPC replacement fails, rerun the same file—it
uses `add column if not exists` and `create or replace function`.

After `20260730_sync_storage_path_and_function_permissions.sql`, each
`sync-assets` policy should require `bucket_id = 'sync-assets'`, the anchored
`name` regex `^<auth.uid()>/[0-9a-f]{64}$`, and
`public.sync_session_active()`. Uppercase, wrong-length, filename-shaped,
nested, leading/trailing-slash, cross-account, anonymous, unregistered,
inactive, and revoked-session requests are rejected. A missing condition is a
security failure: rerun that exact migration rather than weakening the policy.

Before treating Account A/B isolation as live-certified, use the operator-only
[account-isolation checklist](../docs/release/SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md).
It deliberately keeps bearer tokens in the operator's own browser and does not
require any elevated Supabase credential.

### 3. Enable passwordless email auth
- **Authentication → Providers → Email**: enable Email/passwordless sign-in.
- In the email templates used for sign-in and first-time confirmation, show the
  six-digit `{{ .Token }}` value (not only `{{ .ConfirmationURL }}`). Sutra's UI
  verifies a six-digit code directly.
- Set **Authentication → URL Configuration → Site URL** to the deployed Sutra
  origin. For this repository's documented GitHub Pages target use
  `https://tanujranjith.github.io/Sutra/`.
- Allow redirects for every origin that will host Sutra, including
  `https://tanujranjith.github.io/Sutra/**`, `http://localhost:4173/**`, and
  `http://127.0.0.1:4173/**`. The code-based flow does not depend on a redirect,
  but keeping these entries correct prevents a template/configuration change
  from redirecting to an unrelated origin.

### 4. Wire the public keys into the build
Both values are **public/publishable** (safe in a static build). Find them in
**Project Settings → API**.

- In [`src/config/sutra-runtime-config.js`](../src/config/sutra-runtime-config.js):
  ```js
  window.SUTRA_CONFIG.supabaseUrl     = 'https://YOUR-PROJECT-REF.supabase.co';
  window.SUTRA_CONFIG.supabaseAnonKey = '<your anon / publishable key>';
  ```
- **Never** put the `service_role` key (or a DB password) here.

### 5. Content Security Policy — already allowed
The shipped CSP `connect-src` includes the approved wildcard `https://*.supabase.co`
(declared in [`scripts/lib/csp-policy.mjs`](../scripts/lib/csp-policy.mjs) under
`APPROVED_CONNECT_WILDCARDS`), so **any** Supabase project origin works without a
CSP change. If you ever need to add a *non*-Supabase origin, edit
`scripts/lib/csp-policy.mjs` and run `npm run csp:generate` — never hand-edit the
CSP in `Sutra.html`, `vercel.json`, or `scripts/serve-static.mjs`; those are
generated outputs and `npm run check:csp` fails if they drift.

### 6. Verify
```
npm run check:csp
npm run check:network
npm run check:all
```

This backend is then shared by all normal Sutra Cloud users (each isolated by RLS).

---

## Path B — Bring Your Own Supabase (advanced users)

For technical users who want their **own** Supabase project instead of the
official backend. You are responsible for your project's billing, uptime,
configuration, and security rules.

1. **Create a Supabase project** at <https://supabase.com>.
2. **Run [`schema.sql`](./schema.sql)** in the SQL Editor (creates the `backups`
   bucket, `backup_index` table, and RLS policies). Run
   [`sync-schema.sql`](./sync-schema.sql) second only if this project will also
   provide incremental Sutra Sync.
3. **Enable email auth** (Authentication → Providers → Email) — magic-link/OTP.
4. **Copy your Project URL** (`https://<your-ref>.supabase.co`).
5. **Copy your public anon key** (Project Settings → API → `anon` `public`).
6. In Sutra: open **Sutra Cloud** (save bar) → **Storage backend** → expand
   **“Use my own Supabase project (advanced)”** → paste URL + anon key.
7. Click **Test connection**.
8. **Sign in** with email, then **run a manual backup first**. Only enable
   **auto-backup** after you've confirmed manual backup *and* restore work.

The URL + anon key are stored **device-locally** through `SutraSafeStorage`
(`sutra:supabaseCustomBackend:v1`) — they never travel inside a `.sutra` backup,
so each device can choose its own backend.

### Hosted build + CSP

The hosted build's CSP `connect-src` includes the approved wildcard
`https://*.supabase.co`, so **both the official backend and a custom Supabase
project work in the hosted build** — no self-hosted rebuild is needed for
Supabase. Self-hosting only matters for *non*-Supabase custom origins (WebDAV,
Custom HTTP, S3), which must be added to `scripts/lib/csp-policy.mjs` followed by
`npm run csp:generate`. Sutra still detects any CSP-blocked origin and tells you
in the panel rather than failing silently.

### Warnings
- **Never paste a `service_role` / secret key.** Sutra only needs the public anon
  key and rejects keys that look like service-role keys.
- **Lost passphrase = unrecoverable backups.** End-to-end encryption means nobody
  — not Sutra, not Supabase, not you-without-the-passphrase — can decrypt them.
  Let your browser's password manager save it.
- **Supabase stores only encrypted `.sutra` files** — never plaintext.
- **Broken RLS policies can block access or create unsafe permissions.** Sutra
  cannot fully verify your project's security rules; run the setup SQL exactly.
- **Restore replaces** your current workspace (it is not a merge), after a
  confirmation.
- Custom Supabase is **more user-controlled, not automatically safer** than the
  official backend.

---

## Costs & limits (free tier)
- Free projects **pause after ~1 week of inactivity**; you get 1 GB file storage /
  5 GB egress / 50k monthly active users, no backups/SLA.
- For real multi-user use of the **official** backend, plan on **Pro (~$25/mo)**
  plus a keep-alive. (For BYO, this is the advanced user's own concern.)

## What gets stored (either backend)
- `storage://backups/<your-uid>/<timestamp>-<label>-<random-attempt-id>.sutra`
  — the encrypted blob. New attempts do not overwrite existing paths.
- `public.backup_index` — one row per backup: path, label, size, device id, time.
  No workspace content. Retention keeps the **last 10** per user.
- Storage upload and index insertion are one user-visible result. If insertion
  fails after upload, the browser issues a compensating DELETE for that exact
  attempt path. A missing object is treated as already cleaned up. If DELETE
  also fails, the metadata error remains primary and the cleanup failure is
  reported as a secondary non-sensitive warning; the backup is never marked
  successful.
- `public.sync_ops`, `sync_devices`, `sync_vault_keys`, `sync_snapshots`, and
  `sync_asset_index` — incremental sync routing state and encrypted envelopes.
- `storage://sync-assets/<your-uid>/<sha256>` — encrypted asset envelopes under
  opaque content hashes; original filenames are not used in object paths.

The publishable browser key is expected in frontend assets. Secret/service-role
keys, database passwords, JWT signing secrets, vault passphrases, recovery
material, and unwrapped/derived keys must never be placed in Sutra.
