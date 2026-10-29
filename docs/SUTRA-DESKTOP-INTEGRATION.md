# Sutra desktop integration

Sutra hosts the unmodified Sutra frontend from `vendor/Sutra` and opens to Sutra Home. The shared desktop header exposes Home, Homework, Create, Timeline, Review & Tests, College, Life, Sutra Assistant, and Browser. At narrower window widths these destinations become one section picker. Website tabs remain in Browser's separate vertical sidebar and compact toolbar. Desktop-only bridge code lives under `src/Browser.App/Views/SutraIntegration`; it is injected only into the pinned `https://sutra.local` workspace. The bridge accepts versioned, bounded messages for source capture, homework/deadline creation, PDF import, Assistant context, and opening a page beside Notes. Capture waits for durable workspace hydration and confirms the result before reporting completion.

The Browser sidebar offers Add to Notes, Create Homework, Add Deadline, Save Source, Open beside Note, and Sutra Assistant. Research Collections, selection annotation, and Save PDF to Sutra are available under the Browser menu's Save to Sutra submenu. Homework/deadline capture uses a right-hand panel with the page title, favicon, source URL, optional class, date/time, difficulty, and notes. Collections are Notes hierarchies under `Research::<collection>`; each source keeps its URL, quotation, and optional annotation. Assistant context becomes a draft for the user to send and labels page text as untrusted. Sutra's encrypted `.sutra` import/export remains available in its own workspace.

The navy/purple desktop shell follows the approved mockups. Open beside Note displays the actual Sutra editor beside the live page, with a compact formatting toolbar and bounded More menu. Returning to the full workspace restores its original controls. The Browser overlay hides duplicate Sutra navigation and does not change the vendored frontend or its saved theme preferences. Visual comparison evidence and accepted native-control differences are recorded in [design-qa.md](../design-qa.md).

## Upstream sync and releases

`.github/workflows/upstream-sync.yml` polls `tanujranjith/Sutra` hourly with read-only `git clone`, runs Sutra's `npm ci`, `npm run check:all`, and `npm run test:unit`, then checks the candidate with the Browser build, .NET tests, and Windows headless Edge integration tests. A failed check restores the previous vendor copy before any commit or release. Browser-owned changes stay outside `vendor/Sutra`. The workflow commits only the validated vendor copy to Sutra. `UPSTREAM_COMMIT` records the exact source revision; no command pushes to Sutra.

On a Browser source push to `main`, the workflow runs the same checks and publishes a signed release when the `SUTRA_AUTO_PUBLISH` repository variable is `true`. Configure `SUTRA_SIGNING_CERT_BASE64` and `SUTRA_SIGNING_CERT_PASSWORD` as repository secrets. The PFX is loaded for the build and manifest-signing steps only; the scripts delete temporary certificate material and remove the certificate from the temporary user store. Never commit signing credentials. Published releases contain the signed installer and an RSA-signed `update.json` feed. A signed installation verifies the feed, installer SHA-256, and Authenticode publisher before staging it to install on restart.

The release channel uses `https://github.com/tanujranjith/Sutra-Browser/releases/latest/download/update.json`. Changing that location or rotating the signing certificate requires shipping a compatible trust update to installed clients first.

At desktop startup, the workspace bypasses its hosted service worker and HTTP asset cache. The bundled files already work offline, and this avoids an old cached asset hiding a newly installed Sutra fix. This does not clear IndexedDB, attachments, cookies, or workspace settings. The updater runs from outside the install directory, keeps an install-tree rollback copy, and suppresses retries of the same failed release hash. User data stays outside the install tree.

## Build the installer locally

On x64 Windows, install the .NET 8 SDK, Inno Setup 6, Windows SDK SignTool, and the Evergreen WebView2 Runtime or allow Setup to install the Evergreen bootstrapper. Run:

```powershell
./scripts/build-installer.ps1 -Configuration Release
```

This creates `SutraBrowserSetup.exe` in the repository root. For a signed build, provide the two signing secrets through the process environment and add `-RequireSigning`. Setup installs app resources per user under `%LOCALAPPDATA%\Programs\Sutra`; it does not remove browser or Sutra workspace data when upgrading or uninstalling. Setup checks all documented runtime registry locations, runs the verified Microsoft bootstrapper if needed, and stops before installing the app if runtime installation fails. The bootstrapper needs internet access when the runtime is missing.

An unsigned development installer can be built without credentials. Its automatic update channel is deliberately disabled because the release publisher cannot be verified. A production certificate must be a trusted Authenticode certificate with an RSA private key; credentials and the certificate remain outside source control.

## Extensions and PDFs

Extension management is per browser profile. Sutra can install, enable, disable, and remove compatible local unpacked extensions, and shows requested permissions before installation. WebView2's documented API installs from a local unpacked extension folder and does not provide a Web Store installer, so store links are not represented as direct installation support. Compatibility still depends on the extension APIs implemented by the installed Evergreen Runtime.

Browser tabs use WebView2's PDF reading and downloading. **Save PDF to Sutra** opens a local PDF picker (download the browser PDF first), then imports the selected file into Sutra's existing PDF annotation workspace. The import is bounded to 32 MB and uses a temporary, same-origin native response available only to the workspace. Highlights and other annotations use Sutra's existing PDF tools; original PDF bytes are kept separately and can be exported unchanged. Sutra does not claim full Edge PDF parity.

## Blocking and element hiding

The blocker parses standard ABP network patterns, anchors, bounded regular expressions, exceptions, resource types, domain restrictions, third-party rules, and CSS cosmetic rules from EasyList/EasyPrivacy. Third-party detection uses the bundled Mozilla Public Suffix List, including private domains. Unsupported scriptlets, request rewrites, and other advanced rule options are skipped instead of broadening their effect. There is no claim of full uBlock Origin compatibility.

Lists refresh every 24 hours while protection is enabled. Size limits, minimum valid-rule checks, atomic promotion, and a last-known-good copy protect against failed refreshes. The privacy shield menu includes **Hide an element on this site** and **Undo last hidden element**. Click an element to hide it; Escape cancels. Rules are stored locally for the exact hostname. Private windows do not save picker rules.

## Data boundaries

The Sutra frontend uses its own named WebView2 profile, separate from website profiles. Browser reset/clear-data actions apply to website profiles and do not target the Sutra workspace profile. Normal browser sessions restore by default. Private windows do not restore or persist browser sessions, history, permission decisions, or extension state.

## Verification and remaining release gates

The [2026-10-28 change log](CHANGELOG.md) records the current sweep, fixes, test
counts, and browser-environment limitations. The dated checks below remain the
earlier integration/design evidence, not a new native release acceptance run.

Development verification on 2026-10-02: the x64 solution builds successfully and all 298 .NET tests pass (220 Core, 54 Data, 15 AI, 9 Windows). Eight Edge checks pass, covering immediate-reload durability and the desktop note presentation in addition to capture workflows. Native Windows checks in an isolated test profile confirmed Home startup, restoring a normal browser tab, navigation between workspace/Browser/Notes, capture-panel layout, and a typed note edit surviving navigation and restart. See the design QA report for viewport evidence.

Earlier integration verification on 2026-10-01 passed all 625 upstream Sutra unit tests and the failing-sync fixture. SHA-256 comparisons confirmed all 870 upstream tracked files in the vendor copy were unchanged. This design pass makes no edits to `vendor/Sutra`. The local updater build reports NuGet availability/ILLink fallback warnings; they do not prevent compilation. The root installer is an unsigned development build, and no release or upstream write was performed.

Run the Browser checks on x64 Windows:

```powershell
$env:DOTNET_ROOT = (Resolve-Path ./.dotnet).Path
./.dotnet/dotnet.exe restore SutraBrowser.sln
./.dotnet/dotnet.exe build SutraBrowser.sln -c Debug -m:1
./.dotnet/dotnet.exe test SutraBrowser.sln -c Debug --no-build -m:1
npm ci --ignore-scripts
npm run test:desktop
./scripts/test-upstream-sync.ps1
```

Six Edge tests load the real vendored Sutra frontend and desktop overlay and simulate the WebView2 message transport. They cover durable source/Collections capture, tasks/deadlines, Assistant draft/origin isolation, invalid actions, PDF annotations with unchanged original export, and desktop navigation/note toolbar presentation. The last test checks overflow-menu bounds at 650px and 390px pane widths, duplicate-navigation suppression, theme presentation, and restoring upstream toolbar controls. Two additional Edge tests execute the production element-picker script and cover real-click selection, synthetic-click rejection, usable hide selectors, undo, and Escape cancellation. These automated tests do not drive native WinUI controls or prove installation/upgrade behavior. The sync fixture verifies that an intentionally failing candidate cannot replace the vendored source.

The pinned upstream revision `84cbbdf80b299cf495d3e7eefd9408ef4ceb16f0` passes its 625 unit tests, but its unchanged `npm run check:all` currently fails the runtime-size gate: `src/core/app.js` is 5,000,137 bytes against a 4,913,747-byte budget. No upstream source or budget was changed. The scheduled release pipeline remains gated on this check passing in upstream.

Before production publication, provision the external signing identity and run these native checks in a disposable x64 Windows user/VM:

- Install, upgrade, and uninstall; confirm browser and Sutra data survive.
- Missing-runtime install with internet access and a deliberately failed bootstrapper.
- Extend the completed workspace/Browser/Notes navigation checks to multi-window, keyboard-only, screen-reader, and multiple-DPI acceptance.
- Restore multiple normal windows after clean close and crash; exclude private windows.
- Clear browser data and confirm Sutra Notes, tasks, attachments, and PDF annotations survive.
- Install an unpacked extension after reviewing permissions; enable/disable/remove it; confirm it cannot access the workspace profile.
- Publish a signed fixture release; verify feed and installer signatures, tampered-release rejection, successful restart update, and rollback after a failed install.

The remaining native release checks and a real signed release are not represented as completed by the headless frontend tests or the design smoke check.
