using Browser.Core.Profiles;
using Browser.Data;
using Browser.Data.Repositories;
using Browser.Platform.Windows.Storage;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Platform.Windows.Tests;

public sealed class KillSwitchServiceTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"sutra-kill-service-{Guid.NewGuid():N}");
    private BrowserPaths _paths = null!;
    private KillSwitchService _service = null!;
    public Task InitializeAsync() { _paths = new(_root); _service = new(_paths); return Task.CompletedTask; }
    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        Directory.Delete(_root, recursive: true);
        return Task.CompletedTask;
    }
    private static async Task<HistoryRepository> SeedAsync(string path)
    {
        var database = new BrowserDatabase(path); await database.InitializeAsync();
        var history = new HistoryRepository(database);
        await history.RecordVisitAsync("https://example.com", "Search", "typed query");
        return history;
    }

    [Fact]
    public async Task CoversInactiveLibrariesAndPreservesUnrelatedFiles()
    {
        var main = await SeedAsync(_paths.DatabasePath);
        var work = await SeedAsync(Path.Combine(_root, "Libraries", ProfileIdentity.DirectoryKey("Work"), "browser.db"));
        var unused = await SeedAsync(Path.Combine(_root, "Libraries", ProfileIdentity.DirectoryKey("Inactive"), "browser.db"));
        var file = Path.Combine(_root, "download.txt"); await File.WriteAllTextAsync(file, "Keep me");
        Assert.Equal(1, await _service.RequestAsync());
        var engineCleared = 0;
        Assert.Equal(1, await _service.CompletePendingAsync(_ => { engineCleared++; return Task.CompletedTask; }));
        Assert.Empty(await main.SearchAsync()); Assert.Empty(await work.SearchAsync()); Assert.Empty(await unused.SearchAsync());
        Assert.Equal("Keep me", await File.ReadAllTextAsync(file)); Assert.Equal(1, engineCleared);
        await _service.CompletePendingAsync(_ => { engineCleared++; return Task.CompletedTask; });
        Assert.Equal(1, engineCleared);
    }

    [Fact]
    public async Task FailedEngineCleanupIsRetriedBeforeCompletion()
    {
        var history = await SeedAsync(_paths.DatabasePath);
        await _service.RequestAsync();
        await Assert.ThrowsAsync<IOException>(() => _service.CompletePendingAsync(_ => throw new IOException("Injected failure")));
        Assert.Empty(await history.SearchAsync());
        Assert.False(File.Exists(Path.Combine(_root, "kill-switch.completed")));
        var restarted = new KillSwitchService(new(_root));
        var retried = false;
        await restarted.CompletePendingAsync(_ => { retried = true; return Task.CompletedTask; });
        Assert.True(retried);
        Assert.Equal("1", await File.ReadAllTextAsync(Path.Combine(_root, "kill-switch.completed")));
    }

    [Fact]
    public async Task WaitsForOldProcessToCloseControllersBeforeClearingEngine()
    {
        using var instance = await _service.RegisterInstanceAsync(0);
        await _service.RequestAsync();
        var engine = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleanup = _service.CompletePendingAsync(_ => { engine.SetResult(); return Task.CompletedTask; });
        Assert.False(engine.Task.IsCompleted);
        instance.Dispose();
        await cleanup.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(engine.Task.IsCompleted);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _service.RegisterInstanceAsync(0));
        using var newInstance = await _service.RegisterInstanceAsync(1);
    }

    [Fact]
    public async Task ConcurrentRequestsAreMonotonicAndCleanupIsIdempotent()
    {
        var other = new KillSwitchService(new(_root));
        var requests = await Task.WhenAll(Task.Run(() => _service.RequestAsync()), Task.Run(() => other.RequestAsync()));
        Assert.Equal(new long[] { 1, 2 }, requests.OrderBy(x => x));
        var calls = 0;
        await Task.WhenAll(Task.Run(() => _service.CompletePendingAsync(_ => { Interlocked.Increment(ref calls); return Task.CompletedTask; })),
            Task.Run(() => other.CompletePendingAsync(_ => { Interlocked.Increment(ref calls); return Task.CompletedTask; })));
        Assert.Equal(1, calls); Assert.Equal(2, _service.ReadRequest());
    }

    [Fact]
    public async Task MalformedRequestFailsWithoutDeletingHistory()
    {
        var history = await SeedAsync(_paths.DatabasePath);
        await File.WriteAllTextAsync(Path.Combine(_root, "kill-switch.request"), new string('9', 100));
        await Assert.ThrowsAsync<InvalidDataException>(() => _service.CompletePendingAsync(_ => Task.CompletedTask));
        Assert.Single(await history.SearchAsync());
    }

    [Fact]
    public async Task NewBrowsingCannotStartWhileEngineCleanupIsPending()
    {
        await _service.RequestAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _service.RegisterInstanceAsync(1));
        await _service.CompletePendingAsync(_ => Task.CompletedTask);
        using var instance = await _service.RegisterInstanceAsync(1);
    }
}
