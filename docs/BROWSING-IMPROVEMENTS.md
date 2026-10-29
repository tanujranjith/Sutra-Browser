# Everyday browsing improvements

User-authorized implementation list. This is a bounded pass over existing features,
with production changes, regression coverage, and a rebuilt taskbar target.

1. Live page find: native highlights, counts, case/word options, keyboard navigation.
2. Searchable recently closed tabs with selective reopening and bounded memory.
3. Tab-switch previews centered on the selected tab, with position and hidden counts.
4. Shortcut conflicts, built-in reference, reset controls, strict key validation.
5. Search-shortcut editor with validated templates and a local preview.
6. Automatic download refresh, selection preservation, progress and missing-file help.
7. Reversible reader view with readable text, appearance and typography controls.
8. Page zoom controls with the current percentage and reset.
9. Request-only permissions, explicit remembering, navigation-race protection.
10. Review exact duplicate bookmarks within a folder, preserve one copy, undo removal.
11. Library filtering before queries, exact-note opening, text-result relevance.
12. Regression checks, privacy checks, and the existing pinned Debug build.

Verification results and limitations are recorded after implementation. No external
publication, signed release, remote sync, or new AI action is included.

## Result

The later [general sweep](CHANGELOG.md) consolidates this batch with the desktop
integration and stability changes and records the latest verification results.

All twelve items are implemented in code. Open the command palette with
`Ctrl+Shift+P` to find Recently closed tabs, Search shortcuts, Keyboard shortcuts,
Reader appearance, Page zoom, and Review duplicate bookmarks. Page search is `Ctrl+F`.

Verification on 2026-10-28:

- Restore succeeded using existing cached dependencies.
- Final x64 Debug build: zero warnings and errors.
- All 366 .NET tests passed: Core 285, Data 56, AI 15, Windows 10.
- Production reader fixture passed: bounded text extraction, no remote requests,
  hidden/form/editable exclusion, literal text, narrow layout, appearance controls,
  original DOM/event-handler/form-value/scroll restoration, and Escape cleanup.
- Existing new-tab focus/icon layout, video hover shortcut, media discovery,
  mini-player sizing/playback/overlay cleanup, and dashboard checks all passed.
- Taskbar shortcut confirmed to target the rebuilt standard Debug `Sutra.exe`.
- Git whitespace validation passed.

Native WinUI click-through and assistive-technology checks remain outstanding.
The approved Computer Use helper returned a missing-native-pipe error; browser
fixtures and policy tests do not substitute for live WinUI verification. In
particular, verify native find counts/focus, shortcut editing, download controls,
permission prompts, and selected reopening interactively before a release.

## Resource constraints

- No new packages, frameworks, media downloads, or release-package copies.
- Closed-tab history: 50 in-memory entries per window. Reopened background tabs
  remain hibernated until selected, avoiding a burst of renderer creation.
- Reader: at most 50,000 inspected text nodes and 250,000 copied characters;
  no remote images, fonts, or periodic timers. Original page remains intact.
- Downloads: pages of 50; refresh every three seconds only while selected;
  generation checks reject stale results; timers stop on page or window close.
- Bookmark review: inspect at most 10,000 entries, remove at most 200 reviewed
  copies in a transaction, preserve a surviving copy, and retain only the removed
  records needed for the current undo notification.
- Library source filters avoid querying unrelated repositories. Page find uses
  the engine API instead of copying the full document into a JavaScript string.
- Build and browser checks ran serially; idle compiler/MSBuild servers were shut
  down afterwards. No idle `dotnet` processes remained at the final process check.

These are implementation bounds, not a measured guarantee of total application
RAM usage. Website renderer memory still depends on the sites and number of tabs.
