namespace Browser.Core.Runtime;

/// <summary>Tracks concurrent finite IO and seals new work before shutdown drains it.</summary>
public sealed class BackgroundWorkSet
{
    private readonly object _gate = new();
    private readonly HashSet<Task> _active = [];
    private bool _stopped;

    public Task RunAsync(Func<Task> start)
    {
        lock (_gate)
        {
            if (_stopped) return Task.FromCanceled(new CancellationToken(true));
            var work = start();
            _active.Add(work);
            _ = work.ContinueWith(task =>
            {
                _ = task.Exception;
                lock (_gate) _active.Remove(task);
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            return work;
        }
    }

    public Task StopAndDrainAsync()
    {
        lock (_gate)
        {
            _stopped = true;
            return Task.WhenAll(_active.ToArray());
        }
    }
}
