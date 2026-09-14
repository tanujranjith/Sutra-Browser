using System.Text.Json;
using Browser.Core.Tabs;

namespace Browser.Core.Sessions;

public sealed record BrowserSession(
    IReadOnlyList<BrowserTabSnapshot> Tabs,
    Guid? ActiveTabId,
    DateTimeOffset SavedAt,
    IReadOnlyList<Guid>? SplitTabIds = null,
    IReadOnlyList<TabGroupSnapshot>? Groups = null,
    SplitLayoutPreset SplitLayout = SplitLayoutPreset.Automatic,
    IReadOnlyList<double>? SplitColumnFractions = null,
    IReadOnlyList<double>? SplitRowFractions = null);

public static class SessionSerializer
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public const int MaximumJsonCharacters = 2_000_000;
    public static string Serialize(BrowserSession session) => JsonSerializer.Serialize(Normalize(session), Options);

    public static BrowserSession Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumJsonCharacters) return Empty();
        try
        {
            var session = JsonSerializer.Deserialize<BrowserSession>(json, Options);
            return Normalize(session);
        }
        catch (Exception) { return Empty(); }
    }

    private static BrowserSession Normalize(BrowserSession? session)
    {
            // Persisted session data is untrusted: a crash mid-write, manual edit,
            // or crafted import can produce null collections or null entries.
            // Never let that escape as an exception; fall back to an empty session.
            if (session is null) return Empty();
            var tabs = (session.Tabs ?? []).Where(IsValid).DistinctBy(x => x.Id).Take(1000).ToList();
            tabs = TreeTabPolicy.NormalizeParents(tabs).ToList();
            // A collapsed marker without children is stale UI state; clear it so restored lists never hide roots.
            var parents = tabs.Where(x => x.ParentId is not null).Select(x => x.ParentId!.Value).ToHashSet();
            tabs = tabs.Select(x => x.IsTreeCollapsed && !parents.Contains(x.Id) ? x with { IsTreeCollapsed = false } : x).ToList();
            var active = tabs.Any(x => x.Id == session.ActiveTabId) ? session.ActiveTabId : tabs.FirstOrDefault()?.Id;
            var liveIds = tabs.Select(x => x.Id).ToHashSet();
            var split = (session.SplitTabIds ?? [])
                .Where(liveIds.Contains)
                .Distinct()
                .Take(8)
                .ToList();
            if (split.Count < 2) split.Clear();
            IReadOnlyList<double>? columns = null;
            IReadOnlyList<double>? rows = null;
            if (split.Count >= 2)
            {
                columns = session.SplitColumnFractions is { Count: >= 2 and <= 8 }
                    ? SplitRatioPolicy.Normalize(session.SplitColumnFractions, session.SplitColumnFractions.Count) : null;
                rows = session.SplitRowFractions is { Count: >= 2 and <= 8 }
                    ? SplitRatioPolicy.Normalize(session.SplitRowFractions, session.SplitRowFractions.Count) : null;
            }
            var groups = (session.Groups ?? [])
                .Where(x => x is not null && x.Id != Guid.Empty)
                .GroupBy(x => x.Id).Select(x => x.First())
                .Select(TabGroup.FromSnapshot)
                .OrderBy(x => x.SortOrder).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                .Select(x => x.ToSnapshot()).ToList();
            var groupIds = groups.Select(x => x.Id).ToHashSet();
            tabs = tabs.Select(x => x.GroupId is { } groupId && !groupIds.Contains(groupId) ? x with { GroupId = null } : x).ToList();
            // Drop groups that ended up with no tabs so the restored sidebar never shows empty sections.
            var referenced = tabs.Select(x => x.GroupId).OfType<Guid>().ToHashSet();
            groups = groups.Where(x => referenced.Contains(x.Id)).ToList();
            return new(tabs, active, session.SavedAt, split, groups, Enum.IsDefined(session.SplitLayout) ? session.SplitLayout : SplitLayoutPreset.Automatic, columns, rows);
    }

    private static bool IsValid(BrowserTabSnapshot? tab) => tab is not null && tab.Id != Guid.Empty && !string.IsNullOrWhiteSpace(tab.Url) &&
        IsRestorableUrl(tab.Url);
    public static bool IsRestorableUrl(string? url) => url is "browser://newtab" or "about:blank" ||
        url is { Length: <= 8192 } && Uri.TryCreate(url, UriKind.Absolute, out var uri) && string.IsNullOrEmpty(uri.UserInfo) &&
        (uri.Scheme is "http" or "https" || uri.IsFile && (string.IsNullOrEmpty(uri.Host) || uri.IsLoopback));
    private static BrowserSession Empty() => new([], null, DateTimeOffset.UtcNow, [], [], SplitLayoutPreset.Automatic, null, null);
}
