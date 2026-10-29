# Change log

## Unreleased — 2026-10-28

Changes since `ce4694a` (`Harden browser callback lifecycle`). This is a source
update, not a signed production release.

### Desktop workspace

- Bundle the upstream Sutra frontend at revision
  `84cbbdf80b299cf495d3e7eefd9408ef4ceb16f0` under `vendor/Sutra`.
- Add the shared navy/purple desktop header, workspace navigation, vertical website
  tabs, compact browser toolbar, capture panel, application icon, and Notes beside
  a live webpage. Browser-owned overlays remain outside the vendor source.
- Add durable source/Research Collection capture, homework and deadlines, selected
  text annotations, Assistant drafts, and bounded local PDF import into Sutra.
- Isolate the workspace in a named profile on the shared WebView2 environment;
  validate bridge origins, versions, actions, and payload bounds. Private windows
  cannot open or capture into it.

### Everyday browsing

- Add the local customizable new-tab dashboard, bookmark shortcuts, open-tab
  resuming, private layout, and guarded local-data delivery.
- Improve command-palette ranking/scopes and address suggestions with tab switching,
  local source labels, typo tolerance, deduplication, and stale-result rejection.
- Add live native page find, searchable recently closed tabs, shortcut conflict
  editing/reference, validated search shortcuts, and site zoom controls.
- Add reversible reader appearance controls, automatically refreshed download
  lists, source-filtered Library search, and exact duplicate-bookmark review with
  transactional rechecking and undo.
- Make permission decisions request-only unless explicitly remembered; reject
  stale navigation results and never persist dismissed/private decisions.
- Add local unpacked-extension management with bounded manifest/permission review.
  The sweep also fixes rejection of nonnumeric manifest-version fields and adds
  regression cases for malformed types and numeric overflow.

### Media, filtering, and stability

- Add trusted-click video hover controls and resizable mini players that keep the
  existing media document and playback session; bound media discovery and metadata.
- Expand the supported ABP filter subset, bundle the Public Suffix List, add
  exact-host element hiding/undo, daily list refresh, atomic fallback recovery,
  and a shared compiled-filter cache.
- Deduplicate pending WebView initialization, reject late controllers, isolate
  process failures, and restore normal windows sequentially within memory limits.
- Correct memory-budget accounting and protected-tab sleeping; share pending
  media/scroll/process queries across caller timeouts.
- Guard asynchronous image work by navigation generation, drain writes before
  private cache cleanup, use bounded JPEG thumbnails and lazy previews, and query
  bookmarks through the existing exact-URL index.
- Add bounded diagnostic fault records without messages, stacks, URLs, or paths;
  observe UI callbacks and prevent stale continuations from touching closed views.

### Packaging and maintenance

- Add the x64 per-user Inno Setup installer, signed update-manifest tooling,
  verified update staging, detached installation, and install-tree rollback.
  Include upstream license/NOTICE attribution in the application bundle.
- Add hourly upstream synchronization with candidate checks and rollback; signed
  publication requires external signing secrets and explicit repository enablement.
- Add locked Playwright development dependencies and desktop/browser fixtures.
  Isolated desktop checks accept Playwright CLI options, and verification serializes
  restore/build/test work without retaining MSBuild worker nodes.
- Exclude generated browser profiles, screenshots/traces, installers, update feeds,
  environment files, and private signing certificates from source control.
- Refresh the README, architecture, security, integration, browsing, and stability
  documentation. Browser SQLite migrations are unchanged in this batch; workspace
  capture uses the existing upstream persistence and backup formats.

### Release limits

Native installer/upgrade/rollback, accessibility, multiple-DPI, and forced WebView
failure testing remain release gates. The pinned upstream `check:all` has a known
runtime-size budget failure; it must pass upstream before automated release
promotion. See [Sutra desktop integration](SUTRA-DESKTOP-INTEGRATION.md),
[browsing improvements](BROWSING-IMPROVEMENTS.md), and
[stability notes](STABILITY-PERFORMANCE.md) for scope and earlier evidence.

### Verification on 2026-10-28

- `./scripts/verify.ps1 -Configuration Debug`: restore, x64 Debug solution build
  with zero warnings/errors, and **391 passing .NET tests** (Core 309, Data 57,
  AI 15, Windows 10). All four test projects produced nonempty TRX reports.
- Rebuilt `Browser.App` after adding attribution and verified `Sutra/NOTICE` in
  the standard output. The build passed with zero warnings/errors.
- Root and vendor `npm ci --ignore-scripts --no-audit --no-fund`: passed.
- Vendor `npm run test:unit`: **625 passed**.
- `$env:SUTRA_TEST_BROWSER='chrome'; npm run test:desktop:isolated -- --timeout=180000`:
  **8 passed**, with the original assertions. Earlier Edge sessions closed during
  four cases, and a Chrome diagnostic attempt reached the source-capture reload
  before its original 60-second timeout. Serial fresh Chrome sessions passed after
  build-server cleanup with a larger explicit timeout. This is frontend coverage,
  not native WinUI or installed WebView2 acceptance.
- The dashboard, new-tab layout, media discovery, video-hover, and reversible-reader
  fixtures all passed. `./scripts/test-upstream-sync.ps1` passed: an intentionally
  failing upstream candidate left the vendor source and pin unchanged.
- JavaScript syntax: all 14 Browser-owned frontend, bridge, and harness files
  passed. PowerShell scripts parse successfully. Browser-owned staged whitespace
  checks pass; existing whitespace in eight vendored files is preserved.
- The staged credential-pattern matches were reviewed as synthetic upstream test
  values. Generated profile/output directories and signing material are excluded.
- Vendor `npm run check:all`: **fails the inherited runtime-size gate** at
  5,000,137 bytes against 4,913,747. No vendor source or budget was changed to bypass
  it; the remaining checks in that command do not run after this failure.
