namespace Browser.Core.Runtime;

/// <summary>
/// Tracks the latest in-flight background work so a closing window can cancel
/// lifetime work and await it before releasing controls that work can touch.
/// Only the most recent registration is kept: callers prevent overlap themselves
/// (for example, timer ticks skip while a tracked pass is active), so tracking
/// the newest task is sufficient for a deterministic drain.
/// </summary>
public sealed class BackgroundWorkTracker
{
    private readonly object _gate = new();
    private Task? _latest;

    /// <summary>True while the tracked task has not completed.</summary>
    public bool IsActive
    {
        get { lock (_gate) return _latest is { IsCompleted: false }; }
    }

    /// <summary>Records work as the current tracked task. Exceptions must be observed by the caller.</summary>
    public void Track(Task work)
    {
        ArgumentNullException.ThrowIfNull(work);
        lock (_gate) _latest = work;
    }

    /// <summary>
    /// Awaits the tracked task so shutdown never releases shared controls while it
    /// can still observe them. Returns true when something was awaited to completion.
    /// </summary>
    public async Task<bool> DrainAsync(CancellationToken cancellationToken = default)
    {
        Task? work;
        lock (_gate) work = _latest;
        if (work is null || work.IsCompleted) return false;
        await work.WaitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }
}
