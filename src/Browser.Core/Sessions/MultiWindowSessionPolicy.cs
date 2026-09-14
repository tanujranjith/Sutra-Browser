using Browser.Core.Settings;
using Browser.Core.Tabs;

namespace Browser.Core.Sessions;

/// <summary>
/// Automatic restoration of all normal windows (#2). Every normal window keeps
/// its own recoverable snapshot; this policy decides which saved windows reopen
/// automatically. Private windows never participate, temporary tabs never
/// persist, and crash-loop protection still opens a fresh tab instead of
/// restoring when <see cref="StartupRecoveryPolicy"/> requires review.
/// </summary>
public static class MultiWindowSessionPolicy
{
    public const int MaximumWindowsToRestore = 8;
    public const int MaximumTabsPerWindow = 200;

    public sealed record SavedWindow(Guid WindowId, string ProfileName, BrowserSession Session, DateTimeOffset SavedAt);

    /// <summary>True when automatic multi-window restore should run for this launch.</summary>
    public static bool ShouldRestoreAutomatically(
        BrowserSettings settings,
        bool isPrivate,
        bool hasLaunchSession,
        bool hasInitialUrl,
        bool crashNeedsReview)
    {
        if (isPrivate || hasLaunchSession || hasInitialUrl || crashNeedsReview) return false;
        return settings.StartupBehavior == StartupBehavior.RestorePreviousSession;
    }

    /// <summary>Selects which saved windows reopen, newest first, bounded and de-duplicated.</summary>
    public static IReadOnlyList<SavedWindow> SelectWindowsToRestore(IEnumerable<SavedWindow>? windows, string profileName)
    {
        if (windows is null) return [];
        var profile = (profileName ?? "Default").Trim();
        if (profile.Length == 0) profile = "Default";
        return windows
            .Where(w => w.Session is not null && w.WindowId != Guid.Empty)
            .Where(w => string.Equals((w.ProfileName ?? "Default").Trim(), profile, StringComparison.OrdinalIgnoreCase))
            .Where(w => !string.Equals((w.ProfileName ?? string.Empty).Trim(), "Private", StringComparison.OrdinalIgnoreCase))
            .Select(w => w with { Session = WithoutTemporary(w.Session) })
            .Where(w => w.Session.Tabs.Count > 0)
            .OrderByDescending(w => w.SavedAt)
            .GroupBy(w => w.WindowId).Select(g => g.First())
            .Take(MaximumWindowsToRestore)
            .ToList();
    }

    /// <summary>Drops temporary tabs from a session before persistence or restoration.</summary>
    public static BrowserSession WithoutTemporary(BrowserSession session)
    {
        var tabs = TemporaryTabPolicy.ExcludeTemporary(session.Tabs).Take(MaximumTabsPerWindow).ToList();
        if (tabs.Count == 0) return session with { Tabs = [], ActiveTabId = null, SplitTabIds = [] };
        var live = tabs.Select(x => x.Id).ToHashSet();
        var active = live.Contains(session.ActiveTabId ?? Guid.Empty) ? session.ActiveTabId : tabs[0].Id;
        var split = (session.SplitTabIds ?? []).Where(live.Contains).Distinct().Take(8).ToList();
        if (split.Count < 2) split.Clear();
        return SessionSerializer.Deserialize(SessionSerializer.Serialize(session with
        {
            Tabs = tabs,
            ActiveTabId = active,
            SplitTabIds = split,
        }));
    }

    /// <summary>True when the window still has durable tabs worth persisting.</summary>
    public static bool ShouldPersistWindow(IEnumerable<BrowserTabSnapshot>? tabs) =>
        tabs is not null && tabs.Any(TemporaryTabPolicy.ShouldPersistSnapshot);
}
