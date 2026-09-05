using System.Text.Json;
using Browser.Core.Tabs;

namespace Browser.Core.Sessions;

public sealed record BrowserSession(
    IReadOnlyList<BrowserTabSnapshot> Tabs,
    Guid? ActiveTabId,
    DateTimeOffset SavedAt,
    IReadOnlyList<Guid>? SplitTabIds = null,
    IReadOnlyList<TabGroupSnapshot>? Groups = null);

public static class SessionSerializer
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static string Serialize(BrowserSession session) => JsonSerializer.Serialize(session, Options);

    public static BrowserSession Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Empty();
        try
        {
            var session = JsonSerializer.Deserialize<BrowserSession>(json, Options);
            if (session is null) return Empty();
            var tabs = session.Tabs.Where(IsValid).DistinctBy(x => x.Id).ToList();
            var active = tabs.Any(x => x.Id == session.ActiveTabId) ? session.ActiveTabId : tabs.FirstOrDefault()?.Id;
            var liveIds = tabs.Select(x => x.Id).ToHashSet();
            var split = (session.SplitTabIds ?? [])
                .Where(liveIds.Contains)
                .Distinct()
                .Take(8)
                .ToList();
            if (split.Count < 2) split.Clear();
            var groups = (session.Groups ?? [])
                .Where(x => x.Id != Guid.Empty)
                .GroupBy(x => x.Id).Select(x => x.First())
                .Select(TabGroup.FromSnapshot)
                .OrderBy(x => x.SortOrder).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                .Select(x => x.ToSnapshot()).ToList();
            var groupIds = groups.Select(x => x.Id).ToHashSet();
            tabs = tabs.Select(x => x.GroupId is { } groupId && !groupIds.Contains(groupId) ? x with { GroupId = null } : x).ToList();
            // Drop groups that ended up with no tabs so the restored sidebar never shows empty sections.
            var referenced = tabs.Select(x => x.GroupId).OfType<Guid>().ToHashSet();
            groups = groups.Where(x => referenced.Contains(x.Id)).ToList();
            return new(tabs, active, session.SavedAt, split, groups);
        }
        catch (JsonException) { return Empty(); }
    }

    private static bool IsValid(BrowserTabSnapshot tab) => tab.Id != Guid.Empty && !string.IsNullOrWhiteSpace(tab.Url) &&
        (tab.Url == "browser://newtab" || Uri.TryCreate(tab.Url, UriKind.Absolute, out _));
    private static BrowserSession Empty() => new([], null, DateTimeOffset.UtcNow, [], []);
}
