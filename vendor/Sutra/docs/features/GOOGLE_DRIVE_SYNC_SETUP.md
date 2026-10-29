# Google Drive Sync Setup

Sutra is local-first by default. Optional Google Drive sync uploads encrypted
workspace snapshots to the user's own Google Drive `appDataFolder`.

## Google Cloud Console

1. Create or choose a Google Cloud project.
2. Enable the **Google Drive API**.
3. Configure the OAuth consent screen. Choose **External** user type unless your
   account is in a Google Workspace org. While the app is in **Testing** publishing
   status, add every Google account that will sign in under **Test users** —
   non-test accounts cannot authorize until you publish the app. (Publishing an
   app that requests only `drive.appdata` does **not** require Google verification.)
4. Add only this scope for automatic sync:

   `https://www.googleapis.com/auth/drive.appdata`

5. Create credentials → **OAuth 2.0 Client ID** → Application type **Web application**.
6. Under **Authorized JavaScript origins**, add the production HTTPS origin
   (scheme + host only, no path), for example `https://tanujranjith.github.io`.
   This is a browser token-client flow, so **no Authorized redirect URI is
   needed** — leave that section empty.
7. Also under **Authorized JavaScript origins**, add the localhost development
   origins you use, for example `http://localhost:5173` and
   `http://127.0.0.1:5173`.
8. Copy the public client ID and paste it into the Sutra runtime config file
   **`src/config/sutra-runtime-config.js`** (loaded by `Sutra.html` before
   `src/core/app.js`):

   ```js
   // src/config/sutra-runtime-config.js
   window.SUTRA_CONFIG = window.SUTRA_CONFIG || {};
   window.SUTRA_CONFIG.googleDriveClientId = 'YOUR_PUBLIC_WEB_CLIENT_ID.apps.googleusercontent.com';
   ```

9. Do not put a client secret in Sutra. Static browser apps must not contain
   OAuth client secrets, and this token-client flow never uses one.
10. Deploy the updated static site, then test connect, unlock, upload, download,
    reconnect, disconnect, delete-cloud data, conflict, and revoke-consent flows.

## Runtime behavior

- Sutra requests only `drive.appdata`.
- Access tokens are kept in memory only.
- The cloud sync password and derived key are kept in memory only.
- The sync file is named `sutra-sync-current-v1.sutra`.
- The sync file is stored in Drive `appDataFolder`, not visible My Drive.
- Sync runs while the app is open, online, unlocked, and authorized.
- Direct `file://` launch may not support Google OAuth; use HTTPS or localhost.

Manual encrypted `.sutra` backups remain important because the cloud vault is
optional, the sync password can be forgotten, Drive app data can be deleted,
authorization can be revoked, cloud access can be unavailable, and recovery
should not depend on one cloud copy.
