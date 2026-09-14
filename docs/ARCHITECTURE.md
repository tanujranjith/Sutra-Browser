# Architecture

The solution keeps policy and persistence independent of WinUI so the security-sensitive behavior can be tested without launching WebView2.

```text
Browser.App (WinUI composition, dialogs, lifecycle)
  ├── Browser.Core (navigation, tabs, sessions, settings, credential contracts)
  ├── Browser.Data (SQLite migrations and repositories)
  ├── Browser.AI (providers, action parser, safety policy, bounded loop)
  └── Browser.Platform.Windows (DPAPI/AES vault, paths, shared WebView environment)
```

## Browser lifecycle

`App` initializes the database before opening windows and retains each live `MainWindow`. `MainWindowViewModel` owns the tab model. `MainWindow` owns native WebView controls because those controls have UI-thread affinity. All tabs share one lazily created `CoreWebView2Environment`. Normal tabs use the default or named WebView profile; private windows use `IsInPrivateModeEnabled`. `ProfileLibraries` provides separate named-profile databases and encrypted vault directories without creating per-tab environments. Existing shared libraries remain in Default. `ProfileDirectoryRepository` stores the global profile list independently of stale per-window settings and reads legacy settings without a write during inspection.

Closing or hibernating a tab removes and closes its WebView. The tab model remains lightweight. Waking recreates the control with the shared environment, navigates to the saved URL, and restores the best-effort scroll position. Tab groups, pinned state, split-pane membership, ordering, window sizing, and maximized state are persisted. A timer saves the primary session and evaluates conservative hibernation policy; secondary windows do not overwrite that primary session. Background passes (maintenance, hibernation, memory/media refresh) observe a per-window lifetime cancellation token and are tracked so shutdown cancels them and awaits completion before closing the controls they can touch; cancellation is treated as normal shutdown.

Unknown unhandled UI exceptions are not swallowed: only `OperationCanceledException` is contained as a teardown artifact; anything else terminates the process so the next launch shows the crash-recovery notice truthfully. Diagnostics record exception types only.

Private windows never load or save the normal session. Their history/search recording, persistent permission decisions, download metadata, password access, and AI action logs are disabled. Favicons are cached in a per-window temporary directory and removed on close. Explicit bookmarks and downloaded files remain because those are deliberate user-created artifacts.

The shell is composed in code-behind because WinUI/WebView controls require UI-thread ownership, but browser policy remains in Core. Management surfaces are in-app overlays rather than modal dialogs; confirmations and secret entry remain modal where focus and explicit consent are important. The new-tab dashboard is rendered as one browser-owned local document after bounded local-data reads; it never navigates through a temporary loading document.

## Persistence

`BrowserDatabase.InitializeAsync` applies ordered, transactional migrations recorded in `schema_migrations`. Repositories own SQL for history, bookmarks/folders, workspaces, reading-list items, page notes, app state and sessions, downloads, password metadata, permissions, and AI action logs. WAL, foreign keys, busy timeout, and focused indexes are enabled.

Session and settings saves go through a single non-UI `PersistencePassCoordinator` because both write the same SQLite app_state store: at most one write runs at a time, requests arriving mid-pass coalesce into one trailing pass that serializes live state, and shutdown awaits a deterministic flush before marking the exit clean. Private windows never participate in session persistence.

Page notes attach an optional top-level selection quotation plus text to normalized HTTP/HTTPS targets (fragment-free, credential-free). Note validation and URL normalization live in `Browser.Core.Notes`; notes never reach AI providers or action logs, and private windows can neither create nor persist them. Markdown export escapes active markup. Migration 5 extends the existing `offline_articles` table with inert text and a date index; legacy archive paths are preserved. Core quota/URL policies constrain saves, and the native reader executes no archived HTML or scripts.

Migration 6 adds bounded per-window session snapshots with content fingerprints and recovery into a separate window. Session normalization rejects credential-bearing URLs, executable schemes, remote file shares, oversized imports, duplicate IDs, and orphan group/split references. Cross-window transfer recreates controllers on the destination UI thread after profile/private and activity checks. Versioned recovery does not yet automatically recreate all prior windows at startup.

`StartupRecoveryPolicy` tracks repeated failed normal starts within fifteen minutes and suppresses automatic restoration after two failures. Recovery offers inert tab previews and selected-tab copies. The last primary session is retained while the fresh recovery window is open. Tab cleanup decisions live in `TabCleanupPolicy`; the native preview rechecks live protection and duplicate status before execution.

Migration 8 adds `privacy_state`. Every initialized history/session writer keeps an immutable epoch, and SQL checks it inside the write transaction. `KillSwitchRepository` advances the epoch and deletes automatic browsing/recovery records together. `KillSwitchService` owns durable local requests and process leases under the data root; it covers inactive hashed libraries and records completion only after engine history cleanup. App hides windows and closes native controllers before releasing its process lease, then clears WebView history on the UI thread through the shared environment. A launch racing a kill request cannot register for browsing until cleanup is complete.

Migration 7 adds workspace appearance/template columns, durable `workspace_versions`, and a downloads date index. Workspace updates, detail edits, and deletion capture prior state in the same immediate transaction; failed renames roll back both mutations. Retention keeps at most 20 versions per workspace and 200 per profile, including deleted workspaces. Restoring inserts a separately named copy and never overwrites a name collision. `WorkspacePolicy.Instantiate` remaps tabs, groups, active selection, and split references together so repeated template/recovery launches do not share IDs.

`SplitLayout` computes pane placement in Core, while App owns grid rows, spanning WebViews, and drag handles. Preset choice is part of the backward-compatible session record. Download search returns at most one page plus a next-page sentinel. Active controls resolve the owning window within a profile, with private controls limited to their own window. Transfer state is not rewritten on application startup because another Sutra process may still own it. Failure guidance maps known [WebView2 interruption reasons](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2downloadinterruptreason?view=webview2-dotnet-1.0.3595.46) to fixed user-facing text; unknown payloads are not displayed. Pause intent is tracked explicitly because runtime/projection documentation differs on the cancellation reason emitted by Pause.

Streaming providers decode bounded SSE or NDJSON records. Sutra Assistant compares explicitly selected tabs, previews remote context, renders plain text, and links original sources. The deterministic AI action parser, safety classification, audit policy, and execution bounds remain separate from model output. See [ENGINE-DECISION.md](ENGINE-DECISION.md) for the shipping WebView2 versus experimental CEF decision.

Settings and sessions are JSON values in `app_state`; malformed settings are replaced or clamped by `SettingsValidator`, and corrupt session entries are ignored by `SessionSerializer`.

Content blocking is a deterministic local request interceptor. `Browser.Core` parses a deliberately small ABP-compatible subset (domain and path/wildcard block/exception rules plus safe CSS selectors); the app applies network responses and cosmetic CSS. Downloaded lists live outside SQLite and update only after an explicit user action. The original list remains active if an update fails.

## AI boundary

Providers implement `IAiProvider`; provider HTTP details do not leak into the action system. `AgentLoop` accepts only a `BrowserAction` JSON shape, applies deterministic risk classification, asks an `IActionApproval` immediately before consequential actions, enforces provider/action timeouts and action count, and delegates to `IBrowserActionExecutor`.

The UI executor exposes only browser capabilities. There is no shell, filesystem, arbitrary C#, or raw WebView object tool. Element operations use temporary `data-sutra-element-id` values from a sanitized DOM map. Password inputs are excluded from maps and typing into them is refused. Credential autofill is an internal approved flow and never returns the secret as an observation.

## Extension points

- Add an AI provider by implementing `IAiProvider`.
- Add browser actions by extending `BrowserActionType`, parser validation, safety classification, executor behavior, and tests together.
- Add a migration by appending a monotonically increasing `Migration` entry; never mutate an already released migration.
- Add a secret backend through `ISecureCredentialStore`; SQLite must continue to hold metadata only.
