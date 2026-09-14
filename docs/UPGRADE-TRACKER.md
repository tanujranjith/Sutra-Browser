# Sutra upgrade tracker

This tracks the 88-item proposal and the additional UI/UX redesign. It is not a claim
that all items have shipped. “Implemented” describes code with unit/build verification;
native visual/interaction verification is still required for this batch. No production
release, signing, or external publication has occurred.

Scope update: encrypted sync has been removed at the user's request. Its original
roadmap slot (#84; #70 in the remaining-items list) is now **Kill switch**. Work on
that 74-item continuation is tracked below. The AI assistant's user-facing name is **Sutra Assistant**,
centralized in `Browser.Core/Branding/AppBrand.cs`.

## Implemented or extended in this batch

- Shared manager layout with section navigation, stronger hierarchy, responsive padding,
  clearer rows, accessible control names, and reachable toolbar overflow.
- Reworked new-tab canvas with library/workspace/reading shortcuts and working layout customization.
- Searchable settings with category navigation and a narrow-window selector.
- Combined local library search across tabs, bookmarks, history, notes, reading list,
  offline articles, and workspaces; normal history/notes/workspaces excluded in private search.
- Inert offline article text storage, search, native reading/font controls, removal/undo,
  maximum article/library sizes, and append-only migration 5.
- Per-window recovery snapshots, deduplication, bounded retention, restoration into a
  new window, and append-only migration 6. Private windows never save snapshots.
- Separate named-profile databases/settings/vaults with stable safe directory identities.
  Existing shared browser data remains in Default. Website controllers share the environment.
- Existing-window tab transfer menu and cross-window sidebar drop support; destination
  controller recreation, protected-tab guards, same-profile/private boundaries.
- Bookmark-bar ordering for root bookmarks and root folders with transactional persistence.
- Workspace replacement confirmation and undo for replacement/deletion.
- Download search/status filters, session pause/resume, and SHA-256 comparison.
- Plain-text-safe Markdown export of visible note results.
- AI streaming with bounded SSE/NDJSON decoding; selected comparison of 2–8 tabs;
  explicit waking of selected sleeping tabs; remote context preview; source buttons;
  request timeout and editable-field exclusion from page extraction.
- Memory-saver explanations in browser health and clearer shell/renderer memory labels.
- Reproducible verification/development-packaging script and regression tests.
- Release solution mappings repaired; verification rejects missing/empty test reports.
  Windows Debug/Release CI workflow added locally, with no remote run yet.
- Profile-directory writes are independent of stale window settings. Session saves/imports
  reject executable schemes, credential-bearing URLs, and remote file shares.
- Kill switch implementation: native palette/shortcut and `--kill-switch` launch argument,
  cross-process shutdown requests, all-library history cleanup, WebView profile history
  clearing, late-writer barriers, and durable retry before reopening tabs. Migration 8
  adds a monotonically increasing privacy epoch; saved artifacts remain intact.
- Repeated-startup-crash detection opens a fresh tab after two recent failed starts.
  Recovery now previews pages and opens only the tabs explicitly selected by the user.
- Tab cleanup previews selectable candidates and reasons for keeping protected tabs awake.
  Duplicate cleanup preserves distinct URL paths/queries/fragments and rechecks candidates
  before closing. Hibernation rechecks activity after asynchronous scroll capture.
- Tab/session foundations batch A (code + unit tests; native visual/interaction QA still required):
  automatic multi-window sessions in migration 9 with late-writer fencing, private exclusion,
  and crash-review guards; horizontal-strip cross-window transfer through the same guarded
  policy as the sidebar; basic tree tabs with repaired parent links, collapse, indent, and
  subtree-safe close/transfer; custom dragged split ratios persisted as star fractions;
  temporary preview tabs excluded from sessions/snapshots/recently-closed and blocked from
  transfer. Workspaces, recovery selection, and snapshot serialization drop temporary tabs
  and remap tree parents on instantiate.
- Performance foundations batch B (code + unit tests; native/device QA still required):
  startup phase timings with slow-start detection in health/diagnostics; adaptive
  hibernation budgets from OS memory pressure + battery saver; health dashboard CPU
  estimate, memory/CPU sparklines, pressure explanation, and startup summary; repeatable
  local bench script plus docs; migration 10 FTS5 indexes with triggers for history,
  bookmarks, notes, and articles plus 50-row paged search with literal-wildcard fallback.

## Original proposal, by number

Continuation batch adds a searchable workspace list with page previews, color/icon
identity, reusable templates, independent IDs for every launched copy, new-window
opening by default, and durable update/edit/delete history. Migration 7 preserves
existing workspaces and adds history plus a download date index. Split presets persist
through workspaces and session recovery. Downloads use 50-row database pages, readable
failure guidance, explicit paused state, and controls across compatible profile windows.
History retention is opt-in, confirmed when enabled or shortened, and defaults to off.

| # | Upgrade | State / next work |
|---|---|---|
| 1 | Engine direction | Decision documented; WebView2 ships, CEF experimental |
| 2 | Restore all normal windows | Implemented in code + unit tests; automatic multi-window startup restores up to 8 newest normal windows with private/crash/kill-switch guards; native multi-window QA pending |
| 3 | Versioned session recovery | Implemented; added per-tab preview and selective reopening |
| 4 | Crash recovery / crash loops | Repeated-crash fresh-tab mode and selective recovery implemented; native restart QA pending |
| 5 | Startup performance | Implemented in code + unit tests; phase timings, slow-start detection, bench script; device/native timing QA pending |
| 6 | Adaptive memory saving | Implemented in code + unit tests; OS pressure/battery adaptation of hibernation budgets; device QA pending |
| 7 | Health dashboard | Implemented in code + unit tests; CPU estimate, memory/CPU time-series, pressure + startup summary; native QA pending |
| 8 | Performance benchmarks | Implemented in code; local repeatable script + docs; cross-machine comparison not claimed, remote CI pending |
| 9 | Large-library performance | Implemented in code + unit tests; FTS5 + triggers (migration 10) and 50-row paging for history/bookmarks/notes/articles with literal-wildcard fallback; downloads already paged; native large-library QA pending |
| 10 | Smaller UI components | Shared design, reading, recovery, transfer, and download helpers extracted |
| 11 | Drag between windows | Sidebar + horizontal-strip transfer implemented in code + unit tests with shared guarded policy; native drag QA pending |
| 12 | Existing-window transfer menu | Implemented |
| 13 | Tree tabs | Partial: parent/child links with cycle/depth repair, persistence, collapse/indent, child-tab creation, subtree-safe close/transfer; drag-reorder of tree and full keyboard/screen-reader QA pending |
| 14 | Workspace identity | Color/icon labels, preview, and selected-tab workspace badge implemented |
| 15 | Workspace templates | Reusable templates and independent tab/group identities implemented |
| 16 | Workspace recovery history | Durable edit/update/delete versions; 20 per workspace, 200 per profile; restore a named copy |
| 17 | Split-layout presets | Presets plus custom dragged column/row ratios persist and restore; native drag-persistence QA pending |
| 18 | Tab activity explanations | Memory-saver reasons added in health dashboard |
| 19 | Temporary tabs | Implemented in code + unit tests; preview tabs excluded from sessions/snapshots/recently-closed/transfer with visual hints; native lifecycle QA pending |
| 20 | Cleanup preview | Selectable sleep/duplicate previews, protection explanations, and state rechecks implemented; native QA pending |
| 21 | Bookmark-bar ordering | Implemented for root bookmarks/folders |
| 22 | Bookmark tree editing | Existing nested editing; bulk move/undo pending |
| 23 | History calendar picker | Already present before this batch |
| 24 | Unified local search | Workspace results open the matching saved set; exact note navigation still pending |
| 25 | Typo-tolerant suggestions | Pending |
| 26 | Search-engine editor | Existing aliases; richer editor pending |
| 27 | Opt-in remote suggestions | Pending |
| 28 | History retention rules | Opt-in age limit implemented; per-domain exceptions pending |
| 29 | Bookmark maintenance | Pending |
| 30 | Expanded imports | Existing bookmark HTML/Chrome import; history/session adapters pending |
| 31 | Offline archives | Text articles implemented; full-page/media archiving pending |
| 32 | Offline-library management | Search, quotas, date, remove/undo implemented |
| 33 | Persistent highlights | Pending |
| 34 | Note organization/export | Markdown export added; tags/folders/backlinks pending |
| 35 | Research collections | Pending |
| 36 | Reader controls | Offline font controls added; online reader preferences pending |
| 37 | Read aloud | Pending |
| 38 | Translation improvements | Pending |
| 39 | QR sharing | Pending |
| 40 | Capture/PDF annotation | Existing PNG/PDF export; region/full-page/annotation pending |
| 41 | Restart-resumable downloads | Pending; current resume is process-local |
| 42 | Download queues | Pending |
| 43 | Bandwidth/scheduling | Pending |
| 44 | File hash verification | Implemented |
| 45 | Download recovery UX | Readable failure guidance, explicit pause, paging, and cross-window controls added; restart resume pending |
| 46 | Download organization rules | Pending |
| 47 | Reader/media adapters | Pending |
| 48 | Windows media integration | Pending |
| 49 | Persistent media preferences | Pending |
| 50 | Transcript tools | Pending |
| 51 | Complete profile libraries | Implemented; migration/interaction QA outstanding |
| 52 | Profile management | Existing creation; rename/delete/export pending |
| 53 | Site-data inspector | Existing reset; storage inspector pending |
| 54 | Privacy presets | Pending |
| 55 | Permission expiry | Pending |
| 56 | Broader blocker syntax | Pending |
| 57 | Scheduled filter updates | Pending |
| 58 | Login-flow support | Pending; exact-origin requirements retained |
| 59 | Passkeys | Feasibility and integration pending |
| 60 | Vault improvements | Password generation already exists; Hello/reuse/portable backup pending |
| 61 | Page-sharing preview | Implemented for remote question/page actions |
| 62 | Source-linked answers | Source links and citation prompting added; per-claim grounding QA pending |
| 63 | Selected comparisons | Implemented for 2–8 selected tabs with explicit wake choice |
| 64 | Streaming/cancellation | Implemented; live-provider verification outstanding |
| 65 | Provider manager | Existing configuration; connection tests/discovery pending |
| 66 | AI budgets | Existing action caps; token/cost budgets pending |
| 67 | Task preview/history | Existing bounded action loop; richer preview/undo pending |
| 68 | Reusable AI workflows | Pending |
| 69 | Local semantic search | Pending; new library search is lexical |
| 70 | AI regression coverage | Streaming bounds/cancellation tests added; broader adversarial suite pending |
| 71 | Searchable settings | Search/category UI implemented; deep links/reset pending |
| 72 | Broader shortcuts | Existing customization; conflict UI and export/import pending |
| 73 | Accessibility | Labels, headings, overflow improved; screen-reader/native QA pending |
| 74 | Touch/DPI | Responsive managers added; device/DPI verification pending |
| 75 | Toolbar dragging | Pending |
| 76 | Consistent undo | Workspace/offline additions; broader durable undo pending |
| 77 | Localization / RTL | Pending |
| 78 | Onboarding refinements | Pending |
| 79 | Trusted release/update | Development packaging added; certificate/feed/installer still needed |
| 80 | Windows UI smoke tests | Native helper unavailable in this session; suite pending |
| 81 | CI release checks | Windows Debug/Release workflow added; remote execution pending |
| 82 | Private persistence tests | Existing policy tests; end-to-end disk audit pending |
| 83 | Encrypted backup/restore | Pending |
| 84 | Kill switch | Implemented in code: local command/shortcut/CLI, cross-process signaling, all-profile cleanup, late-save fencing, restart retry; native multi-process/WebView QA pending |
| 85 | Extensions feasibility | Engine gates documented; runtime capability prototype pending |
| 86 | Site-app windows | Existing desktop shortcuts; dedicated app windows pending |
| 87 | Default-browser integration | Pending |
| 88 | ARM64 / other OSs | Separate platform effort; prerequisites documented |

## Kill switch behavior

- A local command named `kill-switch` immediately dismisses all Sutra windows and tabs,
  cancels active assistant tasks and downloads, and completes local history cleanup.
- Clear browsing history and typed-search history across Sutra profiles. Stop pending
  history/session saves before deletion so shutdown cannot write the cleared data back.
- Clear automatic session restore, recently closed tabs, and recovery snapshots that
  would reopen the closed tabs on the next launch. Explicitly saved workspaces remain.
- Preserve bookmarks, saved passwords, saved articles, and downloaded files.
- Invocation must come from the user's native command/shortcut, never from webpage
  content or an AI action. Test shutdown races, profile coverage, and restart behavior.

Use the native command palette (`Ctrl+Shift+P`) and run `kill-switch`, use the native
`Ctrl+Alt+Shift+K` accelerator, or launch `Sutra.App.exe --kill-switch`. No confirmation
dialog precedes the shutdown. Close older Sutra builds before first use: cross-process
requests and writer fencing require the updated build in every running process.

The request persists independently of cleanup completion. SQL cleanup atomically advances
each library's privacy epoch; old history/session writers cannot repopulate cleared rows.
Engine cleanup waits for participating processes to release their page controllers.
Failure shows a dedicated retry window and leaves the request pending for startup.
Private windows do not gain ordinary persistence; invoking this explicit global command
from one still clears normal-profile history. Tests use disposable fixture databases and
storage roots; the real kill switch was not executed against the user's browser data.

## Verification

This continuation's Debug verification passed restore, build (zero warnings/errors),
all 230 tests (Core 163, Data 44, AI 15, Windows 8), and new-tab JavaScript syntax.
Final Release verification on 2026-09-07 local time includes the shutdown lifecycle
changes and an additional pending-cleanup registration test: zero build warnings/errors,
all 231 tests pass (Core 163, Data 44, AI 15, Windows 9), and JavaScript syntax passes.
The verified self-contained x64 development package, including its SHA-256 manifest, is
`artifacts/releases/Release-20260908-005439-9175ed` (directory timestamp is UTC).

Batch A (tabs/windows foundations #2, #11, #13, #17, #19) Debug verification on 2026-09-08
local time: restore succeeded, build succeeded with zero warnings/errors, and all 243
tests pass (Core 170, Data 49, AI 15, Windows 9). New tests: Core TabFoundationsTests
(temporary/tree/split-ratio/transfer/multi-window/serializer) and Data
WindowSessionRepositoryTests (per-window save/list/delete, temporary/private exclusion,
epoch fencing, kill-switch clearing, retention) plus extended KillSwitchRepositoryTests
for window_sessions. Migration 9 adds window_sessions; v4/v7 downgrade fixtures updated.
Native visual/interaction QA for multi-window restore, horizontal-strip drag, tree
indent/collapse, custom split ratios, and temporary-tab lifecycle remains outstanding
(no bypass of the unavailable automation helper or local-file preview rejection).

Batch B (performance #5–#9) Debug verification on 2026-09-08 local time: restore
succeeded, build zero warnings/errors, all 252 tests pass (Core 174, Data 54, AI 15,
Windows 9). New tests: Core PerformancePolicyTests and Data LibraryPagingTests;
updated OfflineArticle quota test for paging. Migration 10 adds FTS5 indexes/triggers;
v4/v7 downgrade fixtures drop FTS objects. Native/device QA for startup timing,
pressure/battery adaptation, CPU sparklines, bench numbers, and large-library paging
remains outstanding.

Run `./scripts/verify.ps1` for restore, x64 Debug build, all tests, and new-tab JS syntax.
Use `-Configuration Release -Publish` for a checked self-contained development package.

Required interactive follow-up: new-tab layout at narrow/wide sizes, keyboard focus,
settings category/search/save, native manager navigation, private/non-private/profile
separation, offline save/read/delete/undo, cross-window drag/transfer, download pause/resume,
workspace previews/templates/version restore, split presets at narrow sizes, retention
confirmation, and provider streaming/stop. The Windows automation helper was unavailable, and the
browser preview tool rejected local-file navigation; neither was bypassed.

This batch also needs native checks for palette/accelerator/CLI shutdown, multiple
normal/private/profile processes, WebView history clearing, forced cleanup failure/retry,
crash-loop startup, selective recovery, cleanup selection/protection changes, multi-window
restore with 2+ normal windows, horizontal-strip drag between windows, tree collapse/expand,
dragged split-ratio persistence across restart, and temporary-tab discard on close.
