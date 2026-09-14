using System.Text.Json;
using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class StartupRecoveryPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RepeatedRecentCrashesRequireReviewInsteadOfAutomaticRestore()
    {
        var first = StartupRecoveryPolicy.Begin(null, true, Now);
        Assert.False(first.NeedsReview);
        var second = StartupRecoveryPolicy.Begin(JsonSerializer.Serialize(first), false, Now.AddSeconds(10));
        Assert.False(second.NeedsReview);
        var third = StartupRecoveryPolicy.Begin(JsonSerializer.Serialize(second), false, Now.AddSeconds(20));
        Assert.True(third.NeedsReview);
        Assert.False(StartupRecoveryPolicy.Begin(JsonSerializer.Serialize(third), true, Now.AddSeconds(30)).NeedsReview);
    }

    [Theory]
    [InlineData(-16)]
    [InlineData(1)]
    public void StaleOrFutureClockRecordsDoNotCauseACrashLoop(int minutes)
    {
        var stored = JsonSerializer.Serialize(new StartupRecoveryState(3, Now.AddMinutes(minutes)));
        Assert.False(StartupRecoveryPolicy.Begin(stored, false, Now).NeedsReview);
    }

    [Theory]
    [InlineData("bad json")]
    [InlineData("null")]
    [InlineData("{\"ConsecutiveFailures\":-999}")]
    public void DamagedRecoveryStateDoesNotBlockStartup(string stored) =>
        Assert.False(StartupRecoveryPolicy.Begin(stored, false, Now).NeedsReview);

    [Fact]
    public void SelectedRecoveryOnlyOpensChosenSafeTabsAndDropsOrphanSplits()
    {
        var chosen = new BrowserTab { Url = "https://example.com/chosen" }.ToSnapshot();
        var other = new BrowserTab { Url = "https://example.com/avoid" }.ToSnapshot();
        var unsafeTab = new BrowserTab { Url = "javascript:alert(1)" }.ToSnapshot();
        var session = new BrowserSession([chosen, other, unsafeTab], other.Id, Now, [chosen.Id, other.Id]);
        var result = StartupRecoveryPolicy.SelectTabs(session, [chosen.Id, chosen.Id, unsafeTab.Id, Guid.NewGuid()]);
        Assert.Equal(chosen.Id, Assert.Single(result.Tabs).Id);
        Assert.Equal(chosen.Id, result.ActiveTabId);
        Assert.Empty(result.SplitTabIds ?? []);
        Assert.Empty(StartupRecoveryPolicy.SelectTabs(session, []).Tabs);
    }
}
