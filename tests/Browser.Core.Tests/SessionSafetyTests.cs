using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class SessionSafetyTests
{
    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("https://user:secret@example.com")]
    [InlineData("file://remote-server/share/document.html")]
    [InlineData("ms-settings:privacy")]
    public void UnsafeTargetsAreNeitherPersistedNorRestored(string url)
    {
        var snapshot = new BrowserTab { Url = url }.ToSnapshot();
        var json = SessionSerializer.Serialize(new([snapshot], snapshot.Id, DateTimeOffset.UtcNow));
        Assert.DoesNotContain(url, json);
        Assert.Empty(SessionSerializer.Deserialize(json).Tabs);
        var imported = System.Text.Json.JsonSerializer.Serialize(new BrowserSession([snapshot], snapshot.Id, DateTimeOffset.UtcNow));
        Assert.Empty(SessionSerializer.Deserialize(imported).Tabs);
        Assert.Equal("browser://newtab", BrowserTab.FromSnapshot(snapshot).Url);
    }

    [Fact]
    public void OversizedImportedSessionIsRejected()
    {
        Assert.Empty(SessionSerializer.Deserialize(new string(' ', SessionSerializer.MaximumJsonCharacters) + "{}").Tabs);
    }
}
