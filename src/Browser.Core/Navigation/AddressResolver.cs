using System.Net;

namespace Browser.Core.Navigation;

public enum SearchEngine { Google, Bing, DuckDuckGo }

public sealed record NavigationTarget(Uri Uri, bool IsSearch, string? SearchQuery = null);

public static class AddressResolver
{
    public static NavigationTarget Resolve(string input, SearchEngine engine = SearchEngine.DuckDuckGo, IReadOnlyDictionary<string, string>? customAliases = null)
    {
        var value = input.Trim();
        if (string.IsNullOrWhiteSpace(value)) return new(new Uri("browser://newtab"), false);

        var customAlias = ParseCustomAlias(value, customAliases);
        if (customAlias is not null) return customAlias;

        var shortcut = ParseSearchShortcut(value);
        if (shortcut is not null)
            return new(BuildSearchUri(shortcut.Value.Query, shortcut.Value.Engine), true, shortcut.Value.Query);

        if (Uri.TryCreate(value, UriKind.Absolute, out var absolute) &&
            absolute.Scheme is "http" or "https" or "file" or "about" or "browser")
            return new(absolute, false);

        var candidate = value.Split('/', 2)[0].Split(':', 2)[0];
        var isLocalhost = candidate.Equals("localhost", StringComparison.OrdinalIgnoreCase);
        var isIp = IPAddress.TryParse(candidate.Trim('[', ']'), out _);
        var isDomain = candidate.Contains('.') && !candidate.Contains(' ') &&
                       candidate.Split('.').All(p => p.Length > 0);

        if ((isLocalhost || isIp || isDomain) && !value.Contains(' '))
        {
            var scheme = isLocalhost || isIp ? "http" : "https";
            if (Uri.TryCreate($"{scheme}://{value}", UriKind.Absolute, out var uri)) return new(uri, false);
        }

        return new(BuildSearchUri(value, engine), true, value);
    }

    public static Uri BuildSearchUri(string query, SearchEngine engine) => engine switch
    {
        SearchEngine.Google => new($"https://www.google.com/search?q={Uri.EscapeDataString(query)}"),
        SearchEngine.Bing => new($"https://www.bing.com/search?q={Uri.EscapeDataString(query)}"),
        _ => new($"https://duckduckgo.com/?q={Uri.EscapeDataString(query)}")
    };

    private static NavigationTarget? ParseCustomAlias(string value, IReadOnlyDictionary<string, string>? aliases)
    {
        if (aliases is null || aliases.Count == 0) return null;
        var separator = value.IndexOf(' ');
        if (separator <= 0 || separator == value.Length - 1) return null;
        var alias = value[..separator].TrimStart('@', '!');
        var query = value[(separator + 1)..].Trim();
        if (!aliases.TryGetValue(alias, out var template) || string.IsNullOrWhiteSpace(query)) return null;
        if (!SearchAliasPolicy.TryValidate(alias, template, out _, out template, out _)) return null;
        var target = template.Replace("{query}", Uri.EscapeDataString(query), StringComparison.OrdinalIgnoreCase);
        return Uri.TryCreate(target, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https"
            ? new NavigationTarget(uri, true, query)
            : null;
    }

    private static (SearchEngine Engine, string Query)? ParseSearchShortcut(string value)
    {
        var separator = value.IndexOf(' ');
        if (separator <= 0 || separator == value.Length - 1) return null;
        var engine = value[..separator].ToLowerInvariant() switch
        {
            "@g" or "!g" => SearchEngine.Google,
            "@b" or "!b" => SearchEngine.Bing,
            "@d" or "!d" or "!ddg" => SearchEngine.DuckDuckGo,
            _ => (SearchEngine?)null
        };
        return engine is null ? null : (engine.Value, value[(separator + 1)..].Trim());
    }
}
