namespace Browser.Core.Diagnostics;

/// <summary>
/// Benchmark-driven startup (#5). Records local phase timings so regressions are
/// measurable on the same machine. No network, no URLs, no file paths leave the
/// process: diagnostics copy only durations and counts.
/// </summary>
public sealed record StartupPhaseTiming(string Phase, long Milliseconds);

public static class StartupPerformancePolicy
{
    public const long SlowColdStartMilliseconds = 5000;
    public const long SlowPhaseMilliseconds = 1500;
    public const int MaximumPhases = 12;

    public static IReadOnlyList<StartupPhaseTiming> Normalize(IEnumerable<StartupPhaseTiming>? phases)
    {
        if (phases is null) return [];
        return phases
            .Where(p => p is not null && !string.IsNullOrWhiteSpace(p.Phase) && p.Milliseconds >= 0 && p.Milliseconds <= 600_000)
            .Select(p => new StartupPhaseTiming(p.Phase.Trim()[..Math.Min(40, p.Phase.Trim().Length)], p.Milliseconds))
            .GroupBy(p => p.Phase, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .Take(MaximumPhases).ToList();
    }

    public static long TotalMilliseconds(IEnumerable<StartupPhaseTiming> phases) =>
        phases.Sum(p => Math.Clamp(p.Milliseconds, 0, 600_000));

    public static bool IsSlowColdStart(IEnumerable<StartupPhaseTiming> phases) =>
        TotalMilliseconds(phases) >= SlowColdStartMilliseconds;

    public static IReadOnlyList<string> SlowPhases(IEnumerable<StartupPhaseTiming> phases) =>
        phases.Where(p => p.Milliseconds >= SlowPhaseMilliseconds).Select(p => p.Phase).ToList();

    public static string Summarize(IEnumerable<StartupPhaseTiming> phases)
    {
        var list = Normalize(phases);
        if (list.Count == 0) return "Startup timing unavailable";
        return $"Startup {TotalMilliseconds(list)} ms across {list.Count} phases; slowest: {string.Join(", ", list.OrderByDescending(p => p.Milliseconds).Take(3).Select(p => $"{p.Phase} {p.Milliseconds} ms"))}";
    }
}
