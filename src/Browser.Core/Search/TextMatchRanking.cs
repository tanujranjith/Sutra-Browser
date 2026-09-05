namespace Browser.Core.Search;

/// <summary>
/// Deterministic ranking for native search surfaces such as the command palette.
/// Exact and prefix matches rank above arbitrary substring matches so the first
/// result stays predictable while the user types. Purely functional and unit
/// tested; UI layers only apply ordering and a bounded result count.
/// </summary>
public static class TextMatchRanking
{
    /// <summary>Rank returned when the candidate does not match the query at all.</summary>
    public const int NoMatch = -1;

    public static int Rank(string? primary, string? secondary, string? query)
    {
        if (string.IsNullOrWhiteSpace(query)) return 0;
        query = query.Trim();

        // One absolute scale so a weak primary match still outranks a strong
        // secondary match: exact/prefix/word/substring on the primary always beat
        // every kind of secondary match.
        var primaryRank = RankText(primary ?? string.Empty, query, exact: 5000, prefix: 4000, wordStart: 3000, substring: 2000);
        if (primaryRank >= 0) return primaryRank;
        return RankText(secondary ?? string.Empty, query, exact: 1500, prefix: 1200, wordStart: 1000, substring: 800);
    }

    private static int RankText(string text, string query, int exact, int prefix, int wordStart, int substring)
    {
        if (text.Length == 0) return NoMatch;
        if (string.Equals(text, query, StringComparison.OrdinalIgnoreCase)) return exact;
        if (text.StartsWith(query, StringComparison.OrdinalIgnoreCase)) return prefix;

        // Word-boundary match: "page notes" should outrank "apage" for "page".
        var searchFrom = 1;
        while (text.IndexOf(query, searchFrom, StringComparison.OrdinalIgnoreCase) is { } index && index > 0)
        {
            var previous = text[index - 1];
            if (char.IsWhiteSpace(previous) || previous is '/' or '-' or '_' or '.' or ':') return wordStart;
            searchFrom = index + 1;
        }
        return text.Contains(query, StringComparison.OrdinalIgnoreCase) ? substring : NoMatch;
    }
}
