namespace Browser.Core.Diagnostics;

/// <summary>OS pressure + battery state (#6). Pure policy: maps a platform snapshot to a hibernation strictness.</summary>
public enum MemoryPressureLevel { Normal, Elevated, Critical }

public sealed record SystemResourceSnapshot(MemoryPressureLevel Pressure, bool BatterySaverOn, long AvailableMemoryMb);

public static class AdaptiveMemoryPolicy
{
    /// <summary>Effective live-tab budget after pressure/battery adaptation. Never increases the base limit.</summary>
    public static int EffectiveTabLimit(int baseLimit, SystemResourceSnapshot snapshot)
    {
        baseLimit = Math.Clamp(baseLimit, 1, 100);
        var limit = baseLimit;
        if (snapshot.BatterySaverOn) limit = Math.Min(limit, Math.Max(3, baseLimit / 2));
        limit = snapshot.Pressure switch
        {
            MemoryPressureLevel.Elevated => Math.Min(limit, Math.Max(3, baseLimit / 2)),
            MemoryPressureLevel.Critical => Math.Min(limit, Math.Max(1, baseLimit / 4)),
            _ => limit,
        };
        return Math.Clamp(limit, 1, 100);
    }

    /// <summary>Effective inactivity threshold in minutes. Pressure shortens it; never lengthens.</summary>
    public static int EffectiveInactivityMinutes(int baseMinutes, SystemResourceSnapshot snapshot)
    {
        baseMinutes = Math.Clamp(baseMinutes, 1, 10080);
        if (snapshot.Pressure == MemoryPressureLevel.Critical) return Math.Max(1, baseMinutes / 4);
        if (snapshot.Pressure == MemoryPressureLevel.Elevated || snapshot.BatterySaverOn) return Math.Max(1, baseMinutes / 2);
        return baseMinutes;
    }

    public static string Describe(SystemResourceSnapshot snapshot) =>
        $"Memory pressure {snapshot.Pressure}, battery saver {(snapshot.BatterySaverOn ? "on" : "off")}, available {Math.Max(0, snapshot.AvailableMemoryMb)} MB";
}
