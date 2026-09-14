using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class KillSwitchRepositoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-kill-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    private static BrowserSession Session()
    {
        var tab = new BrowserTab { Url = "https://example.com/search?q=private", Title = "Search" };
        return new([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow);
    }
    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task ClearsHistoryAndAutomaticRecoveryButPreservesExplicitArtifacts()
    {
        var state = new AppStateRepository(_database);
        await new HistoryRepository(_database).RecordVisitAsync("https://example.com/search", "Search", "typed secret query");
        await new SessionRepository(state).SaveAsync(Session());
        await state.SetAsync("browser.cleanShutdown", "false");
        await state.SetAsync("browser.startupRecovery", "pending");
        await state.SetAsync("browser.settings", "keep settings");
        await new SessionSnapshotRepository(_database).SaveAsync(Guid.NewGuid(), "Default", Session());
        await new WindowSessionRepository(_database).SaveAsync(Guid.NewGuid(), "Default", Session());
        await new BookmarkRepository(_database).AddAsync("Keep bookmark", "https://example.org");
        await new WorkspaceRepository(_database).SaveAsync("Keep workspace", SessionSerializer.Serialize(Session()));
        await new OfflineArticleRepository(_database).SaveAsync("Keep article", "https://example.net", "Saved text");
        await ExecuteAsync("""
            INSERT INTO recently_closed_tabs(snapshot_json,closed_at) VALUES('secret','now');
            INSERT INTO password_metadata(id,origin,username,created_at,updated_at) VALUES('saved','https://example.com','user','now','now');
            INSERT INTO downloads(id,file_name,source_url,destination,started_at,state) VALUES('saved','file','https://example.com','keep-file','now','Completed');
            """);

        await new KillSwitchRepository(_database).ClearAsync(1);

        Assert.Empty(await new HistoryRepository(_database).SearchAsync());
        Assert.Null(await state.GetAsync("browser.session"));
        Assert.Null(await state.GetAsync("browser.cleanShutdown"));
        Assert.Null(await state.GetAsync("browser.startupRecovery"));
        Assert.Empty(await new SessionSnapshotRepository(_database).ListAsync());
        Assert.Empty(await new WindowSessionRepository(_database).ListAllAsync());
        Assert.Equal(0, await CountAsync("recently_closed_tabs"));
        Assert.Equal("keep settings", await state.GetAsync("browser.settings"));
        foreach (var table in new[] { "bookmarks", "workspaces", "offline_articles", "password_metadata", "downloads" })
            Assert.Equal(1, await CountAsync(table));
    }

    [Fact]
    public async Task OldProcessesCannotResurrectHistoryOrRecoveryAfterClear()
    {
        var otherProcess = new BrowserDatabase(_path); await otherProcess.InitializeAsync();
        await new KillSwitchRepository(_database).ClearAsync(5);
        // Reinitialization cannot silently refresh the epoch of an old writer.
        await otherProcess.InitializeAsync();
        await new HistoryRepository(otherProcess).RecordVisitAsync("https://example.com/late", "Late save", "late query");
        await new SessionRepository(new(otherProcess)).SaveAsync(Session());
        await new AppStateRepository(otherProcess).SetAsync("browser.cleanShutdown", "false");
        await new SessionSnapshotRepository(otherProcess).SaveAsync(Guid.NewGuid(), "Work", Session());
        await new WindowSessionRepository(otherProcess).SaveAsync(Guid.NewGuid(), "Default", Session());
        Assert.Equal(0, await CountAsync("history"));
        Assert.Equal(0, await CountAsync("session_snapshots"));
        Assert.Equal(0, await CountAsync("window_sessions"));
        Assert.Null(await new AppStateRepository(otherProcess).GetAsync("browser.session"));
        Assert.Null(await new AppStateRepository(otherProcess).GetAsync("browser.cleanShutdown"));
    }

    [Fact]
    public async Task RestartCanSaveAndRepeatedOrOlderRequestsDoNotClearNewBrowsing()
    {
        var cleanup = new KillSwitchRepository(_database);
        await cleanup.ClearAsync(7);
        var restarted = new BrowserDatabase(_path); await restarted.InitializeAsync();
        await new HistoryRepository(restarted).RecordVisitAsync("https://example.com/new", "New browsing");
        await new SessionRepository(new(restarted)).SaveAsync(Session());
        await cleanup.ClearAsync(7); await cleanup.ClearAsync(6);
        Assert.Equal(1, await CountAsync("history"));
        Assert.NotNull(await new AppStateRepository(restarted).GetAsync("browser.session"));
        await cleanup.ClearAsync(8);
        Assert.Equal(0, await CountAsync("history"));
    }

    [Fact]
    public async Task ClearWaitsForEarlierWriterAndRemovesItsCommittedRecords()
    {
        await using var connection = _database.OpenConnection(); await connection.OpenAsync();
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT INTO history(url,title,domain,last_visited_at,typed_query) VALUES('https://example.com','late','example.com','now','queued query')";
        await command.ExecuteNonQueryAsync();
        var attempted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var clear = Task.Run(async () => { attempted.SetResult(); await new KillSwitchRepository(_database).ClearAsync(1); });
        await attempted.Task;
        await transaction.CommitAsync();
        await clear.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(0, await CountAsync("history"));
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = _database.OpenConnection(); await connection.OpenAsync();
        await using var command = connection.CreateCommand(); command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
    private async Task<long> CountAsync(string table)
    {
        await using var connection = _database.OpenConnection(); await connection.OpenAsync();
        await using var command = connection.CreateCommand(); command.CommandText = $"SELECT COUNT(*) FROM {table}";
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }
}
