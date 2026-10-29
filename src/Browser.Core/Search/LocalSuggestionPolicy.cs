namespace Browser.Core.Search;

public enum LocalSuggestionKind { OpenTab, Bookmark, History }

public sealed record LocalSuggestion(string Title, string Url, LocalSuggestionKind Kind, Guid? TabId = null)
{
    public string Detail => $"{(Kind == LocalSuggestionKind.OpenTab ? "Switch to tab" : Kind == LocalSuggestionKind.Bookmark ? "Bookmark" : "History")} · {Url}";
    public override string ToString() => Url;
}

public static class LocalSuggestionPolicy
{
    public static IReadOnlyList<LocalSuggestion> Build(IEnumerable<LocalSuggestion> candidates, string query, bool isPrivate)
        => candidates.Take(4096)
            .Where(candidate => !(isPrivate && candidate.Kind == LocalSuggestionKind.History))
            .Where(candidate => Uri.TryCreate(candidate.Url, UriKind.Absolute, out var uri) && string.IsNullOrEmpty(uri.UserInfo) &&
                (uri.Scheme is "https" or "http" || candidate.Kind == LocalSuggestionKind.OpenTab && candidate.TabId is not null && uri.Scheme is "browser" or "sutra"))
            .Select(candidate => (Candidate: candidate, Rank: TextMatchRanking.Rank(candidate.Title, candidate.Url, query)))
            .Where(item => item.Rank != TextMatchRanking.NoMatch)
            .OrderByDescending(item => item.Rank)
            .ThenBy(item => item.Candidate.Kind)
            .DistinctBy(item => new Uri(item.Candidate.Url).AbsoluteUri, StringComparer.Ordinal)
            .Take(10).Select(item => item.Candidate).ToArray();
}
