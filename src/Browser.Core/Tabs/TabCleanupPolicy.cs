namespace Browser.Core.Tabs;

public static class TabCleanupPolicy
{
    public static bool IsProtected(BrowserTab tab) => tab.IsPinned || tab.MayHaveUnsavedFormInput || tab.HasActiveDownload ||
        tab.IsMediaPlaying || tab.IsInActiveCall || tab.HasPermissionPrompt;

    public static string? SleepBlockReason(BrowserTab tab, Guid? activeId, bool inSplit, bool protectedGroup, bool miniPlayer,
        bool hasController, IEnumerable<string> excludedDomains)
    {
        if (tab.IsHibernated || !hasController) return "Already sleeping or not loaded";
        if (tab.Id == activeId) return "Current tab";
        if (inSplit) return "Visible in split screen";
        if (miniPlayer) return "Mini-player is open";
        if (protectedGroup) return "Group is set to stay awake";
        if (tab.IsPinned) return "Pinned tab";
        if (tab.MayHaveUnsavedFormInput) return "May contain unsaved work";
        if (tab.HasActiveDownload) return "Active download";
        if (tab.IsInActiveCall) return "Active call";
        if (tab.IsMediaPlaying) return "Media is playing";
        if (tab.HasPermissionPrompt) return "Permission prompt needs attention";
        if (tab.IsLoading) return "Page is still loading";
        if (Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && excludedDomains.Any(domain =>
            uri.Host.Equals(domain.Trim(), StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith('.' + domain.Trim(), StringComparison.OrdinalIgnoreCase)))
            return "Site is excluded from memory saving";
        return null;
    }

    public static IReadOnlyList<BrowserTab> DuplicateCandidates(IEnumerable<BrowserTab> tabs, Guid? activeId, IReadOnlySet<Guid> protectedIds)
    {
        bool Keep(BrowserTab tab) => tab.Id == activeId || IsProtected(tab) || protectedIds.Contains(tab.Id);
        return tabs.Where(tab => Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" && string.IsNullOrEmpty(uri.UserInfo))
            // Paths, query values and fragments can be case-sensitive. A trailing
            // slash can name a different resource; never trim it for cleanup.
            .GroupBy(tab => new Uri(tab.Url).AbsoluteUri, StringComparer.Ordinal)
            .SelectMany(group => group.OrderByDescending(Keep).Skip(1).Where(tab => !Keep(tab))).ToArray();
    }
}
