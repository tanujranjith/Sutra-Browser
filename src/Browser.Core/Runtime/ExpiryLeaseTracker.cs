namespace Browser.Core.Runtime;

/// <summary>
/// Generation-based expiry lease for reused timers (status notifications, the
/// Ctrl+Tab switcher overlay). Arming a new generation invalidates every older
/// expiration; an expiration acts only when it still belongs to the newest armed
/// generation. Purely functional so dismissal rules are unit-testable without a
/// DispatcherTimer, and free of the classic bug where a permanently registered
/// Tick handler keeps the first call's captured generation forever.
///
/// Usage pattern for a single reused timer:
///   scheduled = tracker.Arm();      // store in a field, not a handler local
///   restart timer;
///   on tick: if (tracker.ShouldDismiss(scheduledField)) dismiss();
/// Because both sides read current fields on every firing, later notifications
/// always dismiss after their own lifetime and stale expirations never act.
/// </summary>
public sealed class ExpiryLeaseTracker
{
    private int _issued;
    private int _armed;

    /// <summary>Issues the next generation and arms it as the only active lease.</summary>
    public int Arm()
    {
        var generation = ++_issued;
        _armed = generation;
        return generation;
    }

    /// <summary>True only when this expiration is the one armed for the newest generation. Zero/unknown generations never dismiss.</summary>
    public bool ShouldDismiss(int generation) => generation > 0 && generation == _armed && generation == _issued;

    /// <summary>The newest issued generation.</summary>
    public int CurrentGeneration => _issued;
}
