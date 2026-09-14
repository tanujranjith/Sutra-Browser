namespace Browser.Core.Diagnostics;

/// <summary>
/// CPU + time-series browser health (#7). Bounded in-memory ring; per-tab CPU is a
/// clearly-labeled current-process estimate because WebView2 renderers are shared and
/// ephemeral. No URLs, titles, or paths are stored here.
/// </summary>
public sealed record HealthSample(DateTimeOffset At, long ShellMemoryMb, int LiveWebViews, int SleepingTabs, double CpuPercent);

public sealed class HealthHistory
{
    public const int MaximumSamples = 120;
    private readonly Queue<HealthSample> _samples = new();

    public void Add(HealthSample sample)
    {
        _samples.Enqueue(new(
            sample.At,
            Math.Clamp(sample.ShellMemoryMb, 0, 1_000_000),
            Math.Clamp(sample.LiveWebViews, 0, 1000),
            Math.Clamp(sample.SleepingTabs, 0, 1000),
            double.IsFinite(sample.CpuPercent) ? Math.Clamp(sample.CpuPercent, 0, 1000) : 0));
        while (_samples.Count > MaximumSamples) _samples.Dequeue();
    }

    public IReadOnlyList<HealthSample> Samples => _samples.ToList();

    /// <summary>ASCII sparkline for native dashboard text. Bounded output, no locale-sensitive formatting.</summary>
    public static string Sparkline(IEnumerable<double> values)
    {
        const string bars = "▁▂▃▄▅▆▇█";
        var list = values.Where(double.IsFinite).Select(v => Math.Max(0, v)).Take(MaximumSamples).ToList();
        if (list.Count == 0) return "no samples";
        var max = list.Max();
        if (max <= 0) return new(bars[0], list.Count);
        return string.Concat(list.Select(v => bars[Math.Clamp((int)Math.Round(v / max * (bars.Length - 1)), 0, bars.Length - 1)]));
    }
}
