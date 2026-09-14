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
    /// <summary>Temporary tabs are per-window previews: never persisted, never restored, never kept in recently-closed.</summary>
    public bool IsTemporary { get; set; }
    /// <summary>Tree-tab parent. Null means a root tab. Cycles and missing parents are repaired on load.</summary>
    public Guid? ParentId { get; set; }
    /// <summary>When true, this tab's tree children are hidden in the tab lists until expanded.</summary>
    public bool IsTreeCollapsed { get; set; }
    public string? Error { get; set; }

    public BrowserTabSnapshot ToSnapshot() => new(Id, Url, Title, FaviconPath, IsPinned, IsHibernated,
        LastActivatedAt, CreatedAt, ScrollPosition, IsMuted, GroupName, GroupId, WorkspaceName, IsTemporary, ParentId, IsTreeCollapsed);

    public static BrowserTab FromSnapshot(BrowserTabSnapshot? item)
    {
        if (item is null) return new() { Url = "browser://newtab", Title = "New tab" };
        var url = RestoreUrl(item.Url);
        return new()
        {
            Id = item.Id == Guid.Empty ? Guid.NewGuid() : item.Id,
            Url = url,
            Title = url == "browser://newtab" ? "New tab" : string.IsNullOrWhiteSpace(item.Title) ? "New tab" : item.Title,
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
        ,IsTemporary = item.IsTemporary,
        ParentId = item.ParentId is { } parentId && parentId != Guid.Empty && parentId != (item.Id == Guid.Empty ? Guid.Empty : item.Id) ? parentId : null,
        IsTreeCollapsed = item.IsTreeCollapsed
        };
    }

    private static string RestoreUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "browser://newtab";
        if (value == "browser://newtab" || value.Equals("about:blank", StringComparison.OrdinalIgnoreCase) || value.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return "browser://newtab";
        return Browser.Core.Sessions.SessionSerializer.IsRestorableUrl(value) ? value : "browser://newtab";
    }
}

public sealed record BrowserTabSnapshot(Guid Id, string Url, string Title, string? FaviconPath,
    bool IsPinned, bool IsHibernated, DateTimeOffset LastActivatedAt, DateTimeOffset CreatedAt,
    double ScrollPosition, bool IsMuted, string? GroupName = null, Guid? GroupId = null, string? WorkspaceName = null,
    bool IsTemporary = false, Guid? ParentId = null, bool IsTreeCollapsed = false);

public static class TabOrdering
{
    public static IReadOnlyList<BrowserTab> PinnedFirst(IEnumerable<BrowserTab> tabs) =>
        tabs.Select((tab, index) => (tab, index)).OrderBy(x => x.tab.IsPinned ? 0 : 1)
            .ThenBy(x => x.index).Select(x => x.tab).ToList();
}
