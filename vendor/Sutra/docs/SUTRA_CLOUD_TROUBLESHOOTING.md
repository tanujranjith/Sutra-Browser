# Sutra Cloud — Troubleshooting & FAQ

Plain-English fixes for common Sutra Cloud issues. See also
[Setup](SUTRA_CLOUD_SETUP.md), [Providers](SUTRA_CLOUD_PROVIDERS.md), and
[Security](SUTRA_CLOUD_SECURITY.md).

## Troubleshooting

### I can't connect my provider
- Recheck the URL/keys. WebDAV needs the full DAV path
  (`…/remote.php/dav/files/USERNAME/`). Supabase needs the **anon** key.
- Click **Test connection** — it tells you whether it's the URL, the credentials,
  or the browser security policy.
- Google Drive, OneDrive, and Dropbox show **"Needs configuration"** until you
  paste your own public OAuth client ID/app key in their setup card. Their
  browser transports are implemented; a client secret is never requested.
- Box is different: its token exchange needs a confidential secret, so it is
  unavailable in the static build. Use a Manual encrypted file in a Box-synced
  folder, or a self-hosted token-exchange proxy.

### "Blocked by browser security policy" / custom provider won't load
- The hosted build's CSP only allows known origins and **forbids wildcards**.
  Your custom WebDAV/S3/Custom-HTTP/other-Supabase origin isn't allowed.
- **Fix:** run a **self-hosted Sutra build** and add your origin to the
  `connect-src` in `scripts/lib/csp-policy.mjs`, run `npm run csp:generate`,
  then rebuild or redeploy. Recommended providers work in the hosted build.

### I forgot my passphrase
- It's **unrecoverable** — Sutra never stores it and providers never receive it.
  Your existing cloud backups can't be decrypted without it. Start a new backup
  with a new passphrase and save it in your browser's password manager.

### Restore says "wrong password"
- The passphrase doesn't match this backup. Each backup is locked with the
  passphrase used at backup time. Your **current workspace is untouched** — try
  the correct passphrase or another backup.

### I don't see my backups
- Make sure you connected the **same provider/account** used to create them.
- Manual backups are files on your device/synced folders, not a cloud list — use
  **Restore → pick file** (or the save bar **Import**).
- For S3 (preview), backups aren't uploaded yet — use WebDAV/Custom HTTP.

### Auto-backup isn't running
- It's **off by default**. Enable it in **Manage backups**, with a connected
  provider, after doing **one manual backup** this session (so the passphrase is
  cached). It won't run if the provider is disconnected or setup is invalid, or if
  you reload (passphrase clears) until you back up once more.

### Upload failed
- Check connectivity and that the provider/bucket/folder exists and your
  credentials have write access. Re-run **Test connection**.

### Restore failed
- Usually a wrong passphrase or a partial download. Your workspace isn't changed.
  Retry; if it persists, try another backup or a local `.sutra` import.

### I switched providers and my old backups disappeared
- They didn't — switching just shows the **new** provider's list. Your old
  backups remain in the **old** provider until you delete them. Switch back to see
  them.

### What happens if I delete a cloud backup?
- It's permanently removed from that provider. Other backups and your local
  workspace are unaffected.

### How do I move from one provider to another?
- Connect provider A, **Back Up Now**. Then **Choose backup destination** →
  provider B, connect, **Back Up Now**. To migrate data, **Restore** from A first,
  then back up to B.

### Supabase: RLS / permission errors
- Run [`supabase/schema.sql`](../supabase/schema.sql) exactly — it creates the
  `backups` bucket, `backup_index` table, and the Row Level Security policies that
  isolate each user. Broken RLS can block access or create unsafe permissions.

### WebDAV path issues
- The URL must point at your files root (e.g.
  `https://cloud.example.com/remote.php/dav/files/USERNAME/`). An optional folder
  is created with `MKCOL` on first upload.

### S3 bucket / prefix / region issues
- Ensure the bucket exists, the region matches the endpoint, and (for MinIO and
  some providers) path-style addressing is used. Use scoped keys.

---

## FAQ

**Can Sutra read my backup?** No. It's encrypted on your device; Sutra has no key.

**Can my provider read my workspace?** No. The provider stores ciphertext only.

**Is this live sync?** No — it's backup/restore. Back up here, restore there.

**What happens if I lose my passphrase?** Cloud backups become unrecoverable.

**Can I use multiple providers?** Yes, one active destination at a time; switch
anytime. Each provider keeps its own backups.

**Can I switch providers?** Yes — switching signs you out of the current provider
and shows the new one's list; your local workspace is untouched.

**Does auto-backup run without permission?** No. Off by default; explicit opt-in;
requires a connected provider + session passphrase.

**Do cloud backups include everything?** Yes — the full encrypted workspace
(notes, tasks, homework, AP/college/life/business, settings, attachments), the
same as a `.sutra` export. API keys/secrets are stripped.

**Are provider credentials included in exported `.sutra` files?** No. Credentials
are device-local and never travel in a backup.

**Can I use iCloud Drive?** Yes — via **Manual** backup: save the encrypted
`.sutra` into your iCloud Drive folder.

**Can I self-host storage?** Yes — WebDAV, S3-compatible, or a Custom HTTP
endpoint (self-hosted build needed for custom origins due to CSP).

**What is WebDAV?** A standard file-access protocol supported by Nextcloud,
ownCloud, and many NAS devices — Sutra uploads encrypted files over it.

**What is S3-compatible storage?** Object storage that speaks the AWS S3 API
(AWS, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, MinIO).

**What is Supabase used for now?** It's **one advanced backup destination**, not
Sutra's central backend. Sutra needs no central server to back up your data.
