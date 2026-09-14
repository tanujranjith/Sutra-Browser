using Browser.Core.Privacy;
using Xunit;

namespace Browser.Core.Tests;

public sealed class KillSwitchPolicyTests
{
    [Theory]
    [InlineData("--kill-switch", true)]
    [InlineData("--KILL-SWITCH", true)]
    [InlineData("https://example.com/--kill-switch", false)]
    [InlineData("kill-switch", false)]
    [InlineData("--kill-switch=false", false)]
    public void RequiresExactLaunchArgument(string argument, bool expected) =>
        Assert.Equal(expected, KillSwitchPolicy.IsLaunchRequested([argument]));
}
