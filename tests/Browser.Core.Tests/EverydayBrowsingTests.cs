using Browser.Core.Bookmarks;
using Browser.Core.Navigation;
using Browser.Core.Privacy;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class EverydayBrowsingTests
{
    [Theory]
    [InlineData(false, true, false, PermissionChoice.Allow, true, null)]
    [InlineData(false, true, true, PermissionChoice.Allow, true, "Allow")]
    [InlineData(false, true, true, PermissionChoice.Block, false, "Deny")]
    [InlineData(false, true, true, PermissionChoice.Dismissed, false, null)]
    [InlineData(true, true, true, PermissionChoice.Allow, true, null)]
    [InlineData(true, true, true, PermissionChoice.Block, false, null)]
    [InlineData(false, false, true, PermissionChoice.Allow, false, null)]
    public void PermissionsRememberOnlyExplicitCurrentNormalDocumentChoices(bool isPrivate, bool current, bool remember, PermissionChoice choice, bool allowed, string? saved)
    {
        var decision = PermissionDecisionPolicy.Resolve(isPrivate, current, remember, choice);
        Assert.Equal(allowed, decision.Allowed); Assert.Equal(saved, decision.RememberedDecision);
    }
    [Theory]
    [InlineData(0, 0)] [InlineData(1, 0)] [InlineData(50, 0)] [InlineData(50, 25)] [InlineData(50, 49)]
    public void PreviewIncludesSelectedTabWithoutExceedingTheList(int total, int selected)
    {
        var (start, count) = TabPreviewPolicy.Window(total, selected);
        Assert.InRange(start, 0, total); Assert.InRange(count, 0, 7); Assert.True(start + count <= total);
        if (total > 0) Assert.InRange(selected, start, start + count - 1);
    }

    [Theory]
    [InlineData("Ctrl++M")] [InlineData("Ctrl+Ctrl+M")] [InlineData("Ctrl+é")] [InlineData("Ctrl+Shift+")] [InlineData("Alt+F13")]
    public void RejectsMalformedOrUnsupportedKeys(string value) => Assert.False(ShortcutDefinition.TryParse(value, out _));

    [Fact]
    public void ConflictsNormalizeModifierOrderAndAliases()
    {
        Assert.Contains(ShortcutConflictPolicy.Validate(new Dictionary<string, string> { ["Media"] = "shift+control+p" }), error => error.Contains("reserved"));
        Assert.Contains(ShortcutConflictPolicy.Validate(new Dictionary<string, string> { ["Media"] = "Ctrl+Alt+M", ["Sidebar"] = "alt+control+m" }), error => error.Contains("also assigned"));
        Assert.Empty(ShortcutConflictPolicy.Validate(new Dictionary<string, string> { ["Media"] = "Ctrl+Alt+M", ["Sidebar"] = "Ctrl+Alt+B" }));
    }

    [Theory]
    [InlineData("javascript:alert('{query}')")]
    [InlineData("https://user:pass@example.com/?q={query}")]
    [InlineData("https://{query}.example.com/")]
    [InlineData("https://example.com")]
    [InlineData("file:///C:/{query}")]
    public void SearchTemplatesRejectUnsafeOrMissingQueryTargets(string template) =>
        Assert.False(SearchAliasPolicy.TryValidate("test", template, out _, out _, out _));

    [Fact]
    public void SearchPreviewEncodesTheQueryAndNormalizesAlias()
    {
        Assert.True(SearchAliasPolicy.TryValidate(" @Wiki ", " https://example.com/search?q={QUERY} ", out var alias, out var template, out _));
        Assert.Equal("wiki", alias);
        Assert.True(SearchAliasPolicy.TryPreview(alias, template, "a & #b", out var preview));
        Assert.Equal("https://example.com/search?q=a%20%26%20%23b", preview);
        var target = AddressResolver.Resolve("wiki a & #b", customAliases: new Dictionary<string, string> { [alias] = template });
        Assert.Equal(preview, target.Uri.AbsoluteUri);
    }

    [Fact]
    public void SettingsBoundReaderPreferencesAndExcludeUnsafeAliases()
    {
        var settings = SettingsValidator.Validate(new BrowserSettings { ReaderFontSize = 100, ReaderWidth = -1, ReaderAppearance = "bad", SearchAliases = new() { ["unsafe"] = "https://user:secret@example.com/{query}", ["ok"] = "https://example.com/{query}" } });
        Assert.Equal(28, settings.ReaderFontSize); Assert.Equal(560, settings.ReaderWidth); Assert.Equal("system", settings.ReaderAppearance);
        Assert.Single(settings.SearchAliases); Assert.True(settings.SearchAliases.ContainsKey("ok"));
    }

    [Fact]
    public void DuplicateBookmarksKeepFolderPathCaseQueryAndFragmentMeaning()
    {
        BookmarkIdentity[] items = [new(1, null, "https://example.com/Path?q=1#one"), new(2, null, "https://example.com/Path?q=1#one"),
            new(3, 7, "https://example.com/Path?q=1#one"), new(4, null, "https://example.com/path?q=1#one"),
            new(5, null, "https://example.com/Path?q=2#one"), new(6, null, "https://example.com/Path?q=1#two")];
        Assert.Equal(new long[] { 2 }, BookmarkMaintenancePolicy.DuplicateIds(items));
        Assert.Equal(200, BookmarkMaintenancePolicy.DuplicateIds(Enumerable.Range(1, 1000).Select(id => new BookmarkIdentity(id, null, "https://example.com/"))).Count);
    }
}
