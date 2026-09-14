# Shipping engine and expansion boundaries

The shipping browser uses WebView2 Evergreen, the shared WebViewEnvironmentManager,
WinUI controllers, and an unpackaged x64 build. The CEF ABI, presenter, and engine
contract remain experimental. Adding a second engine to the build is not a migration.

Before switching the shipping engine, require equivalent navigation, popup sign-ins,
downloads, private profiles, permission handling, content filtering, favicon capture,
printing, PDF export, keyboard ownership, hibernation, media, accessibility, and AI
origin/message validation. Run the same lifecycle and privacy regression suite against
both engines. A CEF release also requires runtime security-update delivery, sandbox
verification, license packaging, and Windows UI tests. Do not weaken these requirements
to expose a feature checkbox.

Extension support is a feasibility project. Verify supported APIs against the actual
SDK/runtime, permission prompts, isolated execution, extension lifecycle, update trust,
and compatibility with the browser's credential/AI boundaries. WebView2 extension APIs
are not a promise of complete Chrome-store compatibility.

ARM64 requires a separately verified native dependency and packaging matrix. macOS and
Linux require new platform and UI layers; keep policy/data/provider libraries reusable,
but do not describe the WinUI application as cross-platform.

## Delivery requirements

`scripts/verify.ps1 -Configuration Release -Publish` produces a self-contained x64
development directory, checks required WinUI/new-tab assets, and writes a SHA-256
artifact manifest. It does not sign, publish, or claim a trusted update feed. A production
release additionally needs a publisher certificate or signing service, an installer,
a signed feed at a chosen HTTPS origin, signature verification, and rollback testing.
Never place signing keys in the repository or generate a self-signed certificate and
present it as a trusted publisher identity.

Encrypted sync is out of scope at the user's request. Browser libraries and encrypted
backups remain local; no synchronization backend or device enrollment is planned.

Profile controller names follow Microsoft's [ProfileName constraints](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controlleroptions.profilename).
Simple ASCII names retain their existing controller names. Punctuation is preserved;
non-ASCII names use an ASCII digest so distinct names do not collapse together. Old
punctuation-stripped controller directories remain on disk; affected users may need
to sign in again under the corrected isolated name.
