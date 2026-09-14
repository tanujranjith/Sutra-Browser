using Browser.Core.Reading;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class OfflineArticleRepositoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-offline-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    private OfflineArticleRepository _articles = null!;
    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); _articles = new(_database); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task SavesInertTextAndFindsBodyWithLiteralWildcards()
    {
        await _articles.SaveAsync("Guide", "https://example.com/guide#part", "<script>untrusted</script> 100% complete");
        var saved = Assert.Single(await _articles.SearchAsync("100%"));
        Assert.Equal("https://example.com/guide", saved.Url);
        Assert.Contains("<script>", (await _articles.GetAsync(saved.Id))!.Text);
        Assert.Empty(await _articles.SearchAsync("100_"));
        await _articles.DeleteAsync(saved.Id);
        Assert.Null(await _articles.GetAsync(saved.Id));
    }

    [Fact]
    public async Task ResavingSameUrlUpdatesArticleWithoutDuplicates()
    {
        await _articles.SaveAsync("Old", "https://example.com/a#one", "old text");
        var original = Assert.Single(await _articles.SearchAsync());
        await _articles.SaveAsync("New", "https://example.com/a#two", "new text");
        var updated = Assert.Single(await _articles.SearchAsync());
        Assert.Equal(original.Id, updated.Id);
        Assert.Equal("new text", (await _articles.GetAsync(updated.Id))!.Text);
    }

    [Fact]
    public async Task UpgradePreservesDormantArchivesAndExistingBrowserData()
    {
        // Recreate the actual released v4 layout and migration ledger before upgrading.
        await using (var connection = _database.OpenConnection())
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "DROP TABLE IF EXISTS history_fts; DROP TABLE IF EXISTS bookmarks_fts; DROP TABLE IF EXISTS page_notes_fts; DROP TABLE IF EXISTS offline_articles_fts; DROP TRIGGER IF EXISTS history_ai; DROP TRIGGER IF EXISTS history_ad; DROP TRIGGER IF EXISTS history_au; DROP TRIGGER IF EXISTS bookmarks_ai; DROP TRIGGER IF EXISTS bookmarks_ad; DROP TRIGGER IF EXISTS bookmarks_au; DROP TRIGGER IF EXISTS page_notes_ai; DROP TRIGGER IF EXISTS page_notes_ad; DROP TRIGGER IF EXISTS page_notes_au; DROP TRIGGER IF EXISTS offline_articles_ai; DROP TRIGGER IF EXISTS offline_articles_ad; DROP TRIGGER IF EXISTS offline_articles_au; DROP TABLE IF EXISTS window_sessions; DROP TABLE privacy_state; DROP TABLE workspace_versions; ALTER TABLE workspaces DROP COLUMN color; ALTER TABLE workspaces DROP COLUMN icon; ALTER TABLE workspaces DROP COLUMN is_template; DROP INDEX ix_downloads_started;";
            await command.ExecuteNonQueryAsync();
            command.CommandText = "DROP TABLE IF EXISTS window_sessions; DROP TABLE session_snapshots; DROP INDEX ix_offline_articles_saved; ALTER TABLE offline_articles DROP COLUMN content_text; DELETE FROM schema_migrations WHERE version>4; INSERT INTO offline_articles(title,url,archive_path,saved_at) VALUES('Legacy','https://example.com/legacy','legacy.mhtml','2026-01-01T00:00:00.0000000+00:00');";
            await command.ExecuteNonQueryAsync();
        }
        var bookmarks = new BookmarkRepository(_database);
        await bookmarks.AddAsync("Keep", "https://example.com");
        await _database.InitializeAsync();
        await _articles.SaveAsync("Article", "https://example.com/a", "read this offline");
        await _database.InitializeAsync();
        Assert.Single(await bookmarks.SearchAsync());
        Assert.Single(await _articles.SearchAsync());
        await using var reopened = _database.OpenConnection(); await reopened.OpenAsync();
        await using var check = reopened.CreateCommand();
        check.CommandText = "SELECT archive_path FROM offline_articles WHERE title='Legacy'";
        Assert.Equal("legacy.mhtml", await check.ExecuteScalarAsync());
    }

    [Fact]
    public async Task LibraryQuotaRejectsNewArticleButAllowsReplacingExistingOne()
    {
        await using var connection = _database.OpenConnection(); await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<500)
            INSERT INTO offline_articles(title,url,archive_path,saved_at,content_text)
            SELECT 'Article','https://example.com/'||i,'','2026-01-01T00:00:00.0000000+00:00','text' FROM n;
            """;
        await command.ExecuteNonQueryAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => _articles.SaveAsync("Extra", "https://example.com/extra", "new"));
        await _articles.SaveAsync("Updated", "https://example.com/1", "replacement");
        var total = (await _articles.SearchPagedAsync("", 0, 200)).Count
            + (await _articles.SearchPagedAsync("", 200, 200)).Count
            + (await _articles.SearchPagedAsync("", 400, 200)).Count;
        Assert.Equal(OfflineArticlePolicy.MaximumArticles, total);
    }
}
