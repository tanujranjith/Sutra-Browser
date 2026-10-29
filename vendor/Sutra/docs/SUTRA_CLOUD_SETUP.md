# Sutra Cloud — Setup

**Sutra Cloud** is Sutra's optional, encrypted cloud **backup** system. You choose
*where* your encrypted backups are stored; Sutra encrypts your workspace on your
device first and only ever uploads the locked `.sutra` file.

- It is **optional** and **off by default**.
- It is **backup / restore, not live sync.** "Cross-device" means *back up here,
  restore there*.
- The provider you choose **only ever stores ciphertext** — it cannot read your
  workspace.
- Your **backup passphrase is never stored by Sutra and never sent** to any
  provider. **If you lose it, your cloud backups cannot be recovered.**

```
Sutra workspace  →  encrypted on this device  →  encrypted .sutra file  →  your chosen provider
```

See also: [Providers](SUTRA_CLOUD_PROVIDERS.md) · [Security](SUTRA_CLOUD_SECURITY.md) ·
[Troubleshooting](SUTRA_CLOUD_TROUBLESHOOTING.md) ·
[Privacy & local-first](privacy-security/PRIVACY_AND_LOCAL_FIRST.md) ·
[Data & backups](privacy-security/DATA_AND_BACKUPS.md).

---

## Quick start

1. Open the **Save bar** at the bottom of the workspace → **Sutra Cloud**.
2. Under **Choose backup destination**, pick a provider:
   - **Recommended:** Google Drive, OneDrive, Dropbox.
   - **Advanced:** WebDAV (Nextcloud/ownCloud), S3-compatible, Supabase, Custom HTTP.
   - **Manual:** download the encrypted `.sutra` file and save it anywhere.
3. Connect / configure the provider (see below).
4. Click **Back Up Now** and set a **backup passphrase** (let your browser save it).
5. To restore on another device: open Sutra Cloud, connect the **same** provider,
   open **Manage backups**, choose a backup, and enter the **same passphrase**.

Nothing is uploaded until you click **Back Up Now** (or explicitly enable
auto-backup). A fresh start makes **zero** cloud requests.

---

## Recommended provider setup

All three recommended destinations connect **in-app**: you create a free, public
OAuth client ID / app key **once** in the provider's developer console and paste it
into Sutra's setup panel — no source edits, no redeploy. It is public
configuration, **not** a secret: never paste a client *secret*, service-role, or
admin key. Each panel shows the exact **redirect URI** to register.

### Google Drive
1. **Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID**, application type **Web application**.
2. Add your Sutra origin to **Authorized JavaScript origins** (e.g.
   `https://<you>.github.io`) and the **redirect URI shown in the panel** (e.g.
   `https://<you>.github.io/Sutra/oauth-callback.html`) to **Authorized redirect URIs**.
3. In Sutra Cloud → **Google Drive**, paste the **Client ID**, **Save**, then **Connect**.
4. Sutra requests only the `drive.appdata` scope; each backup is one timestamped
   `.sutra` file in your Drive's hidden app-data folder (separate from Settings →
   Data live sync).

### OneDrive
1. **Microsoft Entra admin center → App registrations → New registration**, then add
   a **Single-page application (SPA)** platform.
2. Add the **redirect URI shown in the panel** to that SPA platform.
3. In Sutra Cloud → **OneDrive**, paste the **Application (client) ID**, **Save**,
   then **Connect**. Scope: `Files.ReadWrite.AppFolder offline_access` (private app folder).
4. Restore downloads from Microsoft's content CDN; Sutra's CSP allows those specific
   Microsoft host families as a reviewed exception (see Security / Hosted vs self-hosted).

### Dropbox
1. **Dropbox App Console → Create app → Scoped access → App folder.**
2. Under **Permissions** enable `files.content.write` + `files.content.read`; under
   **Settings** add the **redirect URI shown in the panel**.
3. In Sutra Cloud → **Dropbox**, paste the **App key**, **Save**, then **Connect**.

### Box
**Box can't be connected in the hosted browser app** — its OAuth token exchange
requires a confidential client secret a static app can't hold safely. Use **Manual
encrypted file** into a Box-synced folder, or self-host with a small token-exchange
proxy.

---

## Advanced provider setup

All advanced destinations encrypt locally first and store only ciphertext.
**Custom origins are blocked by the hosted build's Content Security Policy (CSP)
— see [Hosted vs self-hosted](#hosted-vs-self-hosted).**

### WebDAV (Nextcloud / ownCloud / generic)
1. In Nextcloud/ownCloud: **Settings → Security → Devices & sessions → Create new
   app password**. (Never use your account password.)
2. In Sutra Cloud → **Advanced destinations → WebDAV → Use this**, enter:
   - **WebDAV server URL** — e.g. `https://cloud.example.com/remote.php/dav/files/USERNAME/`
   - **Username**
   - **App password**
   - **Folder** (optional) — e.g. `sutra-backups`
3. Click **Test connection**, then **Save destination**.

### S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, MinIO)
> **Preview:** the S3 adapter accepts and stores its configuration, but request
> signing (AWS SigV4) is a planned follow-up. Use **WebDAV** or **Custom HTTP**
> for working backups today.

When implemented, you will enter: **Endpoint URL**, **Region**, **Bucket**,
**Access key ID**, **Secret access key**, optional **prefix**. Always create a
**scoped** key limited to the backup bucket — **never** root/admin keys.

Provider notes:
- **AWS S3** — endpoint `https://s3.<region>.amazonaws.com`, set region.
- **Cloudflare R2** — endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`.
- **Backblaze B2** — S3 endpoint `https://s3.<region>.backblazeb2.com`.
- **Wasabi** — `https://s3.<region>.wasabisys.com`.
- **DigitalOcean Spaces** — `https://<region>.digitaloceanspaces.com`.
- **MinIO** — your self-hosted endpoint; usually requires path-style addressing.

### Supabase (advanced)
Supabase is now **one advanced destination**, not Sutra's central backend.
1. Create a Supabase project and run [`supabase/schema.sql`](../supabase/schema.sql).
2. Enable email auth (one-time code).
3. In Sutra Cloud → **Advanced → Supabase → Use this**, paste your **Project URL**
   and **public anon key** (never the `service_role` key).
4. **Test connection**, then **Save**, then sign in with email.
Full details + SQL: [`supabase/README.md`](../supabase/README.md).

### Custom HTTP endpoint
For developers/self-hosters running a server that implements Sutra's backup API:
- `POST {base}/backups` (body = ciphertext) → `{ "id": "..." }`
- `GET {base}/backups` → `[{ id, label, createdAt, sizeBytes, deviceId }]`
- `GET {base}/backups/{id}` → ciphertext bytes
- `DELETE {base}/backups/{id}`
- Optional `Authorization: Bearer <token>`.

Enter the **Base URL** and optional **token**, **Test connection**, **Save**.

---

## Manual backup guide

The simplest, no-account option:
1. Sutra Cloud → **Manual encrypted file → Use this → Back Up Now**.
2. A password-encrypted `.sutra` file downloads.
3. Move it into any folder that already syncs (Google Drive Desktop, OneDrive,
   Dropbox, **iCloud Drive**), or onto a USB drive / NAS.
4. To restore: Sutra Cloud (Manual) → **Restore** → pick the file → enter the
   passphrase. (Or use **Import** in the save bar.)

Manual backups work entirely offline and never depend on a provider.

---

## Hosted vs self-hosted

Sutra is a static browser app with a strict **Content Security Policy (CSP)**.
The browser only allows network requests to origins explicitly listed in the
CSP. The guard permits only reviewed host families (including Supabase's
project-origin family); arbitrary cloud origins cannot be allowed dynamically.

| Destination | Hosted build | Notes |
|---|---|---|
| Google Drive | ✅ Works in-app | Paste an OAuth Web client ID; `googleapis.com` / `accounts.google.com` already in CSP |
| OneDrive | ✅ Works in-app | Paste a SPA client ID; restore reads from Microsoft CDN host families allowed in CSP (reviewed exception) |
| Dropbox | ✅ Works in-app | Paste an App-folder app key; `*.dropboxapi.com` + `www.dropbox.com` in CSP |
| Box | 🔒 Self-host | Needs a confidential secret; use Manual into a Box-synced folder, or a token-exchange proxy |
| Supabase (configured project) | ✅ Works after setup | `https://*.supabase.co` is a reviewed CSP family; configure a public project URL/key |
| Supabase (other project) | ✅ Works after setup | Any hosted `*.supabase.co` project origin is allowed; self-hosted non-Supabase origins need a CSP change |
| WebDAV / S3 / Custom HTTP | 🔒 Self-host | Add your origin to the CSP |
| Manual encrypted file | ✅ Always | No network |

**To use a custom origin (self-hosting):** add your provider origin to the
`connect-src` directive in `scripts/lib/csp-policy.mjs`, run
`npm run csp:generate`, then rebuild/redeploy. The generator keeps the HTML,
local server, and Vercel header synchronized. Sutra detects
a CSP-blocked origin and tells you in the panel rather than failing silently.

Sutra ships a small, **reviewed** set of CSP `connect-src` wildcard families for
Supabase project origins and OneDrive restore (Microsoft's sharded content CDN — `*.1drv.com`,
`*.sharepoint.com`, `*.microsoftpersonalcontent.com`, `*.dms.live.net` — whose
download host is dynamic per account/region). The CSP guard
(`scripts/sutra-csp-check.mjs`) allows **only** those families and still rejects
any other connect/frame wildcard.

---

## Security in one paragraph

Your workspace is encrypted on your device with AES-GCM-256 (PBKDF2, 600k
iterations) into a `.sutra` envelope **before** anything leaves Sutra. The
provider stores only that ciphertext plus minimal metadata (label, size, time,
device id). The passphrase is never stored and never sent. Restore replaces your
current workspace (you confirm first). Full model:
[Security](SUTRA_CLOUD_SECURITY.md).
