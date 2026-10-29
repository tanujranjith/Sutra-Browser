using System.Text.Json;
using Browser.Core.Media;
using Xunit;

namespace Browser.Core.Tests;

public sealed class VideoOverlayMessagePolicyTests
{
    [Theory]
    [InlineData("drag")]
    [InlineData("return")]
    [InlineData("close")]
    public void OnlyKnownWindowActionsFromCurrentDocumentAndPlayerAreAccepted(string action)
    {
        using var message = JsonDocument.Parse(JsonSerializer.Serialize(new { kind = "mini-player-window", token = "player-token", action }));
        Assert.True(VideoOverlayMessagePolicy.TryRead(message.RootElement, "https://example.test/video", "https://example.test/video", "player-token", out var request));
        Assert.Equal(action, request!.Action);
        Assert.False(VideoOverlayMessagePolicy.TryRead(message.RootElement, "https://example.test/old", "https://example.test/video", "player-token", out _));
        Assert.False(VideoOverlayMessagePolicy.TryRead(message.RootElement, "https://example.test/video", "https://example.test/video", "different-token", out _));
    }

    [Theory]
    [InlineData("{\"kind\":\"mini-player-window\",\"token\":\"token\",\"action\":\"navigate\"}")]
    [InlineData("{\"kind\":\"video-mini-player\",\"token\":\"token\",\"mediaId\":{}}")]
    [InlineData("{\"kind\":\"video-mini-player\",\"token\":\"token\",\"mediaId\":\"';alert(1)\"}")]
    [InlineData("[]")]
    public void MalformedOrUnknownCommandsAreRejected(string json)
    {
        using var message = JsonDocument.Parse(json);
        Assert.False(VideoOverlayMessagePolicy.TryRead(message.RootElement, "https://example.test/video", "https://example.test/video", "token", out _));
    }

    [Fact]
    public void HoverCommandIsBoundedAndCannotUseAnInternalDocument()
    {
        using var message = JsonDocument.Parse("{\"kind\":\"video-mini-player\",\"token\":\"token\",\"mediaId\":\"sutra-3\"}");
        Assert.True(VideoOverlayMessagePolicy.TryRead(message.RootElement, "https://example.test/video", "https://example.test/video", "token", out var request));
        Assert.Equal("sutra-3", request!.MediaId);
        Assert.False(VideoOverlayMessagePolicy.TryRead(message.RootElement, "about:blank", "about:blank", "token", out _));
        using var oversized = JsonDocument.Parse(JsonSerializer.Serialize(new { kind = "video-mini-player", token = "token", mediaId = new string('a', 65) }));
        Assert.False(VideoOverlayMessagePolicy.TryRead(oversized.RootElement, "https://example.test/video", "https://example.test/video", "token", out _));
    }
}
