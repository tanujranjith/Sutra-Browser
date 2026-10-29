# Sutra

Sutra is a focused Windows-native browser built with WinUI 3, Microsoft WebView2, C#, and SQLite. It is an unpackaged x64 desktop application and uses the installed Evergreen WebView2 Runtime.

This repository contains a working MVP, not a custom rendering engine or a Chromium fork.

## Sutra desktop integration

The app opens directly into the browser. The bundled Sutra workspace remains available from the section selector and warms in the background when appropriate. Browser capture can create Sutra sources, research Collections, homework, deadlines, Assistant drafts, and PDF annotations, or open a website beside Notes. The upstream Sutra repository is unchanged; its pinned copy is under `vendor/Sutra`, with desktop integration maintained outside that copy.

The desktop design follows the approved mockups: a shared Sutra header, navy surfaces, purple selection states, vertical website tabs, a live page beside the real Notes editor, and right-hand homework/deadline capture. Screenshots, native interaction checks, and visual comparisons are documented in [design-qa.md](design-qa.md).

Build the x64 development installer with `./scripts/build-installer.ps1 -Configuration Release`, then run the generated **`SutraBrowserSetup.exe`** in the repository root. Generated installers and browser profiles are excluded from Git. Production signing, the hourly upstream sync, verification results, and remaining native release checks are described in [Sutra desktop integration](docs/SUTRA-DESKTOP-INTEGRATION.md). See the [change log](docs/CHANGELOG.md) for changes since the previous commit and the latest verification results.

## What works

The UI regression checks can be run with `node scripts/test-browser-dashboard.mjs`, `node scripts/test-newtab-layout.mjs`, and `npm run test:desktop:isolated`. The isolated command executes the existing desktop integration cases in fresh browser sessions, keeping their assertions and per-case traces intact. Native WinUI title-bar, pointer, and focus behavior still require an interactive Windows walkthrough before a release.

For a constrained machine, the same desktop cases can use Chrome with a larger time allowance: set `$env:SUTRA_TEST_BROWSER = 'chrome'`, then run `npm run test:desktop:isolated -- --timeout=180000`. The latest sweep passed all eight cases this way after Edge sessions closed unexpectedly. This verifies the frontend and simulated bridge; native WebView2 acceptance remains separate.

- A compact desktop header with a command launcher, a filterable tab sidebar with live counts, a collapsible capture section, and a Library/Downloads/Media dock. The command palette combines recent tabs and actions, supports `/` and `>` scopes, and tolerates one-character typos.
- A local new-tab dashboard with bookmark shortcuts, open-tab resuming, light/dark/private layouts, and section customization. It uses no remote icons, fonts, thumbnails, or suggestions. Private dashboards receive no saved shortcuts or session records.
- Labeled address suggestions distinguish open tabs, bookmarks, and history; selecting an open tab switches to it. Suggestions are debounced, bounded, deduplicated, and excluded from stale responses. Private suggestions never use history.
- Custom video mini players open at 320×180 in the bottom-left of the current monitor's work area. A hover shortcut appears on page videos; the pop-out has custom auto-hiding controls, a move handle, resizing, and no page scrollbars.
- WebView2 navigation with back, forward, reload/stop, home, new-window-to-tab routing, polished navigation error pages, external-protocol confirmation, page titles, cached tab favicons, audio state, process-failure isolation, fullscreen webpages, and local history.
- Ctrl+L is intercepted before webpage handlers and focuses the native address bar without showing page-level shortcut hints. New-tab fallback rendering remains interactive (search/address input) even if local profile data is temporarily unavailable.
- A unified address/search bar that recognizes URLs, domains, IP addresses, and localhost; Google, Bing, and DuckDuckGo are selectable, with `@g`, `@b`, and `@d` one-off search shortcuts plus locally configured URL-template aliases such as `yt lofi`. Suggestions come only from local bookmarks and history. Paste-and-go/search, clean-link copying, and opening a clean copy are built in.
- Horizontal and vertical tab layouts, pinned tabs, persisted tab groups and drag ordering, same-site tab-group suggestions with explicit approval, multi-select management, duplicate cleanup, mute/close/bulk-close actions, rich hover previews with live renderer-RAM snapshots, recently closed tabs, session restore, standard keyboard shortcuts, and real tab hibernation that closes the WebView and restores URL/scroll state when woken.
- Manual hibernation can be invoked from an active tab: Sutra moves focus to another awake tab (or creates a new-tab placeholder) before releasing the selected tab's WebView. Media, downloads, permission prompts, calls, and unsaved forms are kept awake for safety.
- Split screen with 2, 3, 4, 6, or 8 live resizable panes and a media hub/mini-player that discovers native HTML media, switches playing tabs, plays/pauses, seeks, changes volume, and requests picture-in-picture where the page/runtime permits it.
- Conservative automatic hibernation with inactive, pinned, media, call, download, permission, dirty-form, and excluded-domain checks. Background maintenance passes cannot overlap, and automatic hibernation does not spam notifications.
- Page Notes: attach an optional selected-text quotation and a note to any HTTP/HTTPS page, edit or delete notes from a dedicated manager or the utility sidebar, and search notes across pages. Notes are plain text, stored only on this device, never sent to an AI provider, and unavailable in private windows.
- A Fluent browser shell with a compact toolbar, horizontal or vertical tabs, bookmark bar, local new-tab dashboard, transient status notifications, and full in-app History, Bookmarks, Downloads, Passwords, Settings, About, and tab-search surfaces.
- Local bookmarks and history managers backed by versioned SQLite migrations. Bookmarks support folders, editing, bookmark-all-tabs, and standard HTML import/export; history supports text/date filtering, domain/entry deletion, and clear-since actions.
- WebView2 download capture, a live shelf, progress metadata, date grouping, failure display, cancellation/retry-source/open-file/open-folder actions, replace/keep-both collision handling, an explicit warning before keeping executable/script formats, and a close confirmation while downloads are active.
- A local credential vault using AES-256-GCM records and a random master key protected with Windows DPAPI for the current Windows user. SQLite holds metadata only. Saved credentials are exact-origin HTTPS-only; filling always asks the user, and same-origin HTTPS form submissions can trigger explicit save/update prompts.
- Ollama and OpenAI-compatible AI providers. Remote API keys use the same secure store and are never written to settings or SQLite. Provider failures are shown as fixed actionable summaries; raw provider error text is never displayed.
- Sutra Assistant with general Q&A, summarize/explain/extract/compare actions, a visible local/remote page-sharing indicator, task status, a prominent stop control, a bounded structured action loop, DOM element maps, timeouts, approval gates, and privacy-safe local action logs. Outstanding AI work is cancelled when its window closes.
- Local ad/tracker blocking with a conservative built-in list, optional EasyList/EasyPrivacy updates, cosmetic filtering, per-site exceptions, a shield counter, and per-site data reset. Filtering is an intentionally supported ABP subset rather than extension compatibility.
- Per-origin WebView2 permission prompts with allow-once, always-allow, and block decisions, plus review/reset UI and per-site saved-decision visibility.
- Multiple normal and private windows. Private windows use WebView2 InPrivate controller mode, do not write history, sessions, download metadata, permission decisions, AI action logs, or page notes, and disable saved-password access and AI by default.
- System/light/dark and scheduled themes, compact/comfortable density, custom accent/new-tab color, configurable toolbar buttons, reader mode, translation, F11 fullscreen, reversible Focus mode (`Ctrl+Shift+F`), link-hover status, window size/maximized restoration, a custom Windows application icon, and centralized branding in `Browser.Core/Branding/AppBrand.cs`.
- A searchable command palette (`Ctrl+Shift+P`) with deterministic ranking (exact and prefix matches above substrings) and full keyboard operation (Up/Down to move, Enter to run, Escape to close), a visual Ctrl+Tab switcher, persistent workspaces, reading list, cross-tab text search, local sidebar, browser-health dashboard, crash-recovery notice, and additional user-defined keyboard shortcuts.
- Toolbar ordering controls, optional local new-tab background images, tab-preview screenshots, mouse back/forward buttons, language-aware translation offers, and menu-based tab transfer to a new window.
- Page tools for PNG capture, PDF export, system printing, DevTools, clean-link copying, opening in the Windows default browser, creating `.lnk` desktop shortcuts, and adding page notes.
- Named profiles with separate website storage, browser libraries, settings, and encrypted vaults; an import center for Chrome bookmark files or standard bookmark HTML; and an informational update center for Sutra and Evergreen WebView2.
- A redesigned new-tab canvas and shared manager navigation, searchable categorized settings, combined local library search, offline text reading, versioned session recovery, streamed Sutra Assistant answers, and explicit comparison of selected tabs. See [the upgrade tracker](docs/UPGRADE-TRACKER.md) for implementation and verification status.
- Searchable workspace previews, color/icon labels, reusable templates, and durable recovery of edited or deleted workspaces. Open saved sets in a separate window, or explicitly replace current tabs after saving a recovery snapshot.
- Saved side-by-side, stacked, and focus-left split layouts; paged Downloads with clearer interruption guidance and controls across windows in the same profile; optional history retention with a default of keeping history until explicit deletion.

## Requirements

- Windows 10 version 1809 or newer (Windows 11 recommended)
- x64 Windows
- .NET 8 SDK
- Microsoft Edge WebView2 Evergreen Runtime

The current workspace includes a local SDK under `.dotnet` because the machine initially had runtimes only. That directory is ignored by source control. On a normal developer machine, use the system `dotnet` command instead.

## Build and test

From PowerShell in the repository root:

```powershell
.\.dotnet\dotnet.exe restore SutraBrowser.sln
.\.dotnet\dotnet.exe build SutraBrowser.sln -c Debug -m:1
.\.dotnet\dotnet.exe test SutraBrowser.sln -c Debug --no-build -m:1
```

`-m:1` keeps WinUI/MSBuild memory usage predictable. Replace `.\.dotnet\dotnet.exe` with `dotnet` when using a system SDK.

## Run

```powershell
.\.dotnet\dotnet.exe run --project src\Browser.App\Browser.App.csproj -c Debug
```

Or run:

```text
src\Browser.App\bin\Debug\net8.0-windows10.0.19041.0\win-x64\Sutra.exe
```

Browser data is stored under `%LOCALAPPDATA%\SutraBrowser.Sutra`. Delete that directory only when the application is closed and you intentionally want a completely fresh profile.

Open a private window from the browser menu or with `Ctrl+Shift+N`. Private browsing does not make you anonymous to websites, your network, your employer/school, or an AI provider. Files you download and bookmarks you deliberately create remain after the private window closes; page notes, history, sessions, and other private-window activity do not.

For testing or shortcuts, launching `Sutra.exe --private` opens directly into a private window.

## Sessions and notes

Workspaces can export sessions as `.sutra-session` files. Older `.zephyr-session` and `.luma-session` exports are still accepted by the import dialog for backward compatibility.

Page notes are stored in the local `page_notes` table keyed by normalized HTTP/HTTPS URLs (fragment-free). The optional quotation comes only from the current top-page selection and is treated as untrusted text.

## AI setup

Ollama is the default and expects `http://localhost:11434` with model `llama3.2`; both are configurable. For an OpenAI-compatible service, choose it in Settings, set its endpoint/model, and enter the API key. The key is encrypted for the current Windows account.

Page text is not read continuously. It is collected only after `Summarize page`, a page-reading tool action, or another explicit Sutra Assistant request that needs it. A remote-provider indicator is shown before content is sent. Page text is treated as untrusted content, not as system instructions. Page notes are never sent to an AI provider.

## Packaging

The Debug build is unpackaged and self-contained for x64. To create a release directory:

```powershell
.\.dotnet\dotnet.exe publish src\Browser.App\Browser.App.csproj -c Release -r win-x64 --self-contained true -o artifacts\publish\win-x64
```

The per-user installer is built by `scripts/build-installer.ps1` and written to the repository root as `SutraBrowserSetup.exe`. Its required resources and Evergreen WebView2 Runtime are installed alongside the application. Add `-RequireSigning` with externally provisioned signing credentials for production; an unsigned development installation cannot use signed automatic updates. Do not commit private signing keys.

## Known limitations

These are deliberately identified instead of being represented as complete:

- Tab context menus support transfer to new or existing compatible windows, and sidebar drops support cross-window transfer by recreating the destination controller. Profile/private boundaries and protected tabs prevent unsafe moves. Horizontal-strip cross-window dragging and interactive verification remain pending.
- Bookmark folders, nested editing, HTML transfer, and root bookmark/folder bar ordering are implemented. Chrome bookmark imports preserve folder hierarchy beneath one import root; passwords, cookies, history, extensions, and sessions are not imported.
- Login submission detection is restricted to messages from the exact top-level HTTPS origin. It does not capture cross-origin frames, non-form JavaScript login flows, passkeys, or federated-provider credentials.
- Downloads have search/status filters, process-local pause/resume/cancel, and optional SHA-256 comparison. Resume after restart, queues, and bandwidth control remain pending.
- History supports text/date filtering with a calendar range picker, domain/entry deletion, and hour/day/week/all-time clearing.
- Sutra Assistant comparison uses 2–8 explicitly selected tabs and explains that selected sleeping tabs will wake. Remote page questions and comparisons show the outgoing context before sending; live-provider verification is still required.
- Permission prompts cover WebView2 permission kinds presented by the runtime. Allow/block apply to one request unless you explicitly check “Remember this decision.” Dismissal is never remembered; private choices remain temporary. OS-level device permission may still independently deny access.
- Exact numeric navigation progress is not exposed by WebView2; the UI shows a native indeterminate loading bar.
- Tab previews report each tab's WebView2 renderer working set. Chromium may place several tabs in one renderer process, so shared renderer memory is labelled as shared instead of being inaccurately divided between tabs.
- CSS page zoom is used because the WinUI WebView2 WinRT projection does not expose the WPF `ZoomFactor` convenience property.
- Content blocking implements common network-domain, path/wildcard, exception, and cosmetic selector rules; it does not support the full Adblock Plus grammar, custom scriptlets, extension APIs, or anti-circumvention lists.
- Reader/translation/media controls are best-effort. Site-specific players, DRM, cross-origin frames, and pages that replace standard media controls may limit seeking or picture-in-picture.
- Named-profile libraries are stored under `Libraries/<stable profile key>` inside the data root. Existing shared data remains in Default. Existing simple ASCII website profiles keep their identity; names previously collapsed by punctuation stripping may require a new website sign-in. Profile rename/delete/export and interactive migration checks remain pending.
- Toolbar ordering uses explicit move-up/move-down controls rather than direct toolbar dragging, which avoids accidental address-bar loss.
- Signed installations can check the release feed, verify its RSA signature and the installer's hash/publisher, and stage an update for restart with rollback on installation failure. Unsigned development builds cannot use this channel. A real signed update and rollback still need native verification; Evergreen WebView2 updates remain Microsoft-managed.
- Offline articles store inert extracted text with search and font controls. Full-page/media archives are not implemented. Private windows cannot save or remove articles.
- Recovery retains up to ten distinct snapshots per normal window and one hundred per profile. Normal windows restore sequentially within the adaptive memory budget; deferred windows keep their saved records. Repeated failed starts open a fresh recovery window. Multi-window clean-close/crash behavior still needs native verification.
- The desktop design passes compilation, automated integration checks, and native visual/navigation/edit-persistence smoke checks in an isolated profile. Broader keyboard-only, screen-reader, multiple-DPI, and release-installation verification remains outstanding.

## Roadmap

1. Hardened password/passkey handling for same-origin frames and JavaScript login flows.
2. Horizontal-strip window transfer, custom split-ratio persistence, and bulk bookmark operations.
3. Restart-resumable downloads, queue management, and download scheduling.
4. Full-page offline archiving, QR-code sharing, and site-adapter improvements for reader/media modes.
5. Automated Windows UI smoke tests, accessibility verification, and signed installer/update acceptance.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [SECURITY.md](docs/SECURITY.md) for design details.

The complete 88-item backlog is tracked in [UPGRADE-TRACKER.md](docs/UPGRADE-TRACKER.md). Encrypted sync has been removed. The **Kill switch** is now implemented: open the command palette with `Ctrl+Shift+P` and run `kill-switch`, use the native `Ctrl+Alt+Shift+K` shortcut, or launch `Sutra.exe --kill-switch`. It immediately hides browsing, cancels transfers and assistant tasks, clears history and automatic recovery across local profiles, then exits. Saved workspaces, bookmarks, passwords, articles, and downloaded files remain. An interrupted cleanup is retried before startup opens tabs. Restart older Sutra builds before using the command; cross-process coordination requires the updated build. Native end-to-end verification is still pending.

Repeated failed starts now open a fresh tab with access to selective session recovery. Tab cleanup previews which tabs will sleep or close and explains protected tabs.

Run `./scripts/verify.ps1` for the development checks, or `./scripts/verify.ps1 -Configuration Release -Publish` for a self-contained x64 development package with a SHA-256 manifest. These commands do not sign or publish a release externally.

## Everyday browsing tools

Open `Ctrl+Shift+P` and search for Recently closed tabs, Search shortcuts, Keyboard shortcuts, Reader appearance, Page zoom, or Review duplicate bookmarks. These use the existing browser engine and local storage. No additional dependency is required.

`Ctrl+F` opens live page search with native highlights, case/word options, and match counts; Enter / Shift+Enter navigate matches and Escape closes. Reader mode keeps the original page intact, extracts at most 250,000 characters of visible article text, and provides text-size and appearance controls. Return / Escape restores the original page without reloading it. Save default reader settings with Reader appearance in the palette.

Recently Closed keeps at most 50 entries in memory, with selective reopening; background reopened tabs stay asleep. Download lists refresh every three seconds while selected and cancel their timer on page or window close. Library source filters avoid querying unrelated repositories; note results open the matching note directly. Duplicate bookmark review removes only exact copies within a folder, rechecks them transactionally, preserves a final copy, and offers undo.

Run `npm run test:reader` for the production reader regression fixture. Native WinUI interaction and screen-reader verification are still required for this batch because the desktop automation helper is unavailable. See [BROWSING-IMPROVEMENTS.md](docs/BROWSING-IMPROVEMENTS.md) for the implementation list and validation results.
