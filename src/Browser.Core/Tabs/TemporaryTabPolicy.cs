namespace Browser.Core.Tabs;

/// <summary>
/// Temporary tabs (#19) are per-window previews. They are never persisted in
/// automatic sessions, snapshots, or recently-closed history, and they are
/// discarded when their window closes. History recording is unaffected: a
/// temporary tab is not private browsing.
/// </summary>
public static class TemporaryTabPolicy
{
    /// <summary>True when the tab must be excluded from every automatic persistence path.</summary>
    public static bool IsTemporary(BrowserTab? tab) => tab is not null && tab.IsTemporary;

    public static bool ShouldPersist(BrowserTab? tab) => tab is not null && !tab.IsTemporary;

    public static bool ShouldPersistSnapshot(BrowserTabSnapshot? snapshot) => snapshot is not null && !snapshot.IsTemporary;

    /// <summary>Drops temporary tabs and repairs the active tab. Never throws on untrusted input.</summary>
    public static IReadOnlyList<BrowserTabSnapshot> ExcludeTemporary(IEnumerable<BrowserTabSnapshot>? tabs)
    {
        if (tabs is null) return [];
        return tabs.Where(ShouldPersistSnapshot).ToList();
    }

    /// <summary>Recently-closed is an explicit undo for durable tabs only.</summary>
    public static bool ShouldKeepInRecentlyClosed(BrowserTab? tab) => ShouldPersist(tab);
}
