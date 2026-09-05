using Browser.Core.BrowserEngine;
using Browser.Platform.Windows.Cef;
using Browser.Platform.Windows.Storage;
using Xunit;

namespace Browser.Platform.Windows.Tests;

public sealed class CefRuntimeLayoutTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "SutraCefTests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void PersistentProfilesAreNormalizedAndStayBelowCefRoot()
    {
        var layout = new CefRuntimeLayout(new BrowserPaths(_root));

        var profile = layout.GetPersistentProfile("Work / unsafe: name");

        Assert.Equal(BrowserProfileKind.Persistent, profile.Kind);
        Assert.Equal("Workunsafename", profile.Name);
        Assert.StartsWith(Path.Combine(_root, "Cef", "Profiles"), profile.StoragePath!, StringComparison.OrdinalIgnoreCase);
        Assert.True(Directory.Exists(profile.StoragePath));
    }

    [Fact]
    public void PrivateProfilesCanBeDeletedAfterWindowClose()
    {
        var layout = new CefRuntimeLayout(new BrowserPaths(_root));
        var profile = layout.CreatePrivateProfile("window-123");
        File.WriteAllText(Path.Combine(profile.StoragePath!, "sentinel"), "private");

        layout.DeletePrivateProfile(profile);

        Assert.False(Directory.Exists(profile.StoragePath));
    }

    [Fact]
    public void PrivateCleanupRefusesPathsOutsideThePrivateRoot()
    {
        var layout = new CefRuntimeLayout(new BrowserPaths(_root));
        var outside = BrowserProfile.Private("Private", Path.Combine(_root, "do-not-delete"));

        Assert.Throws<InvalidOperationException>(() => layout.DeletePrivateProfile(outside));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
