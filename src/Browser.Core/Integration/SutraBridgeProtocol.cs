using System.Text.Json;

namespace Browser.Core.Integration;

public sealed record SutraBridgeRequest(int Version, string RequestId, string Action, JsonElement Payload)
{
    public string GetString(string name) => Payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : string.Empty;
}

/// <summary>Versioned, bounded message validation for the trusted embedded Sutra workspace.</summary>
public static class SutraBridgeProtocol
{
    public const int CurrentVersion = 1;
    public const string TrustedOrigin = "https://sutra.local";
    public const string WorkspaceProfileName = "SutraWorkspace";
    private const int MaximumMessageLength = 32_768;
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal)
    { "capture.source", "capture.homework", "capture.deadline", "capture.pdf", "assistant.context", "open.external", "open.beside-note", "workspace.navigate", "workspace.layout", "settings.open" };

    public static bool IsWorkspaceView(string? view) => view is "today" or "homework" or "notes" or "timeline" or "apstudy" or "collegeapp" or "life" or "assistantview" or "settings" or "business" or "courses" or "alldue";

    public static bool IsTrustedSource(string? source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps && uri.Host.Equals("sutra.local", StringComparison.OrdinalIgnoreCase) &&
            uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
    }

    public static bool TryParse(string? source, string? message, out SutraBridgeRequest? request)
    {
        request = null;
        if (!IsTrustedSource(source) || message is null || message.Length is 0 or > MaximumMessageLength) return false;
        try
        {
            using var document = JsonDocument.Parse(message, new JsonDocumentOptions { MaxDepth = 8, AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v) || v != CurrentVersion) return false;
            if (!root.TryGetProperty("requestId", out var idValue) || idValue.ValueKind != JsonValueKind.String || !Guid.TryParse(idValue.GetString(), out var requestId)) return false;
            if (!root.TryGetProperty("action", out var actionValue) || actionValue.ValueKind != JsonValueKind.String) return false;
            var action = actionValue.GetString() ?? string.Empty;
            if (!Actions.Contains(action) || !root.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object) return false;
            if (!ValidatePayload(action, payload)) return false;
            request = new(v, requestId.ToString("D"), action, payload.Clone());
            return true;
        }
        catch (JsonException) { return false; }
    }

    private static bool ValidatePayload(string action, JsonElement payload)
    {
        return action switch
        {
            "capture.source" => ValidTitle(payload) && ValidWebUrl(payload, "url") && Bounded(payload, "excerpt", 4000, optional: true) && Bounded(payload, "note", 2000, optional: true) && Bounded(payload, "collection", 80, optional: true),
            "capture.pdf" => ValidTitle(payload) && Bounded(payload, "fileName", 160, optional: false) && ValidPdfImportUrl(payload) &&
                (!payload.TryGetProperty("sourceUrl", out var sourceUrl) || sourceUrl.ValueKind == JsonValueKind.String && sourceUrl.GetString() == "" || ValidWebUrl(payload, "sourceUrl")),
            "capture.homework" or "capture.deadline" => ValidTitle(payload) && Bounded(payload, "courseName", 120, optional: true) &&
                Bounded(payload, "notes", 2000, optional: true) && ValidDate(payload, "dueDate", optional: true) && ValidTime(payload, "dueTime", optional: true) &&
                ValidWebUrl(payload, "url", optional: true) && Choice(payload, "difficulty", true, "easy", "medium", "hard"),
            "assistant.context" => Bounded(payload, "title", 300, optional: true) && ValidWebUrl(payload, "url", optional: true) && Bounded(payload, "text", 12000, optional: true) && Bounded(payload, "question", 2000, optional: true),
            "open.external" => ValidWebUrl(payload, "url"),
            "open.beside-note" => Bounded(payload, "title", 300, optional: true) && ValidWebUrl(payload, "url", optional: true),
            "workspace.navigate" => payload.TryGetProperty("view", out var view) && view.ValueKind == JsonValueKind.String && IsWorkspaceView(view.GetString()),
            "workspace.layout" => Choice(payload, "mode", false, "workspace", "note") && Choice(payload, "theme", true, "light", "dark"),
            "settings.open" => !payload.EnumerateObject().Any(),
            _ => false
        };
    }

    private static bool Choice(JsonElement payload, string name, bool optional, params string[] values) =>
        !payload.TryGetProperty(name, out var value) ? optional : value.ValueKind == JsonValueKind.String && values.Contains(value.GetString(), StringComparer.Ordinal);

    private static bool ValidTitle(JsonElement payload) => Bounded(payload, "title", 300, optional: false);

    private static bool ValidPdfImportUrl(JsonElement payload) => payload.TryGetProperty("importUrl", out var value) && value.ValueKind == JsonValueKind.String &&
        Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri) && IsTrustedSource(uri.AbsoluteUri) &&
        string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
        uri.AbsolutePath.StartsWith("/__desktop_import/", StringComparison.Ordinal) && uri.AbsolutePath.Length == 54 &&
        uri.AbsolutePath.EndsWith(".pdf", StringComparison.Ordinal) && Guid.TryParseExact(uri.AbsolutePath[18..^4], "N", out _);

    private static bool Bounded(JsonElement payload, string name, int maxLength, bool optional)
    {
        if (!payload.TryGetProperty(name, out var value)) return optional;
        return value.ValueKind == JsonValueKind.String && (optional || !string.IsNullOrWhiteSpace(value.GetString())) && value.GetString()!.Length <= maxLength;
    }

    private static bool ValidWebUrl(JsonElement payload, string name, bool optional = false)
    {
        if (!payload.TryGetProperty(name, out var value)) return optional;
        if (value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 2048) return false;
        return Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo);
    }

    private static bool ValidDate(JsonElement payload, string name, bool optional) =>
        !payload.TryGetProperty(name, out var value) ? optional : value.ValueKind == JsonValueKind.String &&
        (optional && string.IsNullOrEmpty(value.GetString()) || DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd", out _));

    private static bool ValidTime(JsonElement payload, string name, bool optional) =>
        !payload.TryGetProperty(name, out var value) ? optional : value.ValueKind == JsonValueKind.String &&
        (optional && string.IsNullOrEmpty(value.GetString()) || TimeOnly.TryParseExact(value.GetString(), "HH:mm", out _));
}
