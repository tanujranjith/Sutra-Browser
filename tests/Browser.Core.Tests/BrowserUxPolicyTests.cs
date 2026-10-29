using Browser.Core.Navigation;
using Browser.Core.Search;
using Xunit;

namespace Browser.Core.Tests;

public sealed class BrowserUxPolicyTests
{
    [Theory]
    [InlineData("Downloads", "downlaods")]
    [InlineData("GitHub", "githb")]
    [InlineData("Settings", "settongs")]
    public void OneCharacterTyposMatchButNeverOutrankTheCorrectText(string title, string typo)
    {
        var fuzzy = TextMatchRanking.Rank(title, "", typo);
        Assert.True(fuzzy > TextMatchRanking.NoMatch);
        Assert.True(TextMatchRanking.Rank(title, "", title) > fuzzy);
        Assert.Equal(TextMatchRanking.NoMatch, TextMatchRanking.Rank(title, "", "unrelated"));
    }

    [Fact]
    public void TermsCanMatchAcrossTitleAndAddress()
        => Assert.True(TextMatchRanking.Rank("Project planning", "https://github.com/team/repo", "planning github") >= 0);

    [Fact]
    public void SuggestionsDeduplicateNormalizedAddressesAndKeepPathCase()
    {
        var tab = Guid.NewGuid();
        var result = LocalSuggestionPolicy.Build(new[]
        {
            new LocalSuggestion("Example", "https://EXAMPLE.test/Docs", LocalSuggestionKind.History),
            new LocalSuggestion("Example", "https://example.test/Docs", LocalSuggestionKind.OpenTab, tab),
            new LocalSuggestion("Example", "https://example.test/docs", LocalSuggestionKind.Bookmark),
            new LocalSuggestion("Example", "javascript:alert(1)", LocalSuggestionKind.Bookmark),
            new LocalSuggestion("Example", "https://user:secret@example.test/", LocalSuggestionKind.History)
        }, "example", false);
        Assert.Equal(2, result.Count);
        Assert.Equal(tab, result[0].TabId);
        Assert.Contains(result, item => item.Url.EndsWith("/docs", StringComparison.Ordinal));
    }

    [Fact]
    public void PrivateSuggestionsNeverIncludeHistoryAndResultsAreBounded()
    {
        var result = LocalSuggestionPolicy.Build(Enumerable.Range(0, 100).Select(index => new LocalSuggestion("Test", $"https://example.test/{index}", index % 2 == 0 ? LocalSuggestionKind.History : LocalSuggestionKind.Bookmark)), "test", true);
        Assert.Equal(10, result.Count);
        Assert.All(result, item => Assert.Equal(LocalSuggestionKind.Bookmark, item.Kind));
    }

    [Fact]
    public void DashboardDoesNotExposePrivateSessionOrLibraryRecords()
    {
        var items = new[] { new DashboardLink("Saved page", "https://example.test/", Guid.NewGuid()) };
        Assert.Empty(NewTabDashboardPolicy.Select(items, true, false));
        Assert.Empty(NewTabDashboardPolicy.Select(items, true, true));
    }

    [Fact]
    public void DashboardRejectsNonWebAndCredentialUrlsAndBoundsTitles()
    {
        var items = new[]
        {
            new DashboardLink("Unsafe", "javascript:alert(1)"),
            new DashboardLink("Private credentials", "https://user:secret@example.test/"),
            new DashboardLink(new string('x', 500), "https://example.test/"),
            new DashboardLink("Duplicate", "https://EXAMPLE.test/")
        };
        var result = NewTabDashboardPolicy.Select(items, false, false);
        Assert.Single(result);
        Assert.Equal(160, result[0].Title.Length);
        Assert.Empty(NewTabDashboardPolicy.Select(items, false, true));
    }

    [Fact]
    public void DashboardKeepsDistinctTabsButBoundsBookmarksAndTabs()
    {
        var items = Enumerable.Range(0, 50).Select(index => new DashboardLink($"Page {index}", $"https://example.test/{index}", Guid.NewGuid()));
        Assert.Equal(8, NewTabDashboardPolicy.Select(items, false, false).Count);
        Assert.Equal(6, NewTabDashboardPolicy.Select(items, false, true).Count);
    }
}
