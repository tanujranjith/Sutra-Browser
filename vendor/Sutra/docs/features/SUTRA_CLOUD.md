# Sutra Cloud

**Sutra Cloud** is Sutra's user-facing encrypted backup system. It is **provider-based**:
the same encrypted `.sutra` envelope can be stored in different destinations.
Choosing a provider does **not** mean Sutra runs a backend — Manual encrypted
file needs no account or network at all.

Open it from **Settings → Data → Sutra Cloud**.

## Providers

| Provider | Category | Status |
|---|---|---|
| Manual encrypted `.sutra` file | Manual | ✅ first-class (no account, no network) |
| Google Drive | Recommended | ✅ works after a public OAuth client ID is configured |
| OneDrive | Advanced | ✅ works after a public SPA client ID is configured |
| Dropbox | Advanced | ✅ works after a public App-folder app key is configured |
| Supabase | Advanced | ✅ works after configuration; `*.supabase.co` is CSP-approved |
| WebDAV (Nextcloud/ownCloud) | Advanced | ✅ works in a self-hosted build with its origin in CSP |
| Custom HTTP endpoint | Advanced | ✅ works in a self-hosted build with its origin in CSP |
| Box | Advanced | 🔒 not available in the static build; use Manual or a self-hosted token proxy |
| S3-compatible | Advanced | preview — config UI present, SigV4 signing is a follow-up |

The provider card distinguishes **works now**, **needs configuration**,
**self-host only**, and **preview**. A provider is never shown as active merely
because a configuration form exists.

Full provider matrix, setup, security model, and troubleshooting live in:

- [`docs/SUTRA_CLOUD_PROVIDERS.md`](../SUTRA_CLOUD_PROVIDERS.md)
- [`docs/SUTRA_CLOUD_SETUP.md`](../SUTRA_CLOUD_SETUP.md)
- [`docs/SUTRA_CLOUD_SECURITY.md`](../SUTRA_CLOUD_SECURITY.md)
- [`docs/SUTRA_CLOUD_TROUBLESHOOTING.md`](../SUTRA_CLOUD_TROUBLESHOOTING.md)

## What's protected

- Every provider receives **ciphertext only** — the controller encrypts once and
  hands adapters an opaque `.sutra` AES-GCM blob. Adapters never see plaintext or
  the passphrase.
- Cloud backup passwords / derived keys stay **in memory** (session) only. The
  Supabase refresh token is session-only by default; the explicit “Remember me
  on this device” option stores it encrypted in the device-local credential
  vault and never exports or syncs it.
- Secrets, API keys, OAuth tokens, backup passwords, and conversation history are
  **never** included in an export.
- Supabase object upload and metadata indexing are treated as one result. A
  failed index write rolls back only that attempt's uniquely named object; if
  cleanup also fails, the backup remains failed and the cleanup problem is
  retained only as secondary, non-sensitive diagnostic context.
- `getSetupStatus()` is pure (no network), so a fresh boot makes **zero**
  requests — Sutra stays local-first.

## Strict CSP

Custom origins (WebDAV / Custom HTTP / S3 / arbitrary providers) only work when
their exact origin is in the Content-Security-Policy `connect-src`. The hosted
build pins specific origins plus the reviewed `https://*.supabase.co` wildcard,
so other arbitrary endpoints require a
**self-hosted/advanced build**. Sutra detects blocked origins
(`sutraCloudOriginAllowedByCsp`) and surfaces a `cspBlocked` status rather than
pretending a blocked origin will work.

This provider layer stores point-in-time backups. **Sutra Sync** is the separate
incremental, record-level Supabase protocol documented in
[`CLOUD_SYNC.md`](./CLOUD_SYNC.md); Google Drive, OneDrive, Dropbox, WebDAV, and
Custom HTTP are not described as incremental sync providers.

## Developer surface

`window.SutraCloudSync` exposes the provider registry (`listProviders`,
`getActiveProvider`, `switchProvider`), per-provider config, `backupNow`,
`listBackups`, `restore`, and the credential/CSP helpers. New provider adapters
are built with `makeSutraCloudAdapter({ ... })` (see
`docs/SUTRA_CLOUD_PROVIDERS.md` → "add a new provider adapter").
