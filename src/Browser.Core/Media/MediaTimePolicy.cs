namespace Browser.Core.Media;

public static class MediaTimePolicy
{
    public const double MaximumSeconds = 365 * 24 * 60 * 60;
    public static string Format(double? seconds)
    {
        if (seconds is null || !double.IsFinite(seconds.Value) || seconds < 0) return "--:--";
        var value = (long)Math.Min(seconds.Value, MaximumSeconds);
        return value >= 3600 ? $"{value / 3600}:{value / 60 % 60:00}:{value % 60:00}" : $"{value / 60}:{value % 60:00}";
    }
}
