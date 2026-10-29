# Audit Remediation Release Certification — 2026-08-30

This record preserves the final local and staging evidence for the
`ox-alpha/audit-remediation` release candidate. It is a certification record,
not a deployment approval.

## Candidate identity and boundary

- Runtime fix commit: `caac985` (`Restore encrypted backup modal focus`).
- Final test-harness commit: `92605a0` (`Harden backup modal focus test on mobile`).
- Branch at certification: `ox-alpha/audit-remediation`, 15 commits ahead of
  `origin/ox-alpha/audit-remediation`.
- `main` and `origin/main` both resolved to
  `b8e81fe5b300c3f12db7b2e85f41db84e6c3fb70`.
- Nothing was pushed, deployed, or merged into `main` during certification.
- Production Supabase was not modified. Live database work targeted the
  disposable non-production staging project only.
- No account identifier, bearer token, passphrase, key, ciphertext body,
  object path, or private workspace value is retained in this record.

Commit `92605a0` changes only
`tests/e2e/modal-accessibility.spec.mjs`; no runtime or deployment file changed
after the full runtime gates below. The corrected test was then rerun on
desktop Chromium and Pixel 7, and the complete Pixel 7 project was rerun
serially.

## Automated release evidence

| Gate | Result | Notes |
| --- | --- | --- |
| `npm run check:all` | Passed | Static architecture, migration, Supabase schema, persistence, CSP, header, network, accessibility, asset, service-worker, and link checks passed. |
| `npm run test:unit` | 583/583 passed | No failed, skipped, cancelled, or todo unit tests. |
| `npm run build:deploy` | Passed | A clean local `.deploy/` artifact was built from the allowlist. |
| `npm run check:deploy` | Passed | The artifact was self-consistent and passed its credential-shaped-secret checks. |
| `npm run test:e2e:sync` | 20/20 passed | One Chromium worker; 26.2 minutes; no retry or failure. |
| Required Chromium batch (`npm run test:e2e:smoke`) | 68/68 passed | One worker; 31.7 minutes. This included the runtime fix and its initial regression; the viewport-aware test-only follow-up was separately rerun on desktop and Pixel 7. |
| Pixel 7 (`mobile-chromium`) | 53 passed, 3 intentional skips | Complete clean rerun with one worker; 13.8 minutes. The skips are desktop-only cases. |
| Office cross-browser | 3/3 passed | Offline DOCX/XLSX import passed in Chromium, Firefox, and WebKit with one worker. |
| Updated backup-modal regression | Passed on desktop Chromium and Pixel 7 | Escape, Cancel, and close-button paths restore the encrypted-backup trigger. |
| Syntax validation | 371 JavaScript files passed | Run after the viewport-aware test correction. |
| `git diff --check` | Passed | No whitespace-error finding. |

The first complete Pixel 7 attempt used four workers and ended with 48 passes,
3 intentional skips, and 5 timeouts. All five timed-out cases passed when run
serially, and the subsequent complete one-worker Pixel 7 run passed with the
result above. This is recorded as resource-pressure/harness evidence rather
than a Sync or product-code defect.

## Sync behavior covered on the final runtime

The 20-scenario focused Sync gate covered:

- opt-in boundaries, account-switch quarantine, and fail-closed session
  mismatch/key creation;
- atomic same-device identity across tabs;
- two-device create/edit convergence and idempotent pushes;
- real Notes title/body/block merge, hidden conflict review, legacy conflict
  cleanup, offline divergence, and delete-versus-edit handling;
- snapshot bootstrap and reload;
- encrypted attachment propagation and deduplication;
- complete portable workspace parity, Assistant hydration, reverse
  incrementals, asset replacement, and reload;
- actual Assistant composer history in both directions;
- offline next-contact revoke/wipe across tabs and storage databases;
- ordinary sign-out preserving the local workspace;
- zero Sync requests while disabled;
- multi-tab single-flight/status relay;
- configured Supabase UI/auth flow against the synthetic backend; and
- wrong-passphrase non-mutation.

## Disposable Supabase staging evidence

The staging project was explicitly identified as non-production before live
work. The durable-ack/pruning migration and the follow-up
`sync_put_asset`/pruning-floor corrections were applied and validated there.
Production was not used as a substitute for staging.

Live staging certification passed the exercised contracts for:

- additive schema/migration shape, durable acknowledgement, snapshot floors,
  and no-snapshot/no-floor behavior;
- stale active-device retention until every eligible device acknowledged the
  snapshot floor;
- pruning after the durable floor, replay rejection through the preserved
  device-sequence barrier, and concurrent push/pull/snapshot/prune;
- two-device convergence, new-device bootstrap, encrypted attachments,
  Assistant history, and reload;
- public-key-only denial and authenticated Account A/B table, RPC, device,
  vault-key, snapshot, asset-index, and Storage isolation;
- server-derived ownership despite caller-supplied hints;
- ciphertext/payload inspection with no plaintext sentinel leakage;
- account-scoped device authorization; and
- revoked-device denial, next-contact local wipe, acknowledgement, reload
  non-resurrection, and fresh-device registration.

Synthetic certification data was cleaned through the scoped harness cleanup
paths. Ambiguous historical records were not deleted merely because they
looked test-related.

## Real Chrome spot check

Chrome was pointed at a fresh disposable local origin on the certified runtime.
The encrypted-backup password modal was exercised without entering a password
or creating a backup:

- initial focus entered the passphrase field;
- Tab and Shift+Tab remained inside the dialog;
- Escape closed the dialog and restored
  `#exportAtelierWorkspaceBtn`;
- Cancel restored the same trigger;
- the visible close button restored the same trigger; and
- Chrome recorded no runtime error during the check.

The local server was stopped afterward. No cloud or deployed state was touched.

## Remaining release actions

The following are deliberately outside this certificate:

1. Review and merge `ox-alpha/audit-remediation` into `main`.
2. Plan, review, approve, and apply the production Supabase migration as a
   separate operation.
3. Configure GitHub branch protection and required checks for `main`.
4. Push/deploy only with explicit authorization.
5. After deployment, verify the exact published PWA and the response headers
   served by the production host.
6. Record physical-device acceptance separately. The Pixel 7 result above is
   Playwright device emulation, not a physical Android device claim.
