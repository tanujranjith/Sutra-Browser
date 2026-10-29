namespace Browser.Core.Navigation;

public sealed record DashboardLink(string Title, string Url, Guid? TabId = null, bool Sleeping = false);

public static class NewTabDashboardPolicy
{
    public static IReadOnlyList<DashboardLink> Select(IEnumerable<DashboardLink> candidates, bool isPrivate, bool tabs)
    {
        if (isPrivate) return [];
        return candidates.Take(4096)
            .Where(item => item.Url.Length <= 2048 && Uri.TryCreate(item.Url, UriKind.Absolute, out var uri) &&
                uri.Scheme is "https" or "http" && string.IsNullOrEmpty(uri.UserInfo) && (!tabs || item.TabId is not null))
            .DistinctBy(item => tabs ? item.TabId.ToString()! : new Uri(item.Url).AbsoluteUri, StringComparer.Ordinal)
            .Take(tabs ? 6 : 8)
            .Select(item => item with { Title = string.IsNullOrWhiteSpace(item.Title) ? new Uri(item.Url).Host : item.Title[..Math.Min(item.Title.Length, 160)] })
            .ToArray();
    }
}
