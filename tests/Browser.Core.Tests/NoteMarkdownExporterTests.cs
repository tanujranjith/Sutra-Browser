using Browser.Core.Notes;
using Xunit;

namespace Browser.Core.Tests;

public sealed class NoteMarkdownExporterTests
{
    [Fact]
    public void ExportKeepsUntrustedQuotesAndNotesInert()
    {
        var markdown = NoteMarkdownExporter.Export([new("https://example.com/article#quote", "<script>alert(1)</script>", "![tracking](https://example.net/pixel)\nsecond line", DateTimeOffset.UnixEpoch)]);
        Assert.DoesNotContain("<script>", markdown);
        Assert.DoesNotContain("![tracking]", markdown);
        Assert.Contains("&lt;script&gt;", markdown);
        Assert.Contains("second line", markdown);
        Assert.DoesNotContain("#quote", markdown);
    }
}
