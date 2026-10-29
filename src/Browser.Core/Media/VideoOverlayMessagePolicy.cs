using System.Text.Json;

namespace Browser.Core.Media;

public sealed record VideoOverlayRequest(string Kind, string Action, string? MediaId);

public static class VideoOverlayMessagePolicy
{
    public static bool TryRead(JsonElement message, string source, string currentSource, string expectedToken, out VideoOverlayRequest? request)
    {
        request = null;
        if (message.ValueKind != JsonValueKind.Object || string.IsNullOrEmpty(expectedToken) ||
            !Uri.TryCreate(source, UriKind.Absolute, out var origin) || origin.Scheme is not ("https" or "http" or "file") ||
            !string.Equals(source, currentSource, StringComparison.Ordinal)) return false;
        string? Read(string name) => message.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        if (!string.Equals(Read("token"), expectedToken, StringComparison.Ordinal)) return false;
        var kind = Read("kind");
        if (kind == "video-mini-player")
        {
            var id = Read("mediaId");
            if (id is not { Length: > 0 and <= 64 } || !id.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')) return false;
            request = new(kind, "open", id);
            return true;
        }
        var action = Read("action");
        if (kind != "mini-player-window" || action is not ("drag" or "return" or "close")) return false;
        request = new(kind, action, null);
        return true;
    }
}
