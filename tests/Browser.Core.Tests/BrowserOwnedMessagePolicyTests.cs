using Browser.Core.Navigation;
using Browser.Core.Reading;
using Xunit;

namespace Browser.Core.Tests;

public sealed class BrowserOwnedMessagePolicyTests
{
    private const string Page = "file:///C:/Sutra/SutraUltra/index.html";

    [Theory]
    [InlineData("browser://newtab", Page, Page, true, true)]
    [InlineData("browser://newtab", "about:blank", "about:blank", true, true)]
    [InlineData("https://evil.example", Page, Page, true, false)]
    [InlineData("browser://newtab", "https://evil.example", "https://evil.example", true, false)]
    [InlineData("browser://newtab", "file:///C:/other/index.html", "file:///C:/other/index.html", true, false)]
    [InlineData("browser://newtab", Page, "https://example.com", true, false)]
    [InlineData("browser://newtab", Page, Page, false, false)]
    [InlineData("browser://newtab", "data:text/html,forged", "data:text/html,forged", true, false)]
    public void OnlySelectedBrowserOwnedDocumentCanOpenManagers(string logical, string source, string current, bool selected, bool expected) =>
        Assert.Equal(expected, BrowserOwnedMessagePolicy.IsTrustedNewTab(logical, source, current, Page, selected));

    [Fact]
    public void OfflineTextIsBoundedAndRequiresContent()
    {
        Assert.Throws<ArgumentException>(() => OfflineArticlePolicy.ValidateText("  "));
        Assert.Throws<ArgumentException>(() => OfflineArticlePolicy.ValidateText(new string('x', OfflineArticlePolicy.MaximumTextLength + 1)));
        Assert.Equal("article", OfflineArticlePolicy.ValidateText(" article "));
        Assert.Throws<ArgumentException>(() => OfflineArticlePolicy.NormalizeUrl("javascript:alert(1)"));
    }
}
