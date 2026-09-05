using Browser.Core.BrowserEngine;
using Browser.Platform.Windows.Storage;

namespace Browser.Platform.Windows.Cef;

/// <summary>
/// Owns CEF's on-disk locations. WebView2 profile folders are intentionally
/// never reused: Chromium storage is an implementation detail and may be
/// locked or incompatible between the runtimes.
/// </summary>
public sealed class CefRuntimeLayout(BrowserPaths paths)
{
    public string RuntimePath => Path.Combine(AppContext.BaseDirectory, "Cef");
    public string RootCachePath => Path.Combine(paths.Root, "Cef");
    public string SubprocessPath => Path.Combine(RuntimePath, "Sutra.CefSubprocess.exe");
    public string HostLibraryPath => Path.Combine(RuntimePath, "Sutra.CefHost.dll");

    public BrowserProfile GetPersistentProfile(string name)
    {
        var profileName = NormalizeProfileName(name);
        var path = Path.Combine(paths.CefProfileRootPath, profileName);
        Directory.CreateDirectory(path);
        return BrowserProfile.Persistent(profileName, path);
    }

    public BrowserProfile CreatePrivateProfile(string windowId)
    {
        var safeId = new string((windowId ?? string.Empty).Where(char.IsLetterOrDigit).Take(64).ToArray());
        if (safeId.Length == 0) safeId = Guid.NewGuid().ToString("N");
        var path = Path.Combine(paths.CefPrivateRootPath, safeId);
        Directory.CreateDirectory(path);
        return BrowserProfile.Private("Private", path);
    }

    public void DeletePrivateProfile(BrowserProfile profile)
    {
        if (profile.Kind != BrowserProfileKind.Private || string.IsNullOrWhiteSpace(profile.StoragePath)) return;
        var privateRoot = Path.GetFullPath(paths.CefPrivateRootPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(profile.StoragePath);
        if (!target.StartsWith(privateRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Refusing to remove a private browser profile outside the private runtime root.");
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
    }

    public void EnsureRuntimeInstalled()
    {
        Directory.CreateDirectory(RootCachePath);
        var missing = new[]
        {
            HostLibraryPath,
            SubprocessPath,
            Path.Combine(RuntimePath, "libcef.dll"),
            Path.Combine(RuntimePath, "chrome_elf.dll"),
            Path.Combine(RuntimePath, "libEGL.dll"),
            Path.Combine(RuntimePath, "libGLESv2.dll"),
            Path.Combine(RuntimePath, "icudtl.dat"),
            Path.Combine(RuntimePath, "chrome_100_percent.pak"),
            Path.Combine(RuntimePath, "resources.pak"),
            Path.Combine(RuntimePath, "v8_context_snapshot.bin"),
            Path.Combine(RuntimePath, "locales", "en-US.pak")
        }.Where(path => !File.Exists(path)).ToList();
        if (missing.Count > 0)
            throw new FileNotFoundException($"The bundled CEF runtime is incomplete. Missing: {string.Join(", ", missing.Select(Path.GetFileName))}");
    }

    private static string NormalizeProfileName(string value)
    {
        var safe = new string((value ?? string.Empty).Where(char.IsLetterOrDigit).Take(50).ToArray());
        return safe.Length == 0 ? "Default" : safe;
    }
}
