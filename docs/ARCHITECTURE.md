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

`App` initializes the database before opening windows and retains each live `MainWindow`. `MainWindowViewModel` owns the tab model. `MainWindow` owns native WebView controls because those controls have UI-thread affinity. All tabs share one lazily created `CoreWebView2Environment`. Normal tabs use the intentional default or named WebView profile; private windows create WebView controllers with `IsInPrivateModeEnabled` and a dedicated private profile name. Named profiles isolate WebView site storage, while Sutra-managed libraries remain device-wide.

Closing or hibernating a tab removes and closes its WebView. The tab model remains lightweight. Waking recreates the control with the shared environment, navigates to the saved URL, and restores the best-effort scroll position. Tab groups, pinned state, split-pane membership, ordering, window sizing, and maximized state are persisted. A timer saves the primary session and evaluates conservative hibernation policy; secondary windows do not overwrite that primary session. Background passes (maintenance, hibernation, memory/media refresh) observe a per-window lifetime cancellation token and are tracked so shutdown cancels them and awaits completion before closing the controls they can touch; cancellation is treated as normal shutdown.

Unknown unhandled UI exceptions are not swallowed: only `OperationCanceledException` is contained as a teardown artifact; anything else terminates the process so the next launch shows the crash-recovery notice truthfully. Diagnostics record exception types only.

Private windows never load or save the normal session. Their history/search recording, persistent permission decisions, download metadata, password access, and AI action logs are disabled. Favicons are cached in a per-window temporary directory and removed on close. Explicit bookmarks and downloaded files remain because those are deliberate user-created artifacts.

The shell is composed in code-behind because WinUI/WebView controls require UI-thread ownership, but browser policy remains in Core. Management surfaces are in-app overlays rather than modal dialogs; confirmations and secret entry remain modal where focus and explicit consent are important. The new-tab dashboard is rendered as one browser-owned local document after bounded local-data reads; it never navigates through a temporary loading document.

## Persistence

`BrowserDatabase.InitializeAsync` applies ordered, transactional migrations recorded in `schema_migrations`. Repositories own SQL for history, bookmarks/folders, workspaces, reading-list items, page notes, app state and sessions, downloads, password metadata, permissions, and AI action logs. WAL, foreign keys, busy timeout, and focused indexes are enabled.

Session and settings saves go through a single non-UI `PersistencePassCoordinator` because both write the same SQLite app_state store: at most one write runs at a time, requests arriving mid-pass coalesce into one trailing pass that serializes live state, and shutdown awaits a deterministic flush before marking the exit clean. Private windows never participate in session persistence.

Page notes attach an optional top-level selection quotation plus text to normalized HTTP/HTTPS targets (fragment-free, credential-free). Note validation and URL normalization live in `Browser.Core.Notes`; notes never reach AI providers or action logs, and private windows can neither create nor persist them. The `offline_articles` table from migration 4 is reserved for future offline archiving and is intentionally dormant.

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
