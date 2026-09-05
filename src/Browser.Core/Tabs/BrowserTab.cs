namespace Browser.Core.Tabs;

public sealed class BrowserTab
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Url { get; set; } = "browser://newtab";
    public string Title { get; set; } = "New tab";
    public string? FaviconPath { get; set; }
    public string? ThumbnailPath { get; set; }
    public bool IsLoading { get; set; }
    public bool IsPinned { get; set; }
    public bool IsHibernated { get; set; }
    public DateTimeOffset LastActivatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public double ScrollPosition { get; set; }
    public bool IsMediaPlaying { get; set; }
    public bool HasActiveDownload { get; set; }
    public bool MayHaveUnsavedFormInput { get; set; }
    public bool HasPermissionPrompt { get; set; }
    public bool IsInActiveCall { get; set; }
    public bool IsMuted { get; set; }
    // Live diagnostic data. It is deliberately not part of the session snapshot:
    // WebView2 renderer processes are ephemeral and may be shared by several tabs.
    public long? RendererMemoryBytes { get; set; }
    public bool RendererMemoryIsShared { get; set; }
    public int RendererMemorySharingTabCount { get; set; }
    public DateTimeOffset? RendererMemoryMeasuredAt { get; set; }
    // A hibernated tab has no live renderer process, so this is a clearly-labeled
    // current-process estimate based on the last measured renderer working set.
    public long? HibernationBaselineMemoryBytes { get; set; }
    public long? HibernatedEstimatedMemoryBytes { get; set; }
    /// <summary>Stable group identity. GroupName is retained for old session compatibility.</summary>
    public Guid? GroupId { get; set; }
    public string? GroupName { get; set; }
    /// <summary>Workspace membership is lightweight metadata; inactive workspaces do not need live WebViews.</summary>
    public string? WorkspaceName { get; set; }
    public string? Error { get; set; }

    public BrowserTabSnapshot ToSnapshot() => new(Id, Url, Title, FaviconPath, IsPinned, IsHibernated,
        LastActivatedAt, CreatedAt, ScrollPosition, IsMuted, GroupName, GroupId, WorkspaceName);

    public static BrowserTab FromSnapshot(BrowserTabSnapshot item) => new()
    {
        Id = item.Id == Guid.Empty ? Guid.NewGuid() : item.Id,
        Url = RestoreUrl(item.Url),
        Title = RestoreUrl(item.Url) == "browser://newtab" ? "New tab" : string.IsNullOrWhiteSpace(item.Title) ? "New tab" : item.Title,
        FaviconPath = item.FaviconPath,
        IsPinned = item.IsPinned,
        IsHibernated = item.IsHibernated,
        LastActivatedAt = item.LastActivatedAt,
        CreatedAt = item.CreatedAt,
        ScrollPosition = item.ScrollPosition,
        IsMuted = item.IsMuted,
        GroupId = item.GroupId is { } groupId && groupId != Guid.Empty ? groupId : null,
        GroupName = string.IsNullOrWhiteSpace(item.GroupName) ? null : item.GroupName.Trim()
        ,WorkspaceName = string.IsNullOrWhiteSpace(item.WorkspaceName) ? null : item.WorkspaceName.Trim()
    };

    private static string RestoreUrl(string value)
    {
        if (value == "browser://newtab" || value.Equals("about:blank", StringComparison.OrdinalIgnoreCase) || value.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return "browser://newtab";
        return Uri.TryCreate(value, UriKind.Absolute, out _) ? value : "browser://newtab";
    }
}

public sealed record BrowserTabSnapshot(Guid Id, string Url, string Title, string? FaviconPath,
    bool IsPinned, bool IsHibernated, DateTimeOffset LastActivatedAt, DateTimeOffset CreatedAt,
    double ScrollPosition, bool IsMuted, string? GroupName = null, Guid? GroupId = null, string? WorkspaceName = null);

public static class TabOrdering
{
    public static IReadOnlyList<BrowserTab> PinnedFirst(IEnumerable<BrowserTab> tabs) =>
        tabs.Select((tab, index) => (tab, index)).OrderBy(x => x.tab.IsPinned ? 0 : 1)
            .ThenBy(x => x.index).Select(x => x.tab).ToList();
}
