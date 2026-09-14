using Browser.Core.Sessions;

namespace Browser.Core.Tabs;

/// <summary>
/// Horizontal tab-strip transfer between windows (#11). Sidebar transfer already
/// exists; the strip uses the same safety boundaries: same profile, same
/// private mode, no native browser-owned pages, and no protected tabs
/// (pinned, downloads, calls, media, unsaved input, permission prompts).
/// </summary>
public static class TabTransferPolicy
{
    public sealed record TransferCheck(bool Allowed, string Reason);

    public static TransferCheck CanTransfer(
        BrowserTab? tab,
        bool isNativePage,
        string sourceProfile,
        bool sourcePrivate,
        string targetProfile,
        bool targetPrivate)
    {
        if (tab is null) return new(false, "The tab is no longer available.");
        if (isNativePage) return new(false, "Browser pages cannot be moved. Open the destination from the menu instead.");
        if (tab.IsTemporary) return new(false, "Temporary tabs stay in their window. Duplicate the page to move it.");
        if (!string.Equals(sourceProfile?.Trim(), targetProfile?.Trim(), StringComparison.OrdinalIgnoreCase))
            return new(false, "Tabs can only move between windows in the same profile.");
        if (sourcePrivate != targetPrivate)
            return new(false, "Tabs cannot move between private and normal windows.");
        if (TabCleanupPolicy.IsProtected(tab))
            return new(false, "Finish downloads, calls, media, or unsaved work and unpin this tab before moving it.");
        if (!SessionSerializer.IsRestorableUrl(tab.Url))
            return new(false, "This page cannot be restored in another window.");
        return new(true, string.Empty);
    }

    /// <summary>Drop index for a horizontal strip. Clamps untrusted indices; pinned tabs stay first.</summary>
    public static int ClampDropIndex(int dropIndex, int tabCount, bool isPinned)
    {
        if (tabCount <= 0) return 0;
        if (isPinned) return Math.Clamp(dropIndex, 0, tabCount);
        return Math.Clamp(dropIndex, 0, tabCount);
    }
}
