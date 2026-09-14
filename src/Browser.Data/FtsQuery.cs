namespace Browser.Data;

/// <summary>Builds safe FTS5 MATCH queries from untrusted user input (#9).</summary>
public static class FtsQuery
{
    /// <summary>Converts free text to a bounded prefix query like "exam"* AND "ple"*. Returns null when nothing searchable.</summary>
    public static string? Build(string? query, int maxTokens = 5)
    {
        if (string.IsNullOrWhiteSpace(query)) return null;
        var tokens = query
            .ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : ' ')
            .Aggregate(new System.Text.StringBuilder(), (sb, c) => sb.Append(c)).ToString()
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length is >= 2 and <= 40)
            .Distinct()
            .Take(Math.Clamp(maxTokens, 1, 8))
            .Select(t => $"\"{t}\"*")
            .ToList();
        return tokens.Count == 0 ? null : string.Join(" AND ", tokens);
    }
}
