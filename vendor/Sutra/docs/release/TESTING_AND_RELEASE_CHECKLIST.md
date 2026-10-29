# Testing & Release Checklist

This is the pre-release checklist for **Sutra**. It combines the automated guards
(Node scripts that run without a DOM) with a manual QA matrix, legacy-compatibility
checks, the document-background round-trip, accessibility checks, and a final
sign-off.

The latest audit-remediation evidence is recorded in
[Audit Remediation Release Certification — 2026-08-30](./AUDIT_REMEDIATION_CERTIFICATION_2026-08-30.md).

Sutra is **local-first** - a static web app with no backend. The automated checks
therefore verify the **shipped source** (export/import wiring, persistence parity,
feature hooks) rather than spinning up a server.

---

## 1. Automated test commands

Run all of these from the repository root with Node. They are fast and require no
browser.

| Command | What it guards |
| --- | --- |
| `node scripts/smoke-check.mjs` | Structural integrity of the app: export/import wiring, encrypted `.sutra` envelope constants, iOS-safe file pickers, Drive `appDataFolder` scope/metadata guards, settings save/apply wiring, and key feature hooks. Runs text-level assertions; does not execute the app. |
| `node scripts/round-trip-check.mjs` | Save/export/import/sync **field parity**. Validates exact field names and classifications across workspace defaults, the inventory, serializer/import, sync protocol/projection, nested durable contracts, secret exclusions, and every localStorage decision. It deliberately does not rely on field counts. |
| `node scripts/sutra-supabase-schema-check.mjs` | Supabase migration order, the final four exact-path `sync-assets` policies, active-session predicates, non-destructive migration scope, `rls_auto_enable()` browser-role revocation, preserved owner access, and unchanged Sync/backup permissions. |
| `node --test tests/unit/sync-parity.test.mjs` | Runs the canonical synthetic everything-workspace through actual projection/diff/merge/reconstruction, reports field-level diffs, validates Assistant durable contracts and inventory fixture coverage, and proves reverse incremental update/delete/reorder/empty behavior. |
| `node scripts/version-history-check.mjs` | Notes **Version History** semantics. Extracts the pure version-history helpers and executes them: legacy snapshots normalize without clobbering, rich snapshots capture only the selected editable fields (never secrets), values are deep-cloned, duplicates suppressed / forced snapshots kept, history bounded to the cap, restore recovers state while leaving lock/identity untouched, throttle reads persisted timestamps, and nested history survives JSON round-trip. |
| `node scripts/sutra-docbg-check.mjs` | **Document Backgrounds.** Executes `normalizeDocumentBackground()` to prove the blur (0-32px) and dim (0-80%) clamps and image validation behave, and statically confirms the render engine, **locked-page gating**, duplicate-copy, and export wiring are present - including that the background rides the existing recursive inline-asset extraction used for `.sutra` / `.atelier` / JSON export. |
| `node scripts/sutra-rebrand-check.mjs` | **Rebrand guard.** Verifies the NoteFlow Atelier -> Sutra rebrand is consistent across the shipped files (user-facing names, entry points, and renamed assets) while the retained legacy identifiers are left intact. |
| `node scripts/sutra-responsive-check.mjs` | **Responsive guard.** Statically verifies the responsive structure (breakpoints / mobile affordances) expected across the supported viewport range. See [MOBILE_AND_RESPONSIVE_BEHAVIOR.md](../features/MOBILE_AND_RESPONSIVE_BEHAVIOR.md). |
| `node --check src/core/app.js` (and each `src` JS file) | **Syntax check.** Parses each source file so a syntax error can't ship. Run it on `src/core/app.js` and every file under `src/features/*.js` and `src/ui/*.js`. |

There is also a browser-side QA harness, `scripts/sutra-persistence-qa.js`, for
manual persistence verification inside a running app (load it in the browser
console / page rather than via Node).

> Tip: run the Node scripts together and treat any non-zero exit as a release
> blocker.

```sh
node scripts/smoke-check.mjs
node scripts/round-trip-check.mjs
node scripts/sutra-supabase-schema-check.mjs
node scripts/version-history-check.mjs
node scripts/sutra-docbg-check.mjs
node scripts/sutra-rebrand-check.mjs
node scripts/sutra-responsive-check.mjs
# syntax-check every src JS file, e.g.:
node --check src/core/app.js
```

---

## 2. Manual QA matrix (viewport x surface)

Open `Sutra.html` and walk each surface at each width using a browser device
toolbar. Confirm: no horizontal page scroll, nothing clipped, all primary actions
reachable, modals scroll internally with actions above browser chrome, and touch
targets meet **>=44px** (primary) / **>=40px** (constrained).

Widths: **1440, 1280, 1024, 900, 768, 640, 480, 390, 360, 320**.

| Surface v \ Width -> | 1440 | 1280 | 1024 | 900 | 768 | 640 | 480 | 390 | 360 | 320 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile navigation / view menu | | | | | | | | | | |
| Today / Focused Today | | | | | | | | | | |
| Timeline | | | | | | | | | | |
| Notes (list + editor) | | | | | | | | | | |
| Page Mode | | | | | | | | | | |
| Split view | | | | | | | | | | |
| Document backgrounds (+ modal) | | | | | | | | | | |
| Sutra Assistant + badge | | | | | | | | | | |
| Homework | | | | | | | | | | |
| AP Study | | | | | | | | | | |
| Testing Hub | | | | | | | | | | |
| Review | | | | | | | | | | |
| College | | | | | | | | | | |
| Life | | | | | | | | | | |
| Projects & Work | | | | | | | | | | |
| Settings | | | | | | | | | | |
| Customization (CSS / plugins) | | | | | | | | | | |
| Backup / restore | | | | | | | | | | |
| Onboarding (Sutra Setup) | | | | | | | | | | |
| Help & Docs | | | | | | | | | | |

Also verify the **landing page** (`HomePage.html`) thread-story: desktop animation,
the simplified vertical thread on mobile, and the static final state with reduced
motion / JavaScript disabled.

---

## 3. Legacy-compatibility checks

Sutra never breaks old data. Verify each:

- [ ] **Old data loads.** A workspace created by a previous (NoteFlow Atelier) build
      opens cleanly, with content intact and no console errors. (Internal storage
      names such as the IndexedDB databases and `hwCourses:v2` / `hwTasks:v2`
      localStorage mirrors are intentionally retained as legacy-named compatibility
      identifiers.)
- [ ] **`.atelier` import.** A legacy `.atelier` backup imports through the same
      package importer as `.sutra` - the validator accepts both the `sutra-workspace`
      and legacy `noteflow_atelier_project` manifests.
- [ ] **Encrypted `.sutra` import/export.** A new `.sutra` starts with `SUTRAENC`, is not directly parseable as ZIP, hides sentinel note/settings/asset text, decrypts with the correct password, and rejects wrong passwords/tampering without mutating the current workspace.
- [ ] **Legacy plaintext `.sutra` import.** An older unencrypted ZIP-style `.sutra` still imports through the same package importer.
- [ ] **iOS Files picker.** The workspace input and plugin input have no restrictive proprietary-extension `accept` filter; validation happens after selection in JavaScript.
- [ ] **`.atelier-plugin` import.** A legacy `.atelier-plugin` bundle imports
      alongside the new `.sutra-plugin` extension; runtime-capable plugins arrive
      **disabled** with re-review required.
- [ ] **`?atelierSafeMode=1`.** The legacy Safe Mode query parameter still launches
      Safe Mode (as does the canonical `?sutraSafeMode=1` and holding **Shift** while
      loading). Confirm custom CSS and plugins are skipped and **nothing is deleted**.
- [ ] **Secrets excluded.** Export a workspace that has an API key configured and
      confirm **no API keys / provider credentials / tokens** appear anywhere in the
      exported file (provider API keys are session-only). The activity-log key
      (`sutra:activityLog:v1`, migrated from `flow:activityLog:v1`) is **not** a
      secret and may appear.

---

## 4. Document-background round-trip

Verify the per-page background survives a full export/wipe/restore cycle and respects
locking:

1. Open a note; from the editor toolbar open **Document Background** (landscape icon).
2. **Upload** a valid image (`.png` / `.jpg` / `.jpeg` / `.webp`, <=6 MB). Confirm the
   preview + filename appear and the background renders behind the note.
3. Set **Background Blur** (0-32px) and **Dim Background** (0-80%); confirm only the
   image blurs and text stays readable; the numeric values update.
4. Confirm rejection of a zero-byte / non-image / corrupt file is **non-destructive**
   (a toast, the existing background unchanged).
5. Confirm it renders in **standard editor, Page Mode, and split view**, on light,
   dark, and a custom theme.
6. **Duplicate the page** -> the copy carries the same background.
7. **Lock the page** (PIN) -> the background is **not** shown behind the PIN screen.
8. **Export** the workspace (`.sutra`), then **wipe** local data, **import** the
   backup, and **reload**. The background, blur, and dim come back intact (packaged as
   an `assets/` file with a checksum).
9. Repeat step 8 with a legacy **`.atelier`** export to confirm cross-format parity.
10. Check **note export** behavior: HTML includes the background where feasible; PDF
    preserves it where browser printing allows; **Markdown and plain text omit it
    cleanly**; treat DOCX/RTF as a known limitation if not reliably supported.

(`node scripts/sutra-docbg-check.mjs` covers the clamp/validation and export-wiring
portions of the above automatically.)

---

## 5. Accessibility checks

- [ ] **Keyboard navigation** reaches all interactive controls; focus order is sane.
- [ ] **Visible focus** ring on every focusable control.
- [ ] **ARIA labels** present on icon-only controls; the **Sutra Intelligence badge**
      exposes its explanatory text as both tooltip (hover/tap/focus) and `aria-label`.
- [ ] **Reduced motion** respected (OS setting); landing scrollytelling shows the
      final connected state with no pinned dead zones.
- [ ] **JS-disabled** fallback: the landing page shows the final connected thread
      state.
- [ ] **200% zoom** keeps layouts usable.
- [ ] **Color contrast** is adequate across Default, Dark, Retro, and custom themes,
      including the document-background dim overlay keeping text legible.
- [ ] **Touch targets** >=44px primary / >=40px constrained.

---

## 6. Release sign-off

Do not ship until every box is checked.

- [ ] All **automated scripts** in section 1 pass (exit 0), including `node --check` on every
      `src` JS file.
- [ ] **Manual QA matrix** (section 2) walked at all listed viewports with no horizontal
      overflow, clipping, or unreachable actions.
- [ ] **Legacy compatibility** (section 3) verified: old data, `.sutra` + `.atelier` import,
      `.sutra-plugin` + `.atelier-plugin` import, `?atelierSafeMode=1`, secrets
      excluded.
- [ ] **Document-background round-trip** (section 4) verified, including locked-page gating
      and cross-format parity.
- [ ] **Accessibility** (section 5) verified.
- [ ] **Rebrand** is consistent: user-facing copy says **Sutra**; entry point is
      `Sutra.html`; renamed assets (`styles/themes/sutra-pro.css`, etc.) are referenced;
      retained legacy identifiers (`.atelier` format names, internal DB names,
      `data-atelier-*` / `atelier-*` code identifiers) are intentionally left intact.
- [ ] **No secrets** in any exported artifact.
- [ ] **Optional Google Drive sync** is off by default, requests only `https://www.googleapis.com/auth/drive.appdata`, uploads encrypted bytes to `appDataFolder`, stores no token/passphrase/key, handles wrong password and conflict non-destructively, and leaves local saving functional during Drive failure.
- [ ] **No console errors** on load or while exercising the key surfaces.
- [ ] Docs reviewed: [CSS_MODS_GUIDE.md](../features/CSS_MODS_GUIDE.md),
      [MOBILE_AND_RESPONSIVE_BEHAVIOR.md](../features/MOBILE_AND_RESPONSIVE_BEHAVIOR.md),
      [MODS_AND_CUSTOMIZATION.md](../features/MODS_AND_CUSTOMIZATION.md),
      [PLUGIN_SDK.md](../features/PLUGIN_SDK.md),
      [HANDWRITING_AND_DRAWING.md](../features/HANDWRITING_AND_DRAWING.md).

---

## 7. Public-Beta Hardening Addendum

Run these additional repository-level guards before public beta:

```sh
npm run check:csp
npm run check:persistence
npm run check:modal
npm run check:network
npm run test:e2e
npm run test:e2e:sync
```

`npm run test:e2e` runs Chromium, Firefox, and WebKit Playwright projects for startup, CSP presence, quota/IndexedDB failure handling, retry recovery, banner persistence, last-saved transitions, encrypted/emergency `.sutra` export, missing-attachment export refusal, legacy import, iOS picker hardening, mocked Google Drive sync, modal keyboard behavior, and reduced-motion startup.

`npm run test:e2e:sync` is the focused Chromium release gate for Sutra Sync:
two isolated browser devices, bootstrap, online/offline convergence,
real Notes UI title/body and block-level merging, one hidden/deduplicated
overlapping conflict, synchronized resolution, conservative legacy-artifact
cleanup, delete-versus-edit, encrypted assets, multi-tab
single-flight/status relay, zero sync traffic while disabled, and the configured
Supabase UI/auth contract against a synthetic mock backend. The everything-
workspace case additionally forces snapshot-only bootstrap, compares every
canonical projected record, checks portable localStorage mirrors and live
Assistant hydration, verifies ciphertext-only stored bodies, applies reverse
changes across major product areas, replaces attachment bytes, and reloads both
locked devices. It does not replace real-project RLS hostile tests before first
production activation.
The suite also uses the actual Assistant composer (not parity setters) to prove
canonical conversation/message/citation/receipt sync in both directions and
reload after a deliberately stale legacy mirror. Its revoke-and-wipe case takes
a two-tab target offline, proves immediate server denial with local data still
present, reconnects, verifies project/user/device-bound wipe status, audits all
six Sutra databases plus local/session storage as empty, observes server
acknowledgement, and reloads both tabs into the fail-closed revoked screen.
Before real-project revocation QA, apply
`supabase/migrations/20260716_device_revoke_wipe.sql`; never infer wipe behavior
from a generic 401/403 or from the mock alone.

`tests/e2e/sutra-cloud-providers.spec.mjs` is the separate point-in-time backup
provider gate. Its Supabase mock must cover successful object + index creation,
upload failure without index/DELETE, index failure with exact-path rollback,
rollback failure as secondary diagnostic context, idempotent object-not-found,
attempt-path isolation, existing-backup preservation, and ciphertext/diagnostic
secret exclusion. This gate tests Supabase backup behavior, not incremental
Sutra Sync.

**Recorded manual real result (2026-07-18):** after applying that migration, the
project operator revoked Device B from Device A on the configured Supabase
project. Device B wiped only after reconnecting, reload did not resurrect its
workspace, and reuse required fresh authentication/device registration. Keep
this distinct from the still-required gated Account A/B hostile isolation and
payload-inspection harness.

For credential-safe live conflict certification, run the current local server
and then:

```powershell
$env:SUTRA_REAL_CONFLICT_CERTIFY='1'
$env:SUTRA_REAL_BASE_URL='http://127.0.0.1:5173/Sutra.html'
npx playwright test tests/e2e/real-supabase-conflict-certification.spec.mjs --project=chromium --workers=1 --headed
```

The operator enters OTPs and vault passphrases only in the headed browser
windows. A readiness timeout is not a pass and must be reported separately
from merge assertions.

For credential-safe real-project certification, run from an interactive desktop:

```powershell
$env:SUTRA_REAL_CERTIFY='1'
$env:SUTRA_REAL_BASE_URL='http://127.0.0.1:5173/Sutra.html'
npx playwright test tests/e2e/real-supabase-certification.spec.mjs --project=chromium --workers=1 --headed
```

Use the same Account A in the two A windows and a different Account B in the
hostile-isolation window. OTPs and vault passphrases are entered only in those
windows. The harness verifies the live wipe columns/RPC response contract,
public and authenticated REST/RPC/Storage isolation, ciphertext payloads,
bidirectional Assistant history plus stale-mirror reload, encrypted attachment
transfer, offline next-contact revoke/wipe across two tabs, wipe acknowledgement,
reload non-resurrection, and fresh device registration/bootstrap. It is gated
and skipped by default so ordinary CI never targets a real project or waits for
human authentication.

For the current manual Account A/B certification sequence, use
[`SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md`](./SUPABASE_ACCOUNT_ISOLATION_CHECKLIST.md)
after applying the ordered chain through
`supabase/migrations/20260730_sync_storage_path_and_function_permissions.sql`. The
repository has static policy/RPC/transport checks, but only the operator can
record real authenticated REST, RPC, Storage, and ciphertext-metadata denial
evidence. Do not copy a browser token, passphrase, key, or payload body into
the release record.

The consolidated operator handoff for Account A/B, same-profile switching,
plaintext inspection, attachments, revoke/wipe, backup rollback, full parity,
and deployed/mobile/cross-browser acceptance is
[`SUPABASE_MANUAL_ACCEPTANCE_2026-07-30.md`](./SUPABASE_MANUAL_ACCEPTANCE_2026-07-30.md).

Static HTML CSP cannot safely express every deployment control. Hosts should also
set a real hosting header with at least `frame-ancestors 'none'` because meta CSP
cannot enforce `frame-ancestors`. Keep that hosting header in sync with the app
meta policy if additional approved origins are added.

Fresh startup with Sutra Sync disabled, manual encrypted `.sutra` backup, and
JSON backup should complete with zero third-party requests. User-triggered
remote calls that remain justified are: optional Sutra Sync/Supabase,
Google Drive OAuth/sync, Sutra Assistant provider calls, configurable
localhost/127.0.0.1 local endpoints, approved feedback-form embeds, approved
media embeds (YouTube, Vimeo, Spotify, SoundCloud, CodePen, Figma, and YouTube
thumbnails), AP Classroom resource links, AI-console help links,
ChatGPT/Spotify launch shortcuts, and optional secondary document import/export
libraries with graceful offline errors.

Physical-device QA is not automated and must not be fabricated. Before public beta,
record actual results for:

- [ ] iPhone Safari, portrait and landscape: startup, save banner, encrypted export modal, import picker selecting `.sutra`, optional Drive sync status, Storage Health, Sutra Assistant disclosure, and bottom-sheet modal behavior.
- [ ] Android Chrome, portrait and landscape: same flows.
- [ ] Tablet Safari or Chrome: same flows plus split view and large modals.
- [ ] Reduced-motion enabled on one physical device.
- [ ] Offline launch from an already-cached local/static copy, noting any browser
      limitations honestly.

## 8. Production response-header verification

The current production host is GitHub Pages. It is intentionally retained as a
static host, so the repository documents and accepts its inability to emit
custom response headers. Before a release, perform the read-only HTTPS `HEAD`
check documented in [`security-headers.md`](../security-headers.md) against the
production `Sutra.html` URL and record any host-policy change. The current
baseline is `200` with HSTS only; response-header CSP, MIME-sniffing,
referrer, and framing protections are unavailable there. The meta CSP remains
required in every HTML entry point. A header-capable host or reverse proxy is a
separate deployment decision and must not be introduced implicitly by this
checklist.
