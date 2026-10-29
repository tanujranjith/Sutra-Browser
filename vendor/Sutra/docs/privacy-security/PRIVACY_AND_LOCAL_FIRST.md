# Privacy and Local-First

_Sutra is a private, local-first workspace for students. This document is the
plain statement of what that means: where your data lives, what never leaves
your device, and how to take it with you or wipe it completely._

`PRIVATE * LOCAL-FIRST * STUDENT-BUILT`

---

## 1. The local-first philosophy

Sutra is built so that **your workspace belongs to you and stays on your
device.** It is a **static web app** - it runs from static hosting or directly
from a local file, with:

- **no backend** of Sutra's own,
- **no required accounts** - you can use everything without signing up; an
  account is needed only for the optional Sutra Cloud backup feature,
- **no telemetry** - Sutra does not phone home or track usage,
- **optional cloud sync/backup off by default** - nothing is silently copied to a server.

Your notes, tasks, homework, study data, and settings are read and written locally. Optional Google Drive sync, if you explicitly enable it, uploads only browser-encrypted snapshots to your own Drive app-data folder. **Once Sutra has loaded, it needs no network connection to read or edit
your workspace** - every data operation is local. How reliably the app itself
*reopens* without a network depends on where you run it; see
[section 11 Offline behavior](#11-offline-behavior-and-deployment-headers) for the
precise guarantee.

---

## 2. What stays on your device

**Everything.** Your entire workspace - every note (including inline images and
**Document Background** images), task, time block, homework course and
assignment, Testing Hub and AP Study data, Review decks, College and Life and
Projects & Work data, streaks and habits, focus templates, themes, preferences,
and onboarding state - is stored locally in your browser. None of it is sent
anywhere by Sutra unless you explicitly export it, send it to an AI provider, or
enable optional encrypted Google Drive sync.

---

## 3. What is never exported

Some things are deliberately kept out of every backup file:

- **AI provider API keys / credentials / tokens.** These live in
  **`sessionStorage` by default**. If you explicitly enable remembered
  credentials, they are stored as AES-GCM encrypted records in the separate
  device-local `sutra_credentials_db` vault. Raw keys and encrypted credential
  records are **never included in any export** - `.sutra` or JSON.
  When you export your workspace, the exporter actively **redacts** any nested
  secret-shaped field (keys, tokens, passwords) so credentials cannot ride along
  by accident.
- **Assistant conversation history is optional.** When **Save chat history** is
  enabled, visible chat messages are stored locally in this browser so you can
  reopen them. They are included in password-encrypted `.sutra` backups by
  default, excluded from plaintext JSON recovery unless you explicitly opt in,
  and can be disabled or cleared in Assistant settings. API keys, provider
  credentials, hidden reasoning, and backup passwords are never included.
- **Backup passwords, Google Drive sync passwords, OAuth access tokens, client
  secrets, and derived encryption keys** are never exported. A remembered
  Sutra Cloud session stores only its encrypted refresh token in the credential
  vault; it is never exported or synchronized.
- **Google Drive sync metadata** (`sutra:googleDriveSync:v1`) and **Sutra Cloud
  metadata** (`sutra:supabaseCloud:v1`) are device-local operational state and are
  deliberately excluded from workspace backups.
- **Sutra Cloud sign-in session** (`sutra:supabaseSession:v1`) is a device-local
  account session token only. Your **backup passphrase is held in memory for the
  session only** (to allow optional auto-backup) and is **never persisted and
  never sent to any server**.

Your provider and model **choices** (which are not secrets) do travel, so a
restored workspace keeps its setup and only needs the key re-entered.

---

## 4. Where your data lives

Sutra uses your browser's local storage facilities:

- **IndexedDB** holds the bulk of your workspace and your binary attachments.
- **localStorage** holds homework data, a small set of preferences, optional
  saved Assistant conversations, and the Storage Health/save-failure banner
  state needed to warn you after a reload if IndexedDB could not confirm a save.
- **sessionStorage** holds session-scoped items — principally default-mode AI
  API keys and a compatibility copy of the current chat while the tab is open.
- **`sutra_credentials_db`** holds only explicitly remembered credentials in
  encrypted device-local records; it is not workspace data and is never exported
  or synchronized.

Some of these stores carry **legacy-named compatibility identifiers** - for
example the workspace database is named `noteflow_atelier_db` and the
attachments database `noteflow_attachments_db`. These names are **retained on
purpose so existing installs keep working** across the rename to Sutra; the name
is just an identifier and does not change where the data lives (still your
device). For the full layout, see [`DATA_AND_BACKUPS.md`](./DATA_AND_BACKUPS.md).

---

## 5. AI requests: browser -> the provider you choose

Sutra Assistant can use a language model, but **Sutra runs no model servers of
its own.** When a reply needs a model, the request goes **directly from your
browser to the AI provider you have chosen** (OpenAI, Anthropic Claude, Google
Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral AI, Together AI, DeepSeek, xAI,
Perplexity, or a Custom
OpenAI-Compatible / Local endpoint). There is no Sutra relay in the middle.

The local signal layer - **Sutra Intelligence** - that reads your workspace to
understand overdue work, workload, conflicts, weak areas, review backlog, and
next steps **runs entirely on your device and calls no server.** Only the
content you actually send in a message (bounded by your **Workspace Access**
setting) reaches the provider. See [`SUTRA_ASSISTANT.md`](../features/SUTRA_ASSISTANT.md)
for details and the always-visible privacy badge.

If you want even the AI side to stay on your own machine or network, point Sutra
at a **Local / Custom OpenAI-Compatible endpoint**.

Fresh startup, manual encrypted `.sutra` backup, and JSON backup are designed to complete with **zero third-party requests**. Optional network calls happen only after a user action: Google Drive OAuth/sync, AI provider calls, configured localhost/127.0.0.1 local endpoints, approved feedback-form embeds, approved media embeds (YouTube, Vimeo, Spotify, SoundCloud, CodePen, Figma, and YouTube thumbnails), AP Classroom resource links, AI-console help links, ChatGPT/Spotify launch shortcuts, and optional secondary document import/export helper libraries. If those optional helpers are offline, Sutra should fail gracefully and keep the workspace in memory.

---

## 6. Document Background images are local

A note's **Document Background** is stored as image data on the page itself
(an inline data URL), alongside your other content on your device. It is never
uploaded by Sutra and only leaves your device if **you** export a backup or a
note that includes it. A **locked page never reveals its background behind the
PIN screen.** See [`DOCUMENT_BACKGROUNDS.md`](../features/DOCUMENT_BACKGROUNDS.md).

---

## 7. Locked pages

Sutra can **PIN-lock individual pages.** A locked page requires the PIN to be
re-entered after a reload - the in-session "unlocked" state is intentionally
**not persisted** - and its content (including any Document Background) stays
gated behind the lock screen. The lock is part of the page's stored data and
travels in backups, so a restored page is still locked.

The same in-session authorization gate protects every page-owned plaintext
surface. Until the page is unlocked, Sutra does not hydrate its body into the
editor DOM or expose its body, Canvas model, Slides deck, version previews, or
derived excerpts to search, backlinks, review generation, Canvas, Slides,
Assistant context, plugins, or document export. Titles and lock status remain
visible so the student can find and unlock the page.

An unlocked page can optionally be given a separate **duress deletion PIN**.
Setup requires entering it twice, acknowledging the destructive behavior, and
using a value different from the normal page PIN. The raw value is never stored;
Sutra keeps one salted, high-cost verifier. Entering that alternate PIN on the
lock screen removes the page and its sub-pages without a trigger-time
confirmation, including their entries in Sutra Trash and local in-app workspace
snapshots. A normal PIN always unlocks and an incorrect PIN never deletes.

The locked-page screen includes **Set up duress PIN**. Enter the normal page PIN
there first; after authorization, Sutra opens the destructive-PIN form directly.
This makes setup discoverable without allowing anyone who lacks the normal PIN
to configure or weaken the page lock.

The setup hint includes an in-app **What is a duress PIN?** explainer. It makes
the general concept and Sutra's specific local behavior clear without opening an
external site: the alternate PIN does not unlock the page or contact emergency
services, and its destructive action has no trigger-time confirmation.

This is best-effort deletion from the active browser workspace, not a promise of
physical secure erasure. Downloaded backups, cloud snapshots, browser/device
backups, or another device that has not synchronized may still contain older
copies. Duplicating a locked page never copies its duress verifier; each copy
must be configured deliberately.

---

## 8. How to export and own your data

By default, **you** hold the master copy. From **Settings -> Data** you can export
your whole workspace as a portable file:

- **`.sutra`** - the default backup format, a password-encrypted package of your
  workspace plus its assets (with checksums).
- **JSON** - a single-file projection with assets inlined.

Both round-trip your data so you can move between browsers or machines, or keep
offline copies. Legacy **`.atelier`** backups still import, so older archives are
never stranded. Full details - package structure, what travels, and recovery -
are in [`DATA_AND_BACKUPS.md`](./DATA_AND_BACKUPS.md).

Optional Google Drive sync is a convenience layer. It encrypts complete Sutra
snapshots in your browser before uploading them to Drive `appDataFolder`, uses
only the `https://www.googleapis.com/auth/drive.appdata` scope, and runs while
the app is open, online, unlocked, and authorized.

**Sutra Cloud** is a second optional convenience layer for encrypted cloud backup
+ restore across devices. It is **provider-based** and **off by default**, lives
in the save bar, and only does anything after you choose a destination, connect
it, and press a button:

- **You choose the destination.** Recommended: download an encrypted file into a
  folder that already syncs, or use Google Drive when it is configured and
  working. Advanced: OneDrive, Dropbox, WebDAV (Nextcloud/ownCloud),
  S3-compatible storage, Supabase, or a custom HTTP endpoint. Manual: download
  the encrypted file and save it anywhere.
  Sutra does **not** require a central backend of its own for backups.
- The destination choice and any provider credentials are **device-local** (via
  `SutraSafeStorage`) and **never travel inside a `.sutra` backup**. Advanced
  providers are *more user-controlled, not automatically safer*, and custom
  providers are the user's responsibility.
- Each backup is a standard **password-encrypted `.sutra` file**, encrypted **on
  your device before upload**. The selected destination stores only the **locked
  file** plus a little non-sensitive metadata (label, size, timestamp) — it can
  never read your workspace.
- For account-based destinations, your **sign-in identity** (e.g. your email) is
  the personal data that provider sees. Your backup **passphrase is never sent** —
  lose it and the cloud copy is unrecoverable, which is the price of true
  end-to-end encryption.
- **Restore replaces** your current workspace (it is a backup, not a live merge),
  and you confirm before it overwrites. Sutra keeps your **last 10** backups.
- Optional **auto-backup** is itself off by default and only runs after you
  explicitly enable it.

Keep your backups somewhere you trust: encrypted `.sutra` backups still depend
on the password you choose, and JSON exports are unencrypted. Neither contains
your API keys, which are never exported.

---

## 9. How to fully wipe your data

Because everything is local, wiping Sutra is a matter of clearing this site's
local storage:

1. **Export a backup first** (Settings -> Data) if you might want your data back -
   once cleared, it is gone, as there is no server copy.
2. In your browser's site-data controls (for example DevTools -> Application ->
   **Clear storage**, or the browser's per-site "clear data" option), clear the
   storage for the Sutra page. This empties the IndexedDB databases
   (`noteflow_atelier_db`, `noteflow_attachments_db`) and the localStorage keys.
3. Reload. Sutra comes back **empty / at defaults**, as a fresh workspace.

Session-only items such as API keys and the compatibility copy of the active
chat clear automatically when the browser session ends. When **Save chat
history** is enabled, visible managed conversations remain in local storage
until you clear them; encrypted backups include them by default and plaintext
recovery includes them only by explicit opt-in.

> Tip: if Sutra ever misbehaves and you only want to disable custom CSS and
> plugins **without** deleting anything, use **Safe Mode** instead of wiping -
> add `?sutraSafeMode=1` to the URL (or hold **Shift** while loading). Safe Mode
> **never deletes** data, CSS, plugins, or your workspace.

---

## 10. Privacy at a glance

| Question | Answer |
|---|---|
| Is there a Sutra server storing my data? | No. Static app, no Sutra backend. Optional Drive sync and an optional provider you choose store only **browser-encrypted** snapshots in your account or destination — the provider never sees plaintext. |
| Do I need an account? | No. |
| Does Sutra track me / send telemetry? | No. |
| Where does my workspace live? | Locally - IndexedDB + localStorage in your browser. |
| Do AI requests go through Sutra? | No. Browser -> the provider you choose. Sutra runs no model servers. |
| Are my API keys saved or exported? | By default they are session-only. If you opt in to remembering them, they are encrypted on this device only; they are never exported or synced. |
| Does the local Intelligence layer call a server? | No. It computes signals on-device. |
| Can I take my data with me? | Yes - export encrypted `.sutra` or JSON; legacy `.atelier` still imports. |
| Can I delete everything? | Yes - clear this site's storage; nothing remains on any server. |

---

## 11. Offline behavior and deployment headers

**What is guaranteed offline.** Your *data* is fully local: once Sutra has
loaded, reading and editing your workspace, manual `.sutra`/JSON backup and restore, and
the on-device Sutra Intelligence layer all work with **no network at all**. A
locally-saved copy of the app (the `Sutra.html` file and its assets opened from
disk) also opens offline every time.

**Hosted offline reopen.** Over `http(s)`, Sutra registers a small service worker
that precaches the static app shell and core local assets. It caches **only
same-origin static files** — never workspace data, exports, provider requests,
or cross-origin requests. A fresh version waits until you choose **Reload safely**
in the visible update prompt, so it never replaces an open workspace underneath
you. `file://` remains service-worker-free by browser design and continues to
open the local app directly. Keep encrypted backups as your durable recovery
copy; Google Drive sync, AI provider calls, and optional online helpers still
need a network when you choose to use them.

**Deployment & response headers.** Sutra ships the strongest practical
**meta-tag** Content-Security-Policy in every HTML entry point (it scopes
`script`, `style`, `connect`, `frame`, `img`, etc.). However, some hardening
directives are **header-only** and cannot be set from a `<meta>` tag - most
notably **`frame-ancestors`** (clickjacking/framing protection). **GitHub Pages
cannot send custom response headers**, so on Pages those header-only protections
are unavailable; this is a real, documented limitation, not something the meta
CSP solves.

If the public beta needs header-level CSP or `frame-ancestors 'none'`, deploy
behind a host that can send response headers - e.g. **Cloudflare Pages**,
**Netlify** (`_headers`), or an **Nginx/Caddy** front - and emit, at minimum:

```
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The local dev server (`scripts/serve-static.mjs`) already sends a full CSP
**including `frame-ancestors 'none'`**, so this behavior can be verified locally.
**Recommendation:** GitHub Pages is fine for the controlled beta; moving to a
header-capable host is advised before a wider public launch.
