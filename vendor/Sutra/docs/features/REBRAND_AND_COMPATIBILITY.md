# Rebrand & Compatibility

**NoteFlow Atelier is now Sutra.** Same private, local-first student workspace - new name, refreshed surface. This document explains exactly what changed, what stayed the same, and how your existing data carries over.

> **TL;DR** - Your existing browser data loads automatically. `.sutra` is the new default backup; `.atelier` still imports. Nothing of yours breaks. Before you upgrade, **export a backup** (see [Before you upgrade](#before-you-upgrade)).

---

## What changed, what didn't

| Area | Before (NoteFlow Atelier) | Now (Sutra) | Compatibility |
| --- | --- | --- | --- |
| Product name | NoteFlow Atelier | **Sutra** | Cosmetic. |
| Your browser data | IndexedDB / localStorage | *Unchanged* | **Loads automatically** - internal DB names intentionally retained. |
| Default backup | `.atelier` | **`.sutra`** | `.atelier` still imports. |
| Plugin bundle | `.atelier-plugin` | **`.sutra-plugin`** | `.atelier-plugin` still imports. |
| Safe Mode URL | `?atelierSafeMode=1` | **`?sutraSafeMode=1`** | Legacy param still works. |
| App file | `NoteflowAtelier.html` | **`Sutra.html`** | See [file renames](#file-renames). |
| Assistant globals | `flowAssistant` / `flowIntelligence` | **`sutraAssistant` / `sutraIntelligence`** | Legacy globals retained. |
| Activity log key | `flow:activityLog:v1` | **`sutra:activityLog:v1`** | Auto-migrated. |

**NoteFlow Classic** is a *separate* legacy app and is **not** part of this rebrand. It keeps its own name.

---

## Your existing data loads automatically

You do **not** need to export and re-import to keep your workspace. Sutra reads the same browser storage NoteFlow Atelier wrote.

The internal storage identifiers are **intentionally retained** so existing data keeps loading without a migration step. You may still see these historical names in browser devtools - they are **legacy-named compatibility identifiers**, not a sign that anything still calls itself "Atelier":

- **IndexedDB** - `noteflow_atelier_db` (workspace; stores `workspace` / `root`) and `noteflow_attachments_db` (store `blobs`; course and file binaries).
- **localStorage mirrors** - `hwCourses:v2` and `hwTasks:v2`.

Renaming these would have orphaned every existing user's data, so they were deliberately left as-is.

---

## Backups: `.sutra` is the new default, `.atelier` still imports

**`.sutra`** is now the default export format. Files are named `sutra_workspace_<YYYY-MM-DD>_<HH-mm-ss>.sutra` (local-timezone date and time). New exports are password-encrypted `SUTRAENC` binary envelopes; inside the ciphertext is the same complete package with `manifest.json`, `workspace.json`, `assets/`, `metadata/`, and checksums. Renaming a new `.sutra` to `.zip` should not expose workspace contents. The internal manifest still identifies Sutra:

```json
{
  "product": "Sutra",
  "format": "sutra-workspace",
  "formatVersion": 1,
  "legacyCompatible": true,
  "appName": "Sutra"
}
```

**Legacy unencrypted `.sutra` and `.atelier` backups still import.** The import validator accepts **both** the new `sutra-workspace` manifest and the legacy `noteflow_atelier_project` manifest, and the import dispatcher routes both `.sutra` and `.atelier` files to the same package importer. **Old backups are never broken.** You can keep restoring any `.atelier` file you exported under the old name.

**Never exported, in any format:** API keys, provider credentials, tokens, backup passwords, cloud sync passwords, OAuth tokens, and derived keys. API keys are session-only by default; explicitly remembered credentials remain encrypted and device-local. Drive access tokens and derived sync keys are memory-only. The assistant activity log is not a secret and does travel in backups.

---

## Plugins: `.sutra-plugin` is new, `.atelier-plugin` still imports

The new plugin export extension is **`.sutra-plugin`**. Existing **`.atelier-plugin`** bundles still import unchanged. Plugins remain local bundles only (no marketplace), run **sandboxed in an iframe** behind an explicit permission allowlist, install **disabled**, and are **reviewed before they run**. On import to a new device, runtime plugins return disabled and require re-review.

> The bundled example plugin, `examples/plugins/study-helper.atelier-plugin`, uses the legacy extension and imports fine - no need to repackage it.

---

## Safe Mode: `?sutraSafeMode=1` is canonical, `?atelierSafeMode=1` still works

Safe Mode loads Sutra with **no custom CSS and no plugins**, and **never deletes** data, CSS, plugins, or workspace. Enter it any of these ways:

- Add **`?sutraSafeMode=1`** to the URL *(canonical)*.
- Add **`?atelierSafeMode=1`** to the URL *(legacy - still works)*.
- Hold **Shift** while the app loads.
- Use the in-app **Recovery** controls.

---

## File renames

| Old path | New path |
| --- | --- |
| `NoteflowAtelier.html` | `Sutra.html` |
| `styles/atelier-pro.css` | `styles/sutra-pro.css` |
| `scripts/atelier-persistence-qa.js` | `scripts/sutra-persistence-qa.js` |
| `docs/atelier-save-systems-audit.md` | `docs/sutra-save-systems-audit.md` |

The landing page (`HomePage.html`) and the `index.html` redirect keep their names. If you had a bookmark to `NoteflowAtelier.html`, update it to **`Sutra.html`**.

---

## Repository and Pages links

The GitHub repository is now expected to live at `tanujranjith/Sutra`. Documentation,
package metadata, and GitHub Pages instructions should use the Sutra repository name.
If a local checkout still points at `tanujranjith/NoteFlow-Atelier`, update the
`origin` remote before publishing.

The public social-card metadata now points to
`assets/brand/sutra/generated/social-preview.png`, a repository-generated
`1200x630` image derived from the approved Sutra brand assets.

---

## Window globals & the activity-log key

The canonical runtime globals are now **`sutraAssistant`** (the contextual chat panel) and **`sutraIntelligence`** (the local `deriveStudentContext` signal layer). The legacy globals **`flowAssistant`** and **`flowIntelligence`** are **retained** so any existing snippet, plugin, or bookmarklet that referenced them keeps working.

The assistant activity log moved from **`flow:activityLog:v1`** to **`sutra:activityLog:v1`**, and the old key is **migrated automatically** - your applied-action history (with undo) carries over.

---

## Before you upgrade

The upgrade is non-destructive and your data loads automatically - but a current backup is cheap insurance.

1. Open your existing app and go to `Settings -> Data`.
2. **Export a backup** (`.sutra`, or `.atelier` if you're still on the old build). Save it somewhere safe.
3. Then open **`Sutra.html`**. Your workspace will already be there.

> Always keep a recent backup before any major change. Optional Google Drive sync can keep an encrypted app-data snapshot, but a recent encrypted `.sutra` file you control is still the safety net.

---

## Recovery

If anything looks off after upgrading:

- **The UI looks broken** - load **Safe Mode** (`?sutraSafeMode=1`, hold **Shift** at load, or the in-app Recovery button). This skips all custom CSS and plugins without deleting anything, so you can disable the offending snippet or plugin and reload normally.
- **An import went wrong** - Sutra writes a **pre-import safety snapshot** before every workspace import. Restore it from `Settings -> Data -> Storage Health`.
- **Your data didn't appear** - confirm you opened Sutra in the **same browser and profile** where you used NoteFlow Atelier (browser storage is per-browser, per-profile, per-origin). If you switched browsers or machines, import your most recent `.sutra` or `.atelier` backup.
- **The assistant lost its key** - that's expected. Re-enter it for this browser session; credentials are never persisted or exported.

For the full backup/format reference, see the [README](../../README.md) and [CHANGELOG](../release/CHANGELOG.md).
