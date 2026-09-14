using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class TabCleanupPolicyTests
{
    [Fact]
    public void DuplicatePreviewKeepsActiveAndProtectedCopies()
    {
        var first = new BrowserTab { Url = "https://example.com/page" };
        var active = new BrowserTab { Url = first.Url };
        var pinned = new BrowserTab { Url = first.Url, IsPinned = true };
        var split = new BrowserTab { Url = first.Url };
        var last = new BrowserTab { Url = first.Url };
        var candidates = TabCleanupPolicy.DuplicateCandidates([first, active, pinned, split, last], active.Id, new HashSet<Guid> { split.Id });
        Assert.Equal(new[] { first, last }, candidates);
    }

    [Fact]
    public void DifferentPathCaseTrailingSlashQueryAndFragmentAreNotDuplicates()
    {
        var urls = new[] { "https://example.com/Page", "https://example.com/page", "https://example.com/page/", "https://example.com/page?q=A", "https://example.com/page?q=a", "https://example.com/page#one", "https://example.com/page#two" };
        Assert.Empty(TabCleanupPolicy.DuplicateCandidates(urls.Select(url => new BrowserTab { Url = url }), null, new HashSet<Guid>()));
    }

    [Fact]
    public void DuplicateCleanupIgnoresNativePagesAndPreservesOneExactCopy()
    {
        var first = new BrowserTab { Url = "https://example.com" };
        var second = new BrowserTab { Url = first.Url };
        var third = new BrowserTab { Url = first.Url };
        var candidates = TabCleanupPolicy.DuplicateCandidates([first, second, third, new(), new()], null, new HashSet<Guid>());
        Assert.Equal(new[] { second, third }, candidates);
        first.MayHaveUnsavedFormInput = second.MayHaveUnsavedFormInput = third.MayHaveUnsavedFormInput = true;
        Assert.Empty(TabCleanupPolicy.DuplicateCandidates([first, second, third], null, new HashSet<Guid>()));
    }

    [Fact]
    public void SleepPreviewExplainsProtectionAndReevaluatesChangedState()
    {
        var tab = new BrowserTab { Url = "https://sub.example.com/page" };
        string? Reason() => TabCleanupPolicy.SleepBlockReason(tab, null, false, false, false, true, []);
        Assert.Null(Reason());
        tab.MayHaveUnsavedFormInput = true; Assert.Contains("unsaved", Reason());
        tab.MayHaveUnsavedFormInput = false; tab.HasActiveDownload = true; Assert.Contains("download", Reason());
        tab.HasActiveDownload = false;
        Assert.Contains("excluded", TabCleanupPolicy.SleepBlockReason(tab, null, false, false, false, true, ["example.com"]));
        Assert.Null(TabCleanupPolicy.SleepBlockReason(tab, null, false, false, false, true, ["ample.com"]));
        Assert.Contains("Current", TabCleanupPolicy.SleepBlockReason(tab, tab.Id, false, false, false, true, []));
        Assert.Contains("split", TabCleanupPolicy.SleepBlockReason(tab, null, true, false, false, true, []));
        Assert.Contains("Mini-player", TabCleanupPolicy.SleepBlockReason(tab, null, false, false, true, true, []));
    }
}
