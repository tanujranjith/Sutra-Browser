namespace Browser.Core.Runtime;

/// <summary>
/// Shares one in-flight operation even after a caller times out. Native operations
/// often cannot be cancelled; abandoning a wait must not start another copy.
/// </summary>
public sealed class CoalescingAsyncOperation<T>
{
    private readonly object _gate = new();
    private Task<T>? _current;

    public async Task<T> RunAsync(Func<Task<T>> start, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(start);
        cancellationToken.ThrowIfCancellationRequested();
        Task<T> operation;
        lock (_gate)
        {
            if (_current is null || _current.IsCompleted)
            {
                operation = start();
                _current = operation;
                // Observe late native faults even when every waiting caller has
                // already timed out or closed its window. No UI continuation.
                _ = operation.ContinueWith(task =>
                {
                    _ = task.Exception;
                    lock (_gate) if (ReferenceEquals(_current, task)) _current = null;
                }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            }
            else operation = _current;
        }
        return await operation.WaitAsync(timeout, cancellationToken);
    }
}
