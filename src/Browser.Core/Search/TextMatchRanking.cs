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
        var secondaryRank = RankText(secondary ?? string.Empty, query, exact: 1500, prefix: 1200, wordStart: 1000, substring: 800);
        if (secondaryRank >= 0) return secondaryRank;
        if (query.Length > 160) return NoMatch;
        var terms = query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(12).ToArray();
        var combined = (primary ?? string.Empty) + " " + (secondary ?? string.Empty);
        if (terms.Length > 1 && terms.All(term => combined.Contains(term, StringComparison.OrdinalIgnoreCase))) return 600;
        if (terms.Length != 1 || query.Length is < 4 or > 40) return NoMatch;
        var words = combined[..Math.Min(combined.Length, 1024)].Split(
            [' ', '\t', '\n', '/', '-', '_', '.', ':', '?', '&', '=', '(', ')'], StringSplitOptions.RemoveEmptyEntries).Take(64);
        return words.Any(word => OneEditApart(word, query)) ? 200 : NoMatch;
    }

    private static bool OneEditApart(string left, string right)
    {
        if (Math.Abs(left.Length - right.Length) > 1) return false;
        left = left.ToUpperInvariant(); right = right.ToUpperInvariant();
        var a = 0; var b = 0; var edits = 0;
        while (a < left.Length && b < right.Length)
        {
            if (left[a] == right[b]) { a++; b++; continue; }
            if (++edits > 1) return false;
            if (left.Length == right.Length && a + 1 < left.Length && b + 1 < right.Length && left[a] == right[b + 1] && left[a + 1] == right[b]) { a += 2; b += 2; }
            else if (left.Length > right.Length) a++;
            else if (right.Length > left.Length) b++;
            else { a++; b++; }
        }
        return edits + (a < left.Length || b < right.Length ? 1 : 0) <= 1;
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
