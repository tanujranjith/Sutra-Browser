namespace Browser.Core.Runtime;

/// <summary>
/// Strength of a persistence request. A <see cref="Session"/> pass also persists
/// settings (the application guarantees this), so a queued settings request may be
/// covered by a session pass; the inverse is never true.
/// </summary>
public enum PersistencePassKind
{
    SettingsOnly = 0,
    Session = 1,
}

/// <summary>
/// Coordinates bounded persistence passes so concurrent requests never execute
/// overlapping writes and no request is silently weakened.
///
/// Semantics:
/// - At most one pass executes at any moment.
/// - Requests that arrive while a pass runs are coalesced: the trailing pass
///   executes the strongest pending request's own delegate. A weaker request may
///   be covered by a stronger pass (session passes include settings effects);
///   a stronger request is never covered by a weaker one. Pass lambdas must read
///   live state when they execute rather than operating on an earlier snapshot.
/// - Callers that arrive during a pass wait until the work fully drains, so a final
///   request followed by <see cref="DrainAsync"/> gives shutdown a deterministic flush.
/// - A request can never be lost: deciding "no pending work remains" and becoming
///   idle happen under one continuous lock hold. A caller either registers before
///   that decision (its state is covered — directly, or by an equal-or-stronger
///   pass) or after it (it becomes the next owner and runs its own pass).
/// - A failed pass propagates to its owning caller and abandons coalesced retries,
///   so a persistent failure cannot loop; the next explicit request starts fresh.
/// Waiters observe quiescence, not success; owners observe exceptions directly.
/// </summary>
public sealed class PersistencePassCoordinator
{
    private readonly object _gate = new();
    private bool _running;
    private PersistencePassKind _pendingKind;
    private Func<CancellationToken, Task>? _pendingPass;
    private TaskCompletionSource? _drained;

    /// <summary>True while a pass is executing or at least one request is still waiting to be coalesced.</summary>
    public bool IsBusy { get { lock (_gate) return _running || _pendingPass is not null; } }

    public async Task RunAsync(PersistencePassKind kind, Func<CancellationToken, Task> pass, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(pass);

        bool owner;
        Task waitTask;
        lock (_gate)
        {
            if (!_running)
            {
                _running = true;
                _pendingKind = PersistencePassKind.SettingsOnly;
                _pendingPass = null;
                owner = true;
                waitTask = Task.CompletedTask;
            }
            else
            {
                // Track only the strongest queued request: weaker requests are
                // covered by it (or by the running pass). Equal strength keeps
                // the earliest delegate, which reads the same live state.
                if (_pendingPass is null || kind > _pendingKind)
                {
                    _pendingKind = kind;
                    _pendingPass = pass;
                }
                owner = false;
                _drained ??= CreateSignal();
                waitTask = _drained.Task;
            }
        }

        if (!owner)
        {
            // The running pass, plus at most one trailing pass of equal-or-stronger
            // kind, will persist this request's state.
            await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
            return;
        }

        var currentPass = pass;
        while (true)
        {
            Exception? failure;
            try
            {
                await currentPass(cancellationToken).ConfigureAwait(false);
                failure = null;
            }
            catch (Exception ex)
            {
                failure = ex;
            }

            TaskCompletionSource? signal;
            lock (_gate)
            {
                if (failure is null && _pendingPass is not null)
                {
                    // Consume the burst by executing the strongest pending
                    // request's own delegate exactly once.
                    currentPass = _pendingPass;
                    _pendingPass = null;
                    continue;
                }
                // Atomic completion transition. The pending check above and the
                // idle flip below share one lock hold, so a request arriving in
                // between is impossible: it either registered earlier (covered)
                // or registers after this block (becomes the next owner).
                if (failure is not null) _pendingPass = null;
                _running = false;
                signal = _drained;
                _drained = null;
            }
            signal?.TrySetResult();

            if (failure is null) return;
            // Preserve the original stack trace and exception type for the owner.
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
        }
    }

    /// <summary>Waits until no pass is executing and no coalesced request remains.</summary>
    public async Task DrainAsync(CancellationToken cancellationToken = default)
    {
        while (true)
        {
            Task waitTask;
            lock (_gate)
            {
                if (!_running && _pendingPass is null) return;
                _drained ??= CreateSignal();
                waitTask = _drained.Task;
            }
            await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static TaskCompletionSource CreateSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
