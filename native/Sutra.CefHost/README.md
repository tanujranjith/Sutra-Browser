# Sutra native CEF host

This project builds the narrow native ABI used by `Browser.Platform.Windows.Cef`.
The pinned Windows x64 CEF distribution is recorded in `CEF_VERSION.txt`; its
large binaries are intentionally excluded from source control.

Prerequisites:

- Visual Studio 2022 Build Tools with **Desktop development with C++**
- CMake tools for Windows
- The pinned standard Windows x64 CEF distribution extracted below
  `third_party/cef`

From the repository root:

```powershell
.\scripts\build-cef.ps1 -Configuration Debug
.\scripts\build-cef.ps1 -Configuration Release
```

The script configures CMake for x64, builds `Sutra.CefHost.dll` and
`Sutra.CefSubprocess.exe`, and stages the complete runtime and license notices
under `artifacts/cef/runtime/<Configuration>`. `Browser.App.csproj` copies an
available staged runtime into its `Cef` output and publish folder.

CEF profiles are separate from the legacy WebView2 profile. Persistent profiles
live below the Sutra browser data root; private profiles are window-scoped and
must be deleted only after all surfaces using the request context have closed.
