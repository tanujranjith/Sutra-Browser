# Supabase manual acceptance checklist — 2026-07-30

Use disposable accounts and synthetic data only. Enter OTPs, vault passphrases,
and recovery material directly in Sutra or Supabase; never place them in a
report, screenshot, issue, log, or chat. Capture only redacted methods, statuses,
field classifications, timestamps, counts, and path-shape comparisons.

| Test | Action | Expected result | Evidence to capture | Blocking failure |
| --- | --- | --- | --- | --- |
| Account A/B isolation | In isolated contexts, create synthetic A data, sign in as B, and probe A tables, RPC-owned records, devices, backups, conflicts, wrapped key, and asset paths. | B sees and mutates only B state; direct sync-table access and A device revocation are denied. | Account labels, request method/status, row/object counts, no identifiers or payloads. | Any A content/metadata visibility, mutation, or device control from B. |
| Same-browser account switch | Sign out A, sign in B in the same profile, then inspect Sync state before enabling/unlocking B. | Local workspace is preserved, cloud fails closed, and A device id, cursor, outbox, baseline, conflicts, vault, or assets are not reused for B. | Redacted status transitions and per-account state-presence booleans. | Any A operational state or cloud workspace sent/used under B. |
| Plaintext markers | Create distinct synthetic markers across Notes, folders, tasks, courses/exams, Assistant, Canvas, Slides, filename, and attachment text; sync; inspect remote tables and Storage metadata. | Only bounded routing metadata, hashes, IV/tag/ciphertext, and wrapped-key structure are readable. | Table/bucket, marker found yes/no, field classification. | Any readable workspace marker, private filename, attachment bytes, passphrase, or key material remotely. |
| Attachment lifecycle | Upload, download on a second device, retry identical bytes, replace, then delete. Try malformed, nested, uppercase, cross-account, and revoked-session paths. | Canonical `<uid>/<64 lowercase hex>` path only; same hash deduplicates; bytes decrypt correctly; malformed/cross-account/revoked requests fail. | Redacted method/status, path shape, hash equality, object/index counts. | Wrong bytes, filename/path leak, orphan, duplicate, or accepted hostile path. |
| Revoked-device assets/wipe | Revoke a disposable device while offline, reconnect it, and separately simulate ordinary sign-out, generic 401, timeout, and wrong-project responses. | Revoked session cannot read/write assets or RPCs; exact verified response wipes all tabs/stores and acknowledges; generic failures never wipe. | Status contract name/code, storage counts before/after, acknowledgement presence, reload result. | Premature/incomplete wipe, resurrection, missing wipe after verified revocation, or asset access after revoke. |
| Supabase backup rollback | Keep Storage allowed, block only `POST */rest/v1/backup_index*`, run backup, unblock, and retry. | Failed index triggers DELETE of exactly that attempt; no orphan/index/timestamp advance; prior backup survives; retry uses a new path and succeeds without DELETE. | Redacted method/status and equality/difference of opaque paths, counts, timestamp comparison. | False success, missing/wrong DELETE, orphan, prior-backup deletion, path reuse, or timestamp advance on failure. |
| Full data parity | With two isolated devices on one test account, create/edit/reload/delete every required workspace category, then test bootstrap, offline reconnect, conflict resolution, sign-out, and revoke/wipe. | Bidirectional persistence and deletion converge without duplicates/idle conflicts; one genuine overlap yields one durable review item; sign-out preserves local data. | Category-by-category result, redacted IDs/counts, conflict count/state, reload result. | Loss, cross-device mismatch, duplicate/storm, conflict-copy sidebar page, resurrected resolution, or incorrect wipe. |
| Deployed PWA, mobile, cross-browser | Publish only the verified artifact, then test production GitHub Pages/PWA in current Chromium, Firefox, Safari/WebKit, Edge, iPhone, Android, and tablet including offline/update behavior. | Runtime/cache identity matches the checked artifact; Sync/backup/Canvas/Slides/attachments work; no stale mixed cache or inaccessible mobile flow. | Deployment digest, URL, browser/device versions, cache/runtime version, redacted screenshots. | Artifact mismatch, stale runtime, hosted-only data defect, broken offline update, critical accessibility/overflow failure. |

Do not mark a row passed from local source behavior or a mocked backend. Deployed
PWA evidence applies only to the exact published artifact.

## Acceptance run - 2026-08-02

This section records the work actually completed during the local release run.
It intentionally separates live Supabase evidence from mocked/local evidence.
No public deployment or physical-device test was performed.

| Area | Result | Evidence and limitation |
| --- | --- | --- |
| Original-account recovery | Passed manually | After a safe backup, normal sign-out, local Sync reset, authentication, and vault unlock, the original workspace resumed Sync. No workspace deletion or vault replacement was performed. |
| Live Account A/B isolation | Pending | A disposable alias account was authenticated in an isolated Tanuj Chrome tab, but its vault was not enabled before the unattended boundary. No complete A/B REST/RPC/Storage/payload probe was claimed. |
| Same-browser account switch | Pending | The original-account recovery exercised sign-out/re-authentication, but not a complete two-account operational-state inspection in one profile. |
| Live plaintext markers | Pending | No complete exact-marker corpus was synchronized to the live backend. The mocked-backend parity test did verify that representative Note, Assistant, Slides, attachment, credential-shaped, and passphrase markers were absent from stored encrypted server state. |
| Live Supabase backup rollback | Passed | A Storage upload succeeded, the `backup_index` insert failed, Sutra reported failure, and the exact attempt-bound object was deleted. No new index row/orphan remained and the earlier backup remained. After restoring the required authenticated table privileges, a retry used a new object and indexed successfully. No raw path, ciphertext, token, or user content was retained in this report. |
| Automated portable parity | Passed | `npm run test:e2e:sync` passed all 14 scenarios: two-device convergence, real Notes merge/conflicts, legacy conflict cleanup, offline recovery, bootstrap/reload/Help preservation, attachments, full workspace parity, Assistant hydration, revoke/wipe, sign-out preservation, disabled-sync silence, multi-tab single flight, configured Supabase UI flow, and wrong-passphrase safety. |
| Pending wipe records | Pending | Historical inspection had identified two revoked devices awaiting acknowledgement. The Supabase tab was no longer open during the unattended phase, so no new read-only correlation was performed and no record/flag was deleted or cleared. |
| Deployment artifact | Passed locally | `.deploy` contained 199 allowlisted files (17.26 MB). Exact current runtime bytes were checked for Sync, account scoping, revoke/wipe, backup rollback, Assistant, Canvas, Slides, manifests, and the service worker. No tests, fixtures, SQL, source maps, private docs, synthetic acceptance markers, or secret-shaped Supabase credentials were present. Only the intended public Supabase project URL and publishable key were allowed. The artifact was not deployed. |

### Automated commands completed

- `node --test tests/unit/sync-store.test.mjs tests/unit/sync-engine.test.mjs tests/unit/sync-account-isolation.test.mjs` - 37 passed.
- Focused backup restore regressions - 2 passed.
- Focused complete portable parity regression - 1 passed.
- `npm run verify` with `PLAYWRIGHT_PORT=52180` - passed: all static checks, 352 unit tests, deploy build/check, 60 smoke browser tests, and 14 Sync browser tests.

### Findings retained for follow-up

- The Sync enable/reset recovery path can leave a generated local wrapped key after server rejection, and the internal test reset can clear a device identity while the authenticated server session remains bound to the old device. A production fix belongs in `src/core/app.js`; it was not edited in this dirty primary worktree because the required clean `core:worktree` procedure could not be satisfied safely.
- During the full parity reload, a caught Assistant startup warning showed an empty-chat persistence attempt before `appData` existed. Hydration and parity still passed, but the initialization ordering should be hardened in the same guarded core workflow.
- The backup browser fixture previously cloned the generated Help page as if it were a normal note. The fixture now clears the three Help identity fields, and `AGENTS.md` records the durable testing rule.

## Acceptance continuation - 2026-08-05

This continuation supersedes the status counts above where they differ. It was
performed against local commit `c4610cb` plus the preserved dirty working tree.
No deployment, push, production configuration change, destructive SQL, wipe
acknowledgement, or physical-device test was performed.

| Area | Current result | Evidence and limitation |
| --- | --- | --- |
| Live Account A/B isolation | Pending | Chrome contained only a local `file:` Sutra tab. The Chrome integration correctly refused to claim that restricted URL, so a new complete two-account REST/RPC/Storage/payload run could not be performed unattended. Previous partial sign-in evidence is not promoted to a pass. |
| Same-browser account switch | Pending | No new complete two-account operational-state inspection was possible without a claimable served Sutra tab and interactive authentication/vault entry. Automated account-scoping regressions passed. |
| Live plaintext markers | Pending | No live synthetic marker corpus was created in a real workspace during this continuation. Ciphertext-envelope, sensitive-field exclusion, exact asset-path, and mocked-server plaintext-marker regressions passed, but they do not replace live SQL/Storage inspection. |
| Supabase backup rollback | Passed from prior live evidence; regression passed now | The prior live attempt-bound upload/index/delete sequence remains valid. The current 24-test cloud-provider browser suite again proved exact rollback DELETE, no timestamp advance on failure, preservation of the earlier backup, and a distinct successful retry path. |
| Automated portable parity | Passed | The current `test:e2e:sync` run passed all 17 scenarios, including two-device convergence, full portable projection parity, attachments, Assistant hydration, Canvas/Slides/Help preservation, bootstrap/reload, offline recovery, conflict behavior, sign-out preservation, revoke/wipe, disabled-sync silence, multi-tab single flight, configured Supabase UI flow, and wrong-passphrase safety. |
| Pending wipe records | Reviewed; retained | Read-only structural SQL returned exactly two revoked, wipe-required, unacknowledged rows. Both were unlabeled and last seen on 2026-07-18, before this acceptance continuation. They cannot be conclusively tied to disposable sessions from this run, so no row or flag was changed. |
| Supabase Security Advisor | Reviewed; no errors | The Dashboard reported 0 errors, 18 warnings, and 0 informational findings. Seventeen warnings identify the intentionally authenticated `SECURITY DEFINER` `sync_*` RPC boundary; repository checks verify that these functions derive ownership from `auth.uid()` plus an active device session and that direct table access is denied. The remaining warning is project-wide leaked-password protection being disabled; changing that Auth setting requires an explicit operator decision. |
| Deployment artifact | Passed locally | `.deploy` contained 201 allowlisted files totaling 18,114,835 bytes. Exact source/artifact hashes matched for the app shell, Sync store/projection, Slides runtime, and service worker. The current Assistant, deterministic conflict handling, Canvas, Slides, Help reconciliation, account scoping, revoke/wipe, exact asset paths, device-session repair, and attempt-bound backup rollback code were present. No tests, fixtures, SQL, private docs, source maps, synthetic markers, or privileged secret shapes were found. The artifact was not deployed. |

### Current automated evidence

- `node scripts/sutra-supabase-schema-check.mjs` - passed; four ordered migrations, exact Storage paths, active-session predicates, and function ACLs verified.
- `npm run check:migrations` - passed.
- `npm run check:persistence` - passed.
- `npm run check:roundtrip` - passed; 53 workspace fields covered.
- `npm run check:guardrails` - passed.
- Focused Sync/Supabase unit selection - 95 passed.
- `npx playwright test --project=chromium --workers=1 sutra-cloud-providers` on port 5322 - 24 passed.
- `npm run verify` with `PLAYWRIGHT_PORT=5323` - passed end to end: 353 unit tests, 61 Chromium smoke tests, and 17 Chromium Sync tests, including a fresh deploy build/check.
- Direct `npm run test:unit` confirmation - 353 passed.

### Defect reconciliation

- The stale server-bound device-session failure described in the earlier run is
  fixed by local commit `c4610cb` (`fix: recover stale sync device sessions`).
  It now repairs only the recoverable missing/mismatched device-session cases,
  preserves fail-closed behavior for differing vault keys, stores replacement
  device identity atomically, and has focused unit and browser regression
  coverage. The full 17-scenario Sync suite passed after the fix.
- The earlier caught Assistant initialization warning did not produce a failed
  current release gate. No unsupported core workaround was added; a dedicated
  reproduction is still required before claiming a separate defect or fix.

### Still required before live cloud certification

The interactive continuation below completed the served-origin Account A/B,
same-profile, text-marker, and live Note-parity portions. The remaining work is:

1. Run the narrower hostile cross-account REST/RPC/Storage probes and complete
   the attachment upload/download/path lifecycle after Chrome file upload is
   enabled.
2. Repeat the live Supabase rollback interception only if a browser control
   surface can block `backup_index` without modifying production source.
3. If desired, explicitly decide whether to enable Supabase leaked-password
   protection; this is an Auth configuration change, not a code migration.
4. Retain the two historical wipe-required records unless an operator can
   conclusively identify them and explicitly approves cleanup.
5. After an eventual deployment, test the exact published PWA. iPhone testing
   remains deliberately outside this run.

## Interactive browser acceptance - 2026-08-05

This interactive continuation supersedes the live-browser rows above where
they differ. Sutra was served from the current repository on isolated local
origins (`127.0.0.1:5330`, `:5331`, and `:5332`) and operated through the Tanuj
Chrome profile. The operator entered every OTP and vault passphrase directly.
No secret, raw ciphertext, account identifier, authorization header, private
workspace value, or object path was retained in this report.

| Area | Result | Evidence and limitation |
| --- | --- | --- |
| Account A/B workspace isolation | Passed for the exercised live surfaces | Account A created synthetic Note, folder hierarchy, task, Assistant chat, Canvas, Slides, and text markers and synchronized successfully. An independently authenticated Account B origin bootstrapped its own workspace with no Account A marker. Account B's Devices and Conflicts views contained no Account A marker or control, and a distinct Account B note never appeared in the Account A local context. Direct hostile REST/RPC/Storage requests and attachment bytes were not exercised in this browser continuation, so the operator checklist remains required for those narrower probes. |
| Same-browser account switch | Passed | After Account A synchronized and signed out normally, Account B authenticated in the same origin. Account A's local workspace remained present, Sync stayed disabled, and Account B did not automatically unlock, push, or receive Account A cloud state. A separate clean Account B origin was used before enabling Sync, preventing mixed-workspace upload. |
| Plaintext marker inspection | Passed for synchronized text markers | A read-only Dashboard query returned zero exact-marker hits in `sync_ops`, `sync_snapshots`, `sync_vault_keys`, `sync_asset_index`, `backup_index`, and `storage.objects`. The query returned counts only and its temporary SQL text was overwritten with a harmless statement after execution. Attachment filename/content inspection remains pending because Chrome file upload was denied until the extension is granted file-URL access; no attachment bytes were transmitted. |
| Live two-device parity | Passed for the exercised Note lifecycle | Two isolated Account B origins proved new-device bootstrap, Account A marker absence, Device 1 create, Device 2 edit, reverse synchronization, persistence after reload on both devices, and deletion handling. The remote delete encountered the documented delete-versus-edit safety path on Device 1, produced exactly one review item, was resolved in favor of the deletion, synchronized, and did not reappear in Conflicts. The automated 17-scenario suite remains the evidence for the broader portable-category matrix. |
| Conflict behavior | Passed | The synthetic delete-versus-edit branch produced no sidebar conflict copy. One dedicated conflict-review item preserved both choices, resolution removed the page, a subsequent Sync cycle removed the review item, and the resolved conflict did not reappear. |
| Account A cleanup | Passed for conclusively identified items | Exact synthetic Note, folder/subpage, task, Canvas pages, and the marker-bearing Slides page were deleted locally and synchronized to Account A; Account A then reported Synced with no exact synthetic page/task marker and no synthetic conflict. The synthetic Assistant conversation was not present in the current visible history list, so no ambiguous chat was deleted. |
| Account B cleanup | Passed for the current-run note | The current-run Account B note was deleted through the conflict-resolution path above and was absent on both Account B devices. Pre-existing synthetic-looking Account B content from an earlier run was retained because it was outside this run's inventory. |
| Supabase backup rollback | Browser interception pending; prior live evidence and regression remain passed | The Chrome control surface exposed neither DevTools request blocking nor a safe page `fetch` override, so this run did not repeat the live `backup_index` interception. The prior live attempt-bound upload/delete evidence remains recorded above, and the current 24-test provider suite passed the rollback sequence. No production source or Supabase configuration was modified to induce failure. |
| Pending wipe records | Reviewed; retained | The two historical revoked, wipe-required, unacknowledged devices remain retained. Their last-seen date predates this run and neither could be conclusively correlated to these disposable browser origins. |
| Deployed PWA and physical devices | Not tested | No artifact was deployed or pushed. No iPhone or other physical-device test was performed. |

The current-run disposable text file used for the denied attachment attempt was
removed locally. All served-browser test content was synthetic. The local
deployment artifact and unattended command results remain those recorded in the
preceding continuation; browser acceptance did not modify runtime source or the
generated artifact.
