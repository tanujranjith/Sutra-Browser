using Browser.Core.Diagnostics;
using Browser.Core.Search;
using Xunit;

namespace Browser.Core.Tests;

public sealed class PerformancePolicyTests
{
    [Fact]
    public void StartupTimingsNormalizeAndFlagSlow()
    {
        var phases = StartupPerformancePolicy.Normalize([
            new("settings", 120),
            new("  session ", 3000),
            new("session", 10),
            new("", -5),
            new("x", 700_000),
        ]);
        Assert.Equal(2, phases.Count);
        Assert.True(StartupPerformancePolicy.TotalMilliseconds(phases) >= 3000);
        Assert.Contains("session", StartupPerformancePolicy.SlowPhases(phases));
        Assert.False(StartupPerformancePolicy.IsSlowColdStart(phases));
        Assert.True(StartupPerformancePolicy.IsSlowColdStart([new("a", 5000)]));
        Assert.Contains("session", StartupPerformancePolicy.Summarize(phases));
        Assert.Equal("Startup timing unavailable", StartupPerformancePolicy.Summarize([]));
    }

    [Fact]
    public void AdaptiveMemoryNeverRelaxesLimits()
    {
        var normal = new SystemResourceSnapshot(MemoryPressureLevel.Normal, false, 8000);
        Assert.Equal(18, AdaptiveMemoryPolicy.EffectiveTabLimit(18, normal));
        Assert.Equal(30, AdaptiveMemoryPolicy.EffectiveInactivityMinutes(30, normal));
        var critical = new SystemResourceSnapshot(MemoryPressureLevel.Critical, true, 200);
        Assert.True(AdaptiveMemoryPolicy.EffectiveTabLimit(18, critical) < 18);
        Assert.True(AdaptiveMemoryPolicy.EffectiveInactivityMinutes(30, critical) < 30);
        Assert.Equal(1, AdaptiveMemoryPolicy.EffectiveTabLimit(1, critical));
        Assert.Contains("Critical", AdaptiveMemoryPolicy.Describe(critical));
    }

    [Fact]
    public void HealthHistoryBoundsAndSparklines()
    {
        var history = new HealthHistory();
        for (var i = 0; i < 200; i++)
            history.Add(new(DateTimeOffset.UtcNow, 100 + i, 5, 2, i % 50));
        Assert.Equal(HealthHistory.MaximumSamples, history.Samples.Count);
        Assert.NotEqual("no samples", HealthHistory.Sparkline(history.Samples.Select(s => (double)s.ShellMemoryMb)));
        Assert.Equal("no samples", HealthHistory.Sparkline([]));
        Assert.Equal("▁▁▁", HealthHistory.Sparkline([0, 0, 0]));
    }

    [Fact]
    public void PagedQueryNormalizesAndEscapes()
    {
        Assert.Equal((100, 50), PagedQueryPolicy.Normalize(2, 50));
        Assert.Equal((0, 1), PagedQueryPolicy.Normalize(-5, 0));
        Assert.Equal((0, 200), PagedQueryPolicy.Normalize(0, 9999));
        Assert.Equal("\\%\\_\\\\", PagedQueryPolicy.EscapeLike("%_\\"));
    }
}
