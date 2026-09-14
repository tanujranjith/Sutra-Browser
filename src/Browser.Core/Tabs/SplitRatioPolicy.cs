namespace Browser.Core.Tabs;

/// <summary>
/// Custom dragged split ratios (#17). Presets already persist via
/// <see cref="SplitLayoutPreset"/>; this persists the user's dragged column/row
/// fractions so a relaunch restores the same proportions. Input is untrusted
/// (session JSON, imports) so every value is clamped and renormalized.
/// </summary>
public static class SplitRatioPolicy
{
    public const double MinimumFraction = 0.15;
    public const double MaximumFraction = 0.85;
    public const int MaximumPanes = 8;

    /// <summary>Normalizes dragged fractions. Returns null when the input is not a usable custom ratio.</summary>
    public static IReadOnlyList<double>? Normalize(IReadOnlyList<double>? fractions, int paneCount)
    {
        if (fractions is null || paneCount < 2 || paneCount > MaximumPanes) return null;
        var values = fractions.Where(double.IsFinite).Select(v => Math.Clamp(v, MinimumFraction, MaximumFraction)).ToList();
        if (values.Count != paneCount) return null;
        var sum = values.Sum();
        if (!double.IsFinite(sum) || sum <= 0) return null;
        var normalized = values.Select(v => v / sum).ToList();
        if (normalized.Any(v => !double.IsFinite(v) || v < 0.10 || v > 0.90)) return null;
        // Renormalize once more to absorb floating-point drift; the caller renders these as star weights.
        var total = normalized.Sum();
        return normalized.Select(v => v / total).ToList();
    }

    /// <summary>Derives star fractions from measured pixel sizes (ActualWidth/ActualHeight).</summary>
    public static IReadOnlyList<double>? FromPixels(IReadOnlyList<double>? pixels)
    {
        if (pixels is null || pixels.Count is < 2 or > MaximumPanes) return null;
        if (pixels.Any(v => !double.IsFinite(v) || v <= 0)) return null;
        var total = pixels.Sum();
        if (!double.IsFinite(total) || total <= 0) return null;
        return Normalize(pixels.Select(v => v / total).ToList(), pixels.Count);
    }

    /// <summary>True when the fractions differ enough from an even split to be worth persisting.</summary>
    public static bool IsCustom(IReadOnlyList<double>? fractions, int paneCount)
    {
        var normalized = Normalize(fractions, paneCount);
        if (normalized is null) return false;
        var even = 1d / paneCount;
        return normalized.Any(v => Math.Abs(v - even) > 0.02);
    }
}
