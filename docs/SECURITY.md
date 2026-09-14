# Security and privacy notes

## Credentials and API keys

Secrets are serialized only long enough to encrypt them with AES-256-GCM. Each record has a fresh 96-bit nonce, a 128-bit authentication tag, and the credential ID as associated data. The random 256-bit master key is protected by Windows DPAPI with `DataProtectionScope.CurrentUser`. Ciphertext records and the DPAPI-protected key live under the application data directory; only non-secret origin/username metadata is in SQLite.

Credential lookup requires an exact normalized HTTPS origin, including a non-default port. HTTP filling and subdomain inheritance are rejected. Autofill asks the user and executes inside WebView2; password strings are never sent through the AI provider or action log. Clipboard password copies are cleared after 30 seconds if the clipboard still contains the copied value.

The browser observes password-form submission only to offer a native save/update prompt. The WebView message source must match the exact top-level HTTPS origin; cross-origin frame messages, HTTP pages, private windows, blank usernames, and oversized secret values are rejected. The password is held only for the prompt/save operation, is never logged or sent to AI, and is discarded afterward. Sites using non-form JavaScript login flows may require manual save.

## AI data handling

- No page is uploaded continuously.
- Page text is read only after an explicit Sutra Assistant operation.
- Visible text and a sanitized interactive-element map are used; hidden scripts, full HTML, cookies, local storage, password fields, and tokens are excluded.
- Remote page questions and comparisons preview the outgoing context before sending and display a sending indicator. Provider streams have event, response, and output bounds; stop and window closure cancel requests.
- The model cannot approve its own consequential action.
- Action logs contain action type, domain, timestamp, result, and confirmation status—never typed field content or credentials.
- Provider exceptions are shown without request headers or secrets; the UI shows a fixed actionable summary and diagnostics record only the exception type.
- Page notes are local-only plain text: the optional quotation comes from the top-level page selection only, is length-bounded, and is never sent to an AI provider or included in action logs.

Treat any page content as potentially hostile prompt injection. New tools must preserve the separation between untrusted observations, deterministic safety policy, and user approval.

## Site permissions and profile data

Permission decisions are keyed by exact origin and WebView2 permission kind. Non-HTTPS permission requests are denied. “Allow once” is not persisted. Browser cookies/cache remain in the shared WebView2 profile until cleared through profile APIs or by removing the application profile while the browser is closed.

Named profiles use separate Sutra databases and encrypted vault directories alongside distinct website profiles on the shared environment. Default retains existing shared data. Cross-window tab transfer requires matching profile and private status. Offline articles are bounded inert text, never executable page archives. Browser-owned new-tab actions require the selected logical new tab and an exact match between the trusted document, current WebView source, and message source.

Ad/tracker checks happen locally against built-in or explicitly downloaded filter lists. Per-site exceptions are domain-scoped and visible in the shield panel. This is a useful blocker, not an anonymity or anti-fingerprinting guarantee, and the supported filter syntax is intentionally narrower than a full browser-extension engine.

Custom new-tab images are copied into the browser's `Customization` data directory. Only supported image extensions inside that directory, under 20 MB, are read and embedded into the local new-tab document. Cross-tab search is explicit, reads only already-awake tabs, stays on-device, and never wakes or uploads a hibernated tab.

## Private browsing

Private windows use WebView2 InPrivate controller mode. Sutra does not write private-window history, typed searches, sessions, recently closed tabs, download metadata, permission decisions, AI action logs, or page notes; note saving is disabled there with an explanation. Existing persistent notes remain readable in the private utility sidebar by design — the same deliberate visibility as bookmarks and the reading list — but private windows can never create, edit, or delete notes. Saved-password access and password saving are disabled. Sutra Assistant starts disabled and requires explicit per-window enablement; it still shows whether content goes to a local or remote provider.

Bookmarks deliberately created in a private window and files downloaded to disk remain. Private browsing does not provide anonymity, anti-fingerprinting, a VPN, or conceal activity from websites, networks, employers/schools, download destinations, or an invoked AI provider. Content blocking remains enabled but is not an anonymity guarantee.

Private windows never save recovery snapshots or offline articles. The new combined library search excludes persistent history, notes, and workspaces in private windows. Profile-directory inspection is read-only; creating profiles is disabled in private windows. Native end-to-end disk-persistence verification remains required for the expanded feature set.

Workspace saves, imports, exports, version recovery, and edits are disabled in private windows. Normal workspace replacements save a recovery snapshot of tab addresses after explicit replacement confirmation; snapshots cannot preserve form contents. Optional age-based history retention runs only in normal windows on startup and hourly, and is off by default. Enabling or shortening retention requires confirmation in Settings. Download controls cannot cross a profile or private-window boundary.

## Kill switch

The kill switch is a direct native user command, keyboard accelerator, or exact launch
argument. It is not exposed as an AI action or webpage message. It clears normal-profile
browsing/typed-search history, recently closed records, automatic sessions, and recovery
snapshots. Explicit saved artifacts and credentials are preserved. Private windows do not
persist extra browsing records when this command is used.

Monotonic SQL epochs fence old writers out after cleanup. Persistent request/completion
markers contain only revision numbers, and process lease names contain only revisions and
random IDs. Cleanup rejects redirected library paths and does not traverse artifact or
credential directories. The completion marker is written only after participating browser
processes close controllers and WebView history clearing succeeds. Failures keep a pending
request for retry before normal startup. Cross-process guarantees require all participating
processes to use a build with this protocol; native end-to-end verification remains pending.

## Logging rules

Never log passwords, API keys, bearer tokens, cookies, raw authorization headers, private form contents, or full AI payloads. Catch blocks should report exception types or safe summaries. Do not add secrets to `appsettings.json`, environment examples, test fixtures, source control, or SQLite.

The global UI exception handler contains only `OperationCanceledException` (normal teardown). Every other unhandled exception is recorded by type and left unhandled so the process terminates and crash recovery stays truthful.
