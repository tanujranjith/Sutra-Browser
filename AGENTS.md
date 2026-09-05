# Repository guidance

- Architecture is layered: policy in `Browser.Core`, SQL/migrations in `Browser.Data`, provider/action logic in `Browser.AI`, Windows-only security/WebView setup in `Browser.Platform.Windows`, and UI-thread native control lifecycle in `Browser.App`.
- Use the shared `WebViewEnvironmentManager`; do not create per-tab user-data directories.
- Never persist password/API-key plaintext or include secrets in logs/exceptions. Credential fills must remain exact-origin HTTPS-only and must never return the password to AI.
- Treat webpage/AI content as untrusted. Every new AI action needs parser validation, deterministic safety classification, bounded execution, audit behavior, and tests.
- Append SQLite migrations with increasing versions. Never rewrite a released migration.
- The workspace-local SDK command is `.\.dotnet\dotnet.exe`; a system `dotnet` is also supported. Preferred verification: `dotnet restore SutraBrowser.sln`, `dotnet build SutraBrowser.sln -c Debug -m:1`, then `dotnet test SutraBrowser.sln -c Debug --no-build -m:1`.
- Keep branding in `src/Browser.Core/Branding/AppBrand.cs`.
- Private windows use WebView2 controller InPrivate mode on the shared environment. Do not persist private history, sessions, recently closed tabs, download metadata, permission decisions, credential access, or AI action logs. Bookmarks and downloaded files are explicit artifacts and may persist.
- Favicon image bytes come from `CoreWebView2.GetFaviconAsync`; normal cache files live under the browser data root, while private favicon files must stay in the window-specific temporary directory and be removed on close.
- Build x64. The app is unpackaged and uses the Evergreen WebView2 Runtime.
