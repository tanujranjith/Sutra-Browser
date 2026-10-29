using Browser.Core.Diagnostics;
using Xunit;

namespace Browser.Core.Tests;

public sealed class MemoryRestorePolicyTests
{
    [Theory]
    [InlineData(MemoryPressureLevel.Normal, 8, 8)]
    [InlineData(MemoryPressureLevel.Elevated, 8, 2)]
    [InlineData(MemoryPressureLevel.Critical, 8, 1)]
    [InlineData(MemoryPressureLevel.Elevated, 1, 1)]
    [InlineData(MemoryPressureLevel.Critical, 0, 0)]
    public void WindowRestoreLimitShrinksWithSystemPressure(MemoryPressureLevel pressure, int configuredMaximum, int expected)
    {
        var snapshot = new SystemResourceSnapshot(pressure, false, 4096);
        Assert.Equal(expected, AdaptiveMemoryPolicy.MaximumWindowsToRestore(configuredMaximum, snapshot));
    }

    [Fact]
    public void RestoreLoopRechecksPressureAfterEachWindow()
    {
        var normal = new SystemResourceSnapshot(MemoryPressureLevel.Normal, false, 8192);
        var critical = new SystemResourceSnapshot(MemoryPressureLevel.Critical, false, 256);

        Assert.True(AdaptiveMemoryPolicy.CanRestoreAnotherWindow(1, 8, normal));
        Assert.False(AdaptiveMemoryPolicy.CanRestoreAnotherWindow(1, 8, critical));
        Assert.False(AdaptiveMemoryPolicy.CanRestoreAnotherWindow(2, 8,
            new SystemResourceSnapshot(MemoryPressureLevel.Elevated, false, 2048)));
    }
}
