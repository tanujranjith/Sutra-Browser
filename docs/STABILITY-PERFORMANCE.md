# Stability and resource audit

This pass fixes concrete issues found in the existing implementation. It is not
a guarantee against every future crash, a benchmark of total browser memory, or
live verification of WinUI/WebView2 process failure behavior.

## Fixes

| Finding | Change |
| --- | --- |
| Automatic budget enforcement ran even with automatic sleeping disabled. Budget counting excluded protected live tabs and applied pressure more than once. | Respect the setting throughout the pass, count actual live controllers, apply mode/pressure once, and sleep only excess eligible tabs. Prefer older tabs, with heavier tabs first when activation times tie. Keep protected tabs protected. |
| A stalled renderer could leave media polling or hibernation scroll capture waiting indefinitely. Repeated requests could accumulate. | Share one pending operation per WebView/query type, bound individual waits, observe late faults, and release completed results. Cancellation stops waiting without starting another native operation. |
| Process memory queries retried repeatedly after failures and could remain in flight indefinitely. | Throttle failures as well as successes; share one pending query per window, with a three-second wait and window cancellation. Ignore results for sleeping/closed tabs. |
| Media discovery enumerated a mutable tab collection across awaits and could update removed mini-player controls. Media values could overflow time formatting. | Snapshot and revalidate tab/controller/player identities, cancel discovery when its flyout closes, distinguish unavailable queries from removed media, bound discovery and text, and normalize timestamps. |
| Bookmark indicators scanned only the first bookmark result page on navigation updates. Saved pages after that page could be missed. | Use an exact indexed URL lookup returning one row, reject stale continuations, and reuse the indicator result for an unchanged tab/address until invalidation. Bookmark mutations invalidate it. |
| Favicon/thumbnail work could finish after tab navigation or close, and private cleanup could race image writes. | Revalidate generation and controller identity around awaits, serialize each control's capture type, track finite cache writes, seal/drain writes before directory cleanup, and write images through temporary files followed by replacement. |
| Thumbnail capture wrote full PNGs and every tab refresh built image-heavy tooltip trees, including the hidden horizontal strip. | Capture bounded JPEGs, decode previews at 300 pixels wide only when hovered, release tooltip images on close, skip hidden horizontal visuals, and coalesce title/audio-driven refreshes. |
| Closed tabs could retain zoom/blocking/navigation state and stale thumbnails. | Prune removed-tab state and remove only verified browser-generated thumbnail paths in the exact cache directory. Old thumbnails are removed when replaced. |
| Async button/menu delegates were being converted to async-void actions. Late startup/theme/status callbacks and protected-tab confirmation could touch closed surfaces. | Add task-aware observed callbacks with per-control overlap guards; recheck window/tab lifetime after awaits and before touching released visuals. Bound mini-player presentation/return script waits. |

## Resource bounds

- No new packages, frameworks, background services, or duplicate distribution trees.
- Media: up to 32 recent-tab sessions per hub, 64 inspected media elements per
  document, 128 KiB maximum accepted JSON, 512-character titles and 256-character
  artist labels. An unavailable renderer keeps existing mini-player controls.
- Media/scroll waits: two seconds; diagnostics/presentation waits: three seconds.
  These limits stop the wait, not the underlying WebView2 operation. Single-flight
  ownership prevents polling from adding another copy while it remains pending.
- Images: favicon payload at most 1 MiB, thumbnail JPEG at most 4 MiB. Reuse fresh
  favicon files; refresh stale icons after a day. Only generated thumbnail paths
  inside the cache are eligible for immediate removal. Existing stale-cache
  retention remains in place.
- Concurrent finite cache writes are observed and drained before private-directory
  removal. Each file is written through a temporary path and cleaned on failure.
- Tests and build checks run serially; compiler/MSBuild helpers are stopped after
  verification. No forced GC or broad WebView/GPU flag changes are introduced.

## Verification and application

- The general sweep on 2026-10-28 passed all 391 .NET tests: Core 309, Data 57,
  AI 15, Windows 10. This includes seven malformed extension-manifest cases added
  during review. The earlier resource audit passed 384 tests before those cases.
- The complete x64 Debug solution build, including WinUI markup and output copying,
  now passes with zero warnings/errors. This supersedes the earlier compilation-only
  check used while the application was open.
- Five browser regression fixtures passed: bounded media discovery/metadata/IDs,
  video hover actions, mini-player playback/resizing/cleanup, reversible reader,
  and new-tab focus/icon layout.
- The exact bookmark lookup test confirms the SQLite URL index is used and finds
  an entry outside the initial result page without changing case/query meaning.
- New unit tests cover timeout/cancellation sharing, subsequent recovery, all-write
  shutdown drain and rejection, memory-budget ordering/settings, large media times,
  and cache path containment.

The earlier audit left the running application open and could not replace its
loaded assemblies. The later full build completed that copy step in the standard
Debug output; no second installation was created. See [CHANGELOG.md](CHANGELOG.md)
for the consolidated changes and current verification results.

Live WinUI stress testing, actual native image capture/write races, and forced
renderer/browser-process fault injection remain unverified: the approved desktop
automation helper reports a missing native pipe. No application fault log was
present at the configured privacy-safe diagnostics path; that does not establish
that no earlier failure occurred.
