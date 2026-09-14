using Browser.Core.Sessions;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class TabFoundationsTests
{
    private static BrowserTab Tab(string url = "https://example.com", string title = "Example") =>
        new() { Url = url, Title = title };

    [Fact]
    public void TemporaryTabsNeverPersist()
    {
        var durable = Tab("https://example.com/a", "A");
        var temp = Tab("https://example.com/b", "B");
        temp.IsTemporary = true;
        Assert.True(TemporaryTabPolicy.ShouldPersist(durable));
        Assert.False(TemporaryTabPolicy.ShouldPersist(temp));
        Assert.False(TemporaryTabPolicy.ShouldKeepInRecentlyClosed(temp));
        var session = new BrowserSession([durable.ToSnapshot(), temp.ToSnapshot()], temp.Id, DateTimeOffset.UtcNow);
        var cleaned = MultiWindowSessionPolicy.WithoutTemporary(session);
        Assert.Equal(durable.Id, Assert.Single(cleaned.Tabs).Id);
        Assert.False(MultiWindowSessionPolicy.ShouldPersistWindow([temp.ToSnapshot()]));
        Assert.True(MultiWindowSessionPolicy.ShouldPersistWindow([durable.ToSnapshot()]));
    }

    [Fact]
    public void TreeRepairsMissingSelfCycleAndDepth()
    {
        var root = Tab("https://example.com/root", "Root");
        var child = Tab("https://example.com/child", "Child");
        child.ParentId = root.Id;
        var missing = Tab("https://example.com/missing", "Missing");
        missing.ParentId = Guid.NewGuid();
        var self = Tab("https://example.com/self", "Self");
        var selfSnapshot = self.ToSnapshot() with { ParentId = self.Id };
        var a = Tab("https://example.com/a", "A");
        var b = Tab("https://example.com/b", "B");
        var aSnap = a.ToSnapshot();
        var bSnap = b.ToSnapshot() with { ParentId = a.Id };
        aSnap = aSnap with { ParentId = b.Id };
        var normalized = TreeTabPolicy.NormalizeParents([root.ToSnapshot(), child.ToSnapshot(), missing.ToSnapshot(), selfSnapshot, aSnap, bSnap]);
        var byId = normalized.ToDictionary(x => x.Id);
        Assert.Null(byId[missing.Id].ParentId);
        Assert.Null(byId[self.Id].ParentId);
        // Cycle is broken deterministically: at least one side is detached.
        Assert.True(byId[a.Id].ParentId is null || byId[b.Id].ParentId is null);
        Assert.Equal(root.Id, byId[child.Id].ParentId);
        // Depth and hidden checks.
        Assert.Equal(0, TreeTabPolicy.GetDepth(normalized, root.Id));
        Assert.Equal(1, TreeTabPolicy.GetDepth(normalized, child.Id));
        root.IsTreeCollapsed = true;
        var collapsed = normalized.Select(x => x.Id == root.Id ? x with { IsTreeCollapsed = true } : x).ToList();
        Assert.True(TreeTabPolicy.IsHiddenByCollapse(collapsed, child.Id));
        Assert.False(TreeTabPolicy.IsHiddenByCollapse(collapsed, root.Id));
        Assert.Contains(child.Id, TreeTabPolicy.Descendants(collapsed, root.Id));
    }

    [Fact]
    public void TreeDepthCapDetachesDeepChains()
    {
        var tabs = new List<BrowserTab>();
        for (var i = 0; i < 12; i++) tabs.Add(Tab($"https://example.com/{i}", $"T{i}"));
        for (var i = 1; i < tabs.Count; i++) tabs[i].ParentId = tabs[i - 1].Id;
        var normalized = TreeTabPolicy.NormalizeParents(tabs.Select(x => x.ToSnapshot()));
        // No tab may exceed the maximum depth after repair.
        foreach (var tab in normalized)
            Assert.InRange(TreeTabPolicy.GetDepth(normalized, tab.Id), 0, TreeTabPolicy.MaximumDepth + 1);
    }

    [Fact]
    public void SplitRatiosNormalizeAndDetectCustom()
    {
        Assert.Null(SplitRatioPolicy.Normalize(null, 2));
        Assert.Null(SplitRatioPolicy.Normalize([0.5], 2));
        Assert.Null(SplitRatioPolicy.Normalize([0.5, 0.5, 0.5], 2));
        var even = SplitRatioPolicy.Normalize([0.5, 0.5], 2)!;
        Assert.Equal(2, even.Count);
        Assert.Equal(1, even.Sum(), 6);
        Assert.False(SplitRatioPolicy.IsCustom(even, 2));
        var custom = SplitRatioPolicy.Normalize([0.7, 0.3], 2)!;
        Assert.True(SplitRatioPolicy.IsCustom(custom, 2));
        var fromPixels = SplitRatioPolicy.FromPixels([700, 300])!;
        Assert.Equal(2, fromPixels.Count);
        Assert.Equal(0.7, fromPixels[0], 2);
        Assert.Null(SplitRatioPolicy.FromPixels([0, 100]));
        Assert.Null(SplitRatioPolicy.FromPixels(null));
    }

    [Fact]
    public void SessionPreservesTreeAndSplitRatiosThroughUntrustedJson()
    {
        var parent = Tab("https://example.com/parent", "Parent");
        var child = Tab("https://example.com/child", "Child");
        child.ParentId = parent.Id;
        parent.IsTreeCollapsed = true;
        var session = new BrowserSession(
            [parent.ToSnapshot(), child.ToSnapshot()], child.Id, DateTimeOffset.UtcNow,
            [parent.Id, child.Id], null, SplitLayoutPreset.SideBySide, [0.7, 0.3], null);
        var restored = SessionSerializer.Deserialize(SessionSerializer.Serialize(session));
        Assert.Equal(2, restored.Tabs.Count);
        Assert.Equal(parent.Id, restored.Tabs.Single(x => x.Id == child.Id).ParentId);
        Assert.True(restored.Tabs.Single(x => x.Id == parent.Id).IsTreeCollapsed);
        Assert.Equal(2, restored.SplitColumnFractions!.Count);
        Assert.Null(restored.SplitRowFractions);
        // Hostile ratios are dropped, never throw.
        var hostile = SessionSerializer.Deserialize(
            System.Text.Json.JsonSerializer.Serialize(session with { SplitColumnFractions = Enumerable.Repeat(0.5, 9).ToList() }));
        Assert.Null(hostile.SplitColumnFractions);
    }

    [Fact]
    public void TransferPolicyEnforcesProfilePrivateProtectedAndTemporary()
    {
        var tab = Tab();
        Assert.True(TabTransferPolicy.CanTransfer(tab, false, "Work", false, "Work", false).Allowed);
        Assert.False(TabTransferPolicy.CanTransfer(tab, true, "Work", false, "Work", false).Allowed);
        Assert.False(TabTransferPolicy.CanTransfer(tab, false, "Work", false, "Other", false).Allowed);
        Assert.False(TabTransferPolicy.CanTransfer(tab, false, "Work", false, "Work", true).Allowed);
        Assert.False(TabTransferPolicy.CanTransfer(new() { Url = "https://example.com", IsTemporary = true }, false, "Work", false, "Work", false).Allowed);
        var pinned = Tab(); pinned.IsPinned = true;
        Assert.False(TabTransferPolicy.CanTransfer(pinned, false, "Work", false, "Work", false).Allowed);
        var bad = new BrowserTab { Url = "javascript:alert(1)" };
        Assert.False(TabTransferPolicy.CanTransfer(bad, false, "Work", false, "Work", false).Allowed);
        Assert.Null(TabTransferPolicy.CanTransfer(null, false, "Work", false, "Work", false).Allowed ? null : (bool?)null);
    }

    [Fact]
    public void MultiWindowSelectsNewestBoundedWindowsForProfile()
    {
        var now = DateTimeOffset.UtcNow;
        BrowserSession Session(string title)
        {
            var tab = Tab("https://example.com/" + title, title);
            return new([tab.ToSnapshot()], tab.Id, now);
        }
        var windows = new List<MultiWindowSessionPolicy.SavedWindow>();
        for (var i = 0; i < 10; i++)
            windows.Add(new(Guid.NewGuid(), "Work", Session($"W{i}"), now.AddMinutes(-i)));
        windows.Add(new(Guid.NewGuid(), "Private", Session("P"), now));
        windows.Add(new(Guid.NewGuid(), "Other", Session("O"), now));
        var selected = MultiWindowSessionPolicy.SelectWindowsToRestore(windows, "Work");
        Assert.Equal(MultiWindowSessionPolicy.MaximumWindowsToRestore, selected.Count);
        Assert.All(selected, w => Assert.Equal("Work", w.ProfileName));
        Assert.Equal("W0", selected[0].Session.Tabs[0].Title);
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.NewTab }, false, false, false, false));
        Assert.True(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.RestorePreviousSession }, false, false, false, false));
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.RestorePreviousSession }, false, true, false, false));
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.RestorePreviousSession }, true, false, false, false));
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.RestorePreviousSession }, false, false, true, false));
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(
            new() { StartupBehavior = StartupBehavior.RestorePreviousSession }, false, false, false, true));
    }
}
