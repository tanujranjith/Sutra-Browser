using Browser.Core.Sessions;

namespace Browser.Core.Workspaces;

public static class WorkspacePolicy
{
    public static readonly IReadOnlyList<string> Icons = Array.AsReadOnly(new[] { "Folder", "Research", "Work", "Study", "Travel", "Code" });
    public static readonly IReadOnlyList<string> Colors = Array.AsReadOnly(new[] { "#F47A22", "#7373E8", "#228B75", "#3977CF", "#C05283", "#A17A26" });
    public static string Name(string value) => value?.Trim() is { Length: >= 1 and <= 80 } name && !name.Any(char.IsControl)
        ? name : throw new ArgumentException("Workspace names must contain 1–80 visible characters.", nameof(value));
    public static string Color(string value) => Colors.Contains(value) ? value : Colors[0];
    public static string Icon(string value) => Icons.Contains(value) ? value : Icons[0];
    public static string SessionJson(string value)
    {
        var session = SessionSerializer.Deserialize(value);
        session = MultiWindowSessionPolicy.WithoutTemporary(session);
        if (session.Tabs.Count == 0) throw new ArgumentException("The workspace has no valid tabs.", nameof(value));
        return SessionSerializer.Serialize(session);
    }

    public static BrowserSession Instantiate(BrowserSession source, string? workspaceName = null)
    {
        source = SessionSerializer.Deserialize(SessionSerializer.Serialize(MultiWindowSessionPolicy.WithoutTemporary(source)));
        var tabs = source.Tabs.ToDictionary(x => x.Id, _ => Guid.NewGuid());
        var groups = (source.Groups ?? []).ToDictionary(x => x.Id, _ => Guid.NewGuid());
        return source with
        {
            Tabs = source.Tabs.Select(x => x with { Id = tabs[x.Id], GroupId = x.GroupId is { } id && groups.TryGetValue(id, out var mapped) ? mapped : null,
                ParentId = x.ParentId is { } parent && tabs.TryGetValue(parent, out var mappedParent) ? mappedParent : null,
                WorkspaceName = workspaceName ?? x.WorkspaceName }).ToList(),
            ActiveTabId = source.ActiveTabId is { } active && tabs.TryGetValue(active, out var selected) ? selected : null,
            SplitTabIds = (source.SplitTabIds ?? []).Where(tabs.ContainsKey).Select(x => tabs[x]).ToList(),
            Groups = (source.Groups ?? []).Select(x => x with { Id = groups[x.Id] }).ToList(), SavedAt = DateTimeOffset.UtcNow
        };
    }
}
