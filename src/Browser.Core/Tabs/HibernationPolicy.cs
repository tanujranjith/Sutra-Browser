namespace Browser.Core.Tabs;

public sealed record HibernationSettings(bool Enabled = true, int InactivityMinutes = 30,
    bool NeverHibernatePinnedTabs = true, IReadOnlySet<string>? ExcludedDomains = null);

public static class HibernationPolicy
{
    public static bool CanHibernate(BrowserTab tab, BrowserTab? activeTab, HibernationSettings settings,
        DateTimeOffset now) => GetBlockReason(tab, activeTab, settings, now) is null;

    public static string? GetBlockReason(BrowserTab tab, BrowserTab? activeTab, HibernationSettings settings, DateTimeOffset now)
    {
        if (tab.IsHibernated) return "Sleeping — its WebView has been released";
        if (!settings.Enabled) return "Automatic memory saving is off";
        if (ReferenceEquals(tab, activeTab) || tab.Id == activeTab?.Id) return "You are using this tab";
        if (settings.NeverHibernatePinnedTabs && tab.IsPinned) return "Pinned tabs stay awake";
        if (tab.IsInActiveCall) return "A call is active";
        if (tab.IsMediaPlaying) return "Media is playing";
        if (tab.HasActiveDownload) return "A download is active";
        if (tab.HasPermissionPrompt) return "A permission prompt needs attention";
        if (tab.MayHaveUnsavedFormInput) return "The page may contain unsaved work";
        if (now - tab.LastActivatedAt < TimeSpan.FromMinutes(Math.Clamp(settings.InactivityMinutes, 1, 10080))) return "Used recently";
        if (Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) &&
            settings.ExcludedDomains?.Any(x => DomainMatches(uri.Host, x)) == true) return "This site is excluded from memory saving";
        return null;
    }

    private static bool DomainMatches(string host, string excluded) =>
        host.Equals(excluded.Trim(), StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith('.' + excluded.Trim(), StringComparison.OrdinalIgnoreCase);
}
