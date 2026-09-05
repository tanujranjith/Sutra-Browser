using Browser.Core.BrowserEngine;
using Xunit;

namespace Browser.Core.Tests;

public sealed class BrowserEngineContractTests
{
    [Fact]
    public void PersistentProfilesNormalizeNamesAndRequireStorage()
    {
        var profile = BrowserProfile.Persistent(" Sutra / School ", "C:\\Data\\Profiles\\School");
        Assert.Equal("SutraSchool", profile.Name);
        Assert.Equal(BrowserProfileKind.Persistent, profile.Kind);
        Assert.Equal("C:\\Data\\Profiles\\School", profile.StoragePath);
        Assert.Throws<ArgumentException>(() => BrowserProfile.Persistent("Default", ""));
    }

    [Fact]
    public void PrivateProfilesRemainExplicitAndBoundsNeverGoNegative()
    {
        var profile = BrowserProfile.Private("private", "C:\\Temp\\Sutra");
        Assert.Equal(BrowserProfileKind.Private, profile.Kind);
        Assert.Equal(new BrowserBounds(0, 0, 0, 12), new BrowserBounds(-1, -2, -3, 12).Clamp());
    }
}
