using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class DownloadPagingAndRetentionTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-paging-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task DownloadPagesAreStableDisjointAndSearchWildcardsLiterally()
    {
        var repo = new DownloadRepository(_database); var at = DateTimeOffset.UtcNow;
        for (var i = 0; i < 110; i++) await repo.UpsertAsync(new(Guid.NewGuid(), $"100% report {i}.pdf", "https://example.com/file", $"C:/Downloads/{i}.pdf", at, i % 2 == 0 ? "Completed" : "Interrupted", 10, 10, null));
        var first = await repo.SearchAsync(limit: 50); var second = await repo.SearchAsync(offset: 50, limit: 50);
        Assert.Equal(50, first.Count); Assert.Equal(50, second.Count); Assert.Empty(first.Select(x => x.Id).Intersect(second.Select(x => x.Id)));
        Assert.Equal(first.Select(x => x.Id), (await repo.SearchAsync(limit: 50)).Select(x => x.Id));
        Assert.Empty(await repo.SearchAsync("100_"));
        Assert.Equal(55, (await repo.SearchAsync("100%", "Completed", limit: 100)).Count);
        Assert.Equal(10, (await repo.SearchAsync(offset: 100)).Count);
    }

    [Fact]
    public async Task RetentionDeletesOnlyOlderHistoryAndKeepsCutoffAndBookmarks()
    {
        var history = new HistoryRepository(_database); var bookmarks = new BookmarkRepository(_database);
        await history.RecordVisitAsync("https://example.com/old", "Old"); await history.RecordVisitAsync("https://example.com/boundary", "Boundary");
        await history.RecordVisitAsync("https://example.com/recent", "Recent"); await bookmarks.AddAsync("Keep", "https://example.com/old");
        var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
        await using (var connection = _database.OpenConnection())
        {
            await connection.OpenAsync(); await using var command = connection.CreateCommand();
            command.CommandText = "UPDATE history SET last_visited_at=$old WHERE title='Old'; UPDATE history SET last_visited_at=$cutoff WHERE title='Boundary';";
            command.Parameters.AddWithValue("$old", cutoff.AddSeconds(-1).ToString("O")); command.Parameters.AddWithValue("$cutoff", cutoff.ToString("O")); await command.ExecuteNonQueryAsync();
        }
        await history.DeleteOlderThanAsync(cutoff);
        var remaining = await history.SearchAsync(); Assert.Equal(2, remaining.Count); Assert.DoesNotContain(remaining, x => x.Title == "Old"); Assert.Single(await bookmarks.SearchAsync());
    }
}
