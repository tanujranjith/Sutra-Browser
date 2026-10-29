using Browser.Core.Settings;
using Browser.Core.Tabs;

namespace Browser.Core.Diagnostics;

public static class MemoryBudgetPolicy
{
    public static int LiveTabLimit(int configured, MemorySaverMode mode, SystemResourceSnapshot snapshot)
    {
        configured = Math.Clamp(configured, 1, 100);
        var modeLimit = mode switch { MemorySaverMode.Aggressive => Math.Max(1, configured / 2), MemorySaverMode.Maximum => 1, _ => configured };
        return AdaptiveMemoryPolicy.EffectiveTabLimit(modeLimit, snapshot);
    }

    public static IReadOnlyList<BrowserTab> Candidates(IEnumerable<BrowserTab> eligible, int actualLiveCount, int liveTabLimit, bool enabled) =>
        !enabled ? [] : eligible.OrderBy(tab => tab.LastActivatedAt).ThenByDescending(tab => tab.RendererMemoryBytes ?? 0)
            .Take(Math.Max(0, Math.Max(0, actualLiveCount) - Math.Max(1, liveTabLimit))).ToArray();
}
