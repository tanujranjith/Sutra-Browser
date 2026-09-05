namespace Browser.Core.Tabs;

public sealed record HibernationSettings(bool Enabled = true, int InactivityMinutes = 30,
    bool NeverHibernatePinnedTabs = true, IReadOnlySet<string>? ExcludedDomains = null);

public static class HibernationPolicy
{
    public static bool CanHibernate(BrowserTab tab, BrowserTab? activeTab, HibernationSettings settings,
        DateTimeOffset now)
    {
        if (!settings.Enabled || ReferenceEquals(tab, activeTab) || tab.Id == activeTab?.Id || tab.IsHibernated) return false;
        if (settings.NeverHibernatePinnedTabs && tab.IsPinned) return false;
        if (tab.IsMediaPlaying || tab.IsInActiveCall || tab.HasActiveDownload || tab.HasPermissionPrompt || tab.MayHaveUnsavedFormInput) return false;
        if (now - tab.LastActivatedAt < TimeSpan.FromMinutes(Math.Clamp(settings.InactivityMinutes, 1, 10080))) return false;
        if (Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) &&
            settings.ExcludedDomains?.Any(x => DomainMatches(uri.Host, x)) == true) return false;
        return true;
    }

    private static bool DomainMatches(string host, string excluded) =>
        host.Equals(excluded.Trim(), StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith('.' + excluded.Trim(), StringComparison.OrdinalIgnoreCase);
}

