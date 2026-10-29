namespace Browser.Core.Navigation;

public static class SearchAliasPolicy
{
    public static bool TryValidate(string? rawAlias, string? rawTemplate, out string alias, out string template, out string error)
    {
        alias = (rawAlias ?? "").Trim().TrimStart('@', '!').ToLowerInvariant();
        template = (rawTemplate ?? "").Trim();
        error = "";
        if (alias.Length is < 1 or > 24 || !alias.All(c => char.IsAsciiLetterOrDigit(c)))
            error = "Use 1–24 letters or numbers for the shortcut.";
        else if (template.Length > 2048 || !template.Contains("{query}", StringComparison.OrdinalIgnoreCase))
            error = "Use an address of at most 2,048 characters containing {query}.";
        else if (!Uri.TryCreate(template.Replace("{query}", "sample", StringComparison.OrdinalIgnoreCase), UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0 || PlaceholderInAuthority(template))
            error = "Use an HTTP or HTTPS address without credentials; put {query} in the path or query string.";
        return error.Length == 0;
    }

    private static bool PlaceholderInAuthority(string template)
    {
        var start = template.IndexOf("://", StringComparison.Ordinal);
        if (start < 0) return true;
        var end = template.IndexOfAny(['/', '?', '#'], start + 3);
        return template[..(end < 0 ? template.Length : end)].Contains("{query}", StringComparison.OrdinalIgnoreCase);
    }

    public static bool TryPreview(string alias, string template, string query, out string url)
    {
        url = "";
        if (!TryValidate(alias, template, out _, out var normalized, out _) || query.Length > 500) return false;
        url = normalized.Replace("{query}", Uri.EscapeDataString(query), StringComparison.OrdinalIgnoreCase);
        return true;
    }
}
