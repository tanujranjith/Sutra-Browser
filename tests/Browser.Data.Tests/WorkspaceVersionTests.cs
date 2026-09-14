using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class WorkspaceVersionTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-workspace-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    private static string Session(string title) { var tab = new BrowserTab { Title = title, Url = "https://example.com" }; return SessionSerializer.Serialize(new([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow)); }
    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task DeletedWorkspaceCanBeRecoveredAfterReopeningWithMetadata()
    {
        var repo = new WorkspaceRepository(_database);
        await repo.SaveAsync("Research", Session("Original"));
        var original = Assert.Single(await repo.ListAsync());
        await repo.UpdateDetailsAsync(original.Id, "Study", "#3977CF", "Study", true);
        await repo.SaveAsync("Study", Session("Changed"));
        await repo.DeleteAsync(original.Id);
        Assert.Empty(await repo.ListAsync());
        var reopened = new WorkspaceRepository(new BrowserDatabase(_path));
        var versions = await reopened.VersionsAsync(original.Id);
        Assert.Equal(3, versions.Count);
        await reopened.RestoreCopyAsync(versions[0].Id, "Recovered");
        var recovered = Assert.Single(await reopened.ListAsync());
        Assert.True(recovered.IsTemplate); Assert.Equal("#3977CF", recovered.Color); Assert.Equal("Study", recovered.Icon);
        Assert.Contains("Changed", recovered.SessionJson); Assert.NotEqual(original.Id, recovered.Id);
        await Assert.ThrowsAsync<SqliteException>(() => reopened.RestoreCopyAsync(versions[0].Id, "Recovered"));
        Assert.Single(await reopened.ListAsync());
    }

    [Fact]
    public async Task ConflictingRenameRollsBackVersionAndContentTogether()
    {
        var repo = new WorkspaceRepository(_database);
        await repo.SaveAsync("One", Session("One")); await repo.SaveAsync("Two", Session("Two"));
        var one = (await repo.ListAsync()).Single(x => x.Name == "One");
        await Assert.ThrowsAsync<SqliteException>(() => repo.UpdateDetailsAsync(one.Id, "Two", "#3977CF", "Study", true));
        Assert.Empty(await repo.VersionsAsync()); Assert.Contains(await repo.ListAsync(), x => x.Name == "One" && !x.IsTemplate);
        await Assert.ThrowsAsync<ArgumentException>(() => repo.SaveAsync("Invalid", "{\"tabs\":[1]}"));
    }

    [Fact]
    public async Task VersionRetentionKeepsLatestTwentyPerWorkspace()
    {
        var repo = new WorkspaceRepository(_database);
        for (var i = 0; i < 26; i++) await repo.SaveAsync("One", Session($"Revision {i}"));
        var versions = await repo.VersionsAsync();
        Assert.Equal(20, versions.Count); Assert.Contains("Revision 24", versions[0].SessionJson); Assert.Contains("Revision 5", versions[^1].SessionJson);
    }

    [Fact]
    public async Task GlobalVersionRetentionRemainsBoundedAcrossWorkspaces()
    {
        var repo = new WorkspaceRepository(_database);
        for (var workspace = 0; workspace < 11; workspace++)
            for (var revision = 0; revision < 21; revision++) await repo.SaveAsync($"Workspace {workspace}", Session($"Revision {revision}"));
        var versions = await repo.VersionsAsync(); Assert.Equal(200, versions.Count);
        Assert.All(versions.GroupBy(x => x.WorkspaceId), group => Assert.InRange(group.Count(), 1, 20));
        Assert.Equal(11, (await repo.ListAsync()).Count);
    }

    [Fact]
    public async Task VersionSevenUpgradePreservesExistingWorkspaceContent()
    {
        await using (var connection = _database.OpenConnection())
        {
            await connection.OpenAsync(); await using var command = connection.CreateCommand();
            command.CommandText = "DROP TABLE IF EXISTS history_fts; DROP TABLE IF EXISTS bookmarks_fts; DROP TABLE IF EXISTS page_notes_fts; DROP TABLE IF EXISTS offline_articles_fts; DROP TRIGGER IF EXISTS history_ai; DROP TRIGGER IF EXISTS history_ad; DROP TRIGGER IF EXISTS history_au; DROP TRIGGER IF EXISTS bookmarks_ai; DROP TRIGGER IF EXISTS bookmarks_ad; DROP TRIGGER IF EXISTS bookmarks_au; DROP TRIGGER IF EXISTS page_notes_ai; DROP TRIGGER IF EXISTS page_notes_ad; DROP TRIGGER IF EXISTS page_notes_au; DROP TRIGGER IF EXISTS offline_articles_ai; DROP TRIGGER IF EXISTS offline_articles_ad; DROP TRIGGER IF EXISTS offline_articles_au; DROP TABLE IF EXISTS window_sessions; DROP TABLE privacy_state; DROP TABLE workspace_versions; ALTER TABLE workspaces DROP COLUMN color; ALTER TABLE workspaces DROP COLUMN icon; ALTER TABLE workspaces DROP COLUMN is_template; DROP INDEX ix_downloads_started; DELETE FROM schema_migrations WHERE version>=7; INSERT INTO workspaces(name,session_json,updated_at) VALUES('Legacy',$session,$at);";
            command.Parameters.AddWithValue("$session", Session("Existing tabs")); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O")); await command.ExecuteNonQueryAsync();
        }
        await _database.InitializeAsync(); await _database.InitializeAsync();
        var repo = new WorkspaceRepository(_database); var item = Assert.Single(await repo.ListAsync());
        Assert.Equal("Legacy", item.Name); Assert.Contains("Existing tabs", item.SessionJson);
        Assert.False(item.IsTemplate); Assert.Equal("Folder", item.Icon); Assert.Equal("#F47A22", item.Color); Assert.Empty(await repo.VersionsAsync());
    }
}
