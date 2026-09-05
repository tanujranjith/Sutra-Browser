using System.Text.Json;
using System.Text.Json.Serialization;

namespace Browser.AI.Tools;

public enum BrowserActionType
{
    Navigate, Search, Back, Forward, Reload, NewTab, SwitchTab, CloseTab, HibernateTab,
    SetPinned, Bookmark, ReadVisibleText, ReadOutline, FindElements, Click, Type, Select,
    Scroll, ReadSelectedText, RequestCredentialAutofill, Wait, Complete, Fail
}

public sealed record BrowserAction(
    BrowserActionType Type,
    string? Url = null,
    string? Query = null,
    string? ElementId = null,
    string? Text = null,
    string? Value = null,
    Guid? TabId = null,
    bool? Flag = null,
    int? Milliseconds = null,
    bool SubmitsData = false,
    string? Description = null);

public static class BrowserActionParser
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static bool TryParse(string response, out BrowserAction? action, out string? error)
    {
        action = null; error = null;
        try
        {
            var trimmed = response.Trim();
            if (trimmed.StartsWith("```"))
            {
                var firstNewline = trimmed.IndexOf('\n'); var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
                if (firstNewline >= 0 && lastFence > firstNewline) trimmed = trimmed[(firstNewline + 1)..lastFence].Trim();
            }
            action = JsonSerializer.Deserialize<BrowserAction>(trimmed, Options);
            if (action is null) { error = "The model returned an empty action."; return false; }
            if (!Validate(action, out error)) { action = null; return false; }
            return true;
        }
        catch (JsonException) { error = "The model response was not a valid browser action."; return false; }
    }

    private static bool Validate(BrowserAction action, out string? error)
    {
        error = action.Type switch
        {
            BrowserActionType.Navigate when !IsSafeNavigationUrl(action.Url) => "Navigate requires an HTTP(S) URL or browser://newtab without credentials.",
            BrowserActionType.NewTab when action.Url is not null && !IsSafeNavigationUrl(action.Url) => "New tab URLs must be HTTP(S) or browser://newtab without credentials.",
            BrowserActionType.Search when string.IsNullOrWhiteSpace(action.Query) => "Search requires a query.",
            BrowserActionType.Click or BrowserActionType.Type or BrowserActionType.Select when string.IsNullOrWhiteSpace(action.ElementId) => "Element action requires an element ID.",
            BrowserActionType.Type when action.Text is null => "Type requires text.",
            BrowserActionType.Select when action.Value is null && action.Text is null => "Select requires a value.",
            BrowserActionType.SwitchTab or BrowserActionType.CloseTab or BrowserActionType.HibernateTab when action.TabId is null => "Tab action requires a tab ID.",
            BrowserActionType.Wait when action.Milliseconds is not null && action.Milliseconds is < 100 or > 10000 => "Wait must be between 100 and 10000 milliseconds.",
            _ => null
        };
        return error is null;
    }

    private static bool IsSafeNavigationUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        ((uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo)) ||
         (uri.Scheme == "browser" && uri.Host.Equals("newtab", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(uri.UserInfo)));
}
