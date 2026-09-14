using Browser.Core.Profiles;
using Xunit;

namespace Browser.Core.Tests;

public sealed class ProfileIdentityTests
{
    [Fact]
    public void ProfileDirectoriesAreStableAndDoNotCollideAfterPunctuationRemoval()
    {
        Assert.Equal(ProfileIdentity.DirectoryKey("Work"), ProfileIdentity.DirectoryKey(" work "));
        Assert.NotEqual(ProfileIdentity.DirectoryKey("Work-team"), ProfileIdentity.DirectoryKey("Workteam"));
        Assert.Equal(64, ProfileIdentity.DirectoryKey("Personal").Length);
        Assert.Equal("Sutra-Work", ProfileIdentity.WebViewName("Work"));
        Assert.NotEqual(ProfileIdentity.WebViewName("Work-team"), ProfileIdentity.WebViewName("Workteam"));
        Assert.InRange(ProfileIdentity.WebViewName("学习").Length, 1, 64);
        Assert.All(ProfileIdentity.WebViewName("学习"), c => Assert.True(c <= 127));
    }

    [Theory]
    [InlineData("../Default")]
    [InlineData("C:\\vault")]
    [InlineData("x/y")]
    public void RejectsPathsInProfileNames(string name) => Assert.Throws<ArgumentException>(() => ProfileIdentity.Normalize(name));
}
