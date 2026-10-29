using Browser.Core.Diagnostics;
using Browser.Core.Media;
using Browser.Core.Runtime;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class StabilityPerformanceTests
{
    [Fact]
    public async Task TimedOutNativeCallsAreSharedUntilTheyActuallyFinish()
    {
        var operation = new CoalescingAsyncOperation<string>();
        var pending = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var starts = 0;
        Task<string> Start() { Interlocked.Increment(ref starts); return pending.Task; }
        var waits = Enumerable.Range(0, 10).Select(_ => operation.RunAsync(Start, TimeSpan.FromMilliseconds(10))).ToArray();
        foreach (var wait in waits) await Assert.ThrowsAsync<TimeoutException>(() => wait);
        Assert.Equal(1, starts);
        var next = operation.RunAsync(Start, TimeSpan.FromSeconds(5));
        pending.SetResult("responsive"); Assert.Equal("responsive", await next); Assert.Equal(1, starts);
        Assert.Equal("fresh", await operation.RunAsync(() => Task.FromResult("fresh"), TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task CancellingOneWaitDoesNotCancelAnotherWaitOrStartAnotherNativeCall()
    {
        var operation = new CoalescingAsyncOperation<int>(); var starts = 0;
        var pending = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<int> Start() { starts++; return pending.Task; }
        using var cancellation = new CancellationTokenSource();
        var first = operation.RunAsync(Start, TimeSpan.FromSeconds(5), cancellation.Token);
        var second = operation.RunAsync(Start, TimeSpan.FromSeconds(5));
        cancellation.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        pending.SetResult(42); Assert.Equal(42, await second); Assert.Equal(1, starts);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => operation.RunAsync(Start, TimeSpan.FromSeconds(5), cancellation.Token));
        Assert.Equal(1, starts);
    }

    [Fact]
    public async Task AFailedNativeOperationDoesNotPoisonFutureOperations()
    {
        var operation = new CoalescingAsyncOperation<int>();
        await Assert.ThrowsAsync<InvalidOperationException>(() => operation.RunAsync(() => Task.FromException<int>(new InvalidOperationException()), TimeSpan.FromSeconds(5)));
        Assert.Equal(7, await operation.RunAsync(() => Task.FromResult(7), TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task ShutdownWaitsForAllCacheWritesAndRejectsNewWrites()
    {
        var work = new BackgroundWorkSet();
        var first = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var second = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = work.RunAsync(() => first.Task); _ = work.RunAsync(() => second.Task);
        var shutdown = work.StopAndDrainAsync(); Assert.False(shutdown.IsCompleted);
        first.SetResult(); Assert.False(shutdown.IsCompleted);
        var startedAfterStop = false;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => work.RunAsync(() => { startedAfterStop = true; return Task.CompletedTask; }));
        Assert.False(startedAfterStop);
        second.SetResult(); await shutdown.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void MemoryBudgetSleepsOnlyExcessTabsAndKeepsTheMostRecent()
    {
        var now = DateTimeOffset.UtcNow;
        var recent = new BrowserTab { LastActivatedAt = now, RendererMemoryBytes = 100 };
        var oldHeavy = new BrowserTab { LastActivatedAt = now.AddHours(-2), RendererMemoryBytes = 900 };
        var oldLight = new BrowserTab { LastActivatedAt = now.AddHours(-2), RendererMemoryBytes = 50 };
        BrowserTab[] eligible = [recent, oldLight, oldHeavy];
        Assert.Equal(new[] { oldHeavy }, MemoryBudgetPolicy.Candidates(eligible, 4, 3, true));
        Assert.Equal(new[] { oldHeavy, oldLight }, MemoryBudgetPolicy.Candidates(eligible, 4, 2, true));
        Assert.Empty(MemoryBudgetPolicy.Candidates(eligible, 100, 1, false));
        Assert.Empty(MemoryBudgetPolicy.Candidates(eligible, 3, 3, true));
        Assert.Equal(3, MemoryBudgetPolicy.Candidates(eligible, 100, 1, true).Count); // Protected live tabs need not be eligible.
    }

    [Theory]
    [InlineData(MemorySaverMode.Balanced, MemoryPressureLevel.Normal, 16)]
    [InlineData(MemorySaverMode.Balanced, MemoryPressureLevel.Critical, 4)]
    [InlineData(MemorySaverMode.Aggressive, MemoryPressureLevel.Normal, 8)]
    [InlineData(MemorySaverMode.Aggressive, MemoryPressureLevel.Critical, 2)]
    [InlineData(MemorySaverMode.Maximum, MemoryPressureLevel.Normal, 1)]
    public void MemoryBudgetAppliesModeAndPressureExactlyOnce(MemorySaverMode mode, MemoryPressureLevel pressure, int expected) =>
        Assert.Equal(expected, MemoryBudgetPolicy.LiveTabLimit(16, mode, new(pressure, false, 1000)));

    [Theory]
    [InlineData(double.MaxValue, "8760:00:00")]
    [InlineData(double.NaN, "--:--")]
    [InlineData(double.PositiveInfinity, "--:--")]
    [InlineData(-1, "--:--")]
    [InlineData(90061.25, "25:01:01")]
    [InlineData(61.9, "1:01")]
    public void MediaTimestampsCannotOverflowOrWrapAtTwentyFourHours(double seconds, string expected) => Assert.Equal(expected, MediaTimePolicy.Format(seconds));

    [Fact]
    public void ThumbnailCleanupCannotDeleteOutsideItsGeneratedCachePaths()
    {
        var root = Path.Combine(Path.GetTempPath(), "sutra-cache-policy"); var tab = Guid.NewGuid();
        Assert.True(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, $"thumb-{tab:N}-{Guid.NewGuid():N}.jpg")));
        Assert.True(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, $"thumb-{tab:N}.png")));
        Assert.False(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, "important.jpg")));
        Assert.False(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, $"thumb-{Guid.NewGuid():N}.png")));
        Assert.False(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, "..", $"thumb-{tab:N}.png")));
        Assert.False(GeneratedThumbnailPolicy.IsOwnedPath(root, tab, Path.Combine(root, "nested", $"thumb-{tab:N}.png")));
    }
}
