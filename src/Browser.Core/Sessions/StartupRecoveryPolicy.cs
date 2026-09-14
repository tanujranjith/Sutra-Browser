using System.Text.Json;

namespace Browser.Core.Sessions;

public sealed record StartupRecoveryState(int ConsecutiveFailures, DateTimeOffset StartedAt)
{
    public bool NeedsReview => ConsecutiveFailures >= 2;
}

public static class StartupRecoveryPolicy
{
    public const string StorageKey = "browser.startupRecovery";
    public static StartupRecoveryState Begin(string? stored, bool previousShutdownWasClean, DateTimeOffset now)
    {
        StartupRecoveryState? previous = null;
        if (stored?.Length <= 1024)
        {
            try { previous = JsonSerializer.Deserialize<StartupRecoveryState>(stored); }
            catch (JsonException) { }
        }
        var recent = previous is not null && previous.StartedAt <= now && now - previous.StartedAt < TimeSpan.FromMinutes(15);
        var failures = previousShutdownWasClean ? 0 : recent ? Math.Clamp(previous!.ConsecutiveFailures, 0, 2) + 1 : 1;
        return new(Math.Min(failures, 3), now);
    }

    public static BrowserSession SelectTabs(BrowserSession session, IEnumerable<Guid> selected)
    {
        var ids = selected.Take(1000).ToHashSet();
        var tabs = session.Tabs.Where(tab => ids.Contains(tab.Id) && !tab.IsTemporary).ToArray();
        return SessionSerializer.Deserialize(SessionSerializer.Serialize(session with
        {
            Tabs = tabs,
            ActiveTabId = tabs.Any(tab => tab.Id == session.ActiveTabId) ? session.ActiveTabId : tabs.FirstOrDefault()?.Id
        }));
    }
}
