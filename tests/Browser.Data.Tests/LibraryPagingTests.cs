using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class LibraryPagingTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-paging-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;

    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); try { File.Delete(_path); } catch { } return Task.CompletedTask; }

    [Fact]
    public void FtsQueryBuildsSafePrefixQueries()
    {
        Assert.Null(FtsQuery.Build(""));
        Assert.Null(FtsQuery.Build("a"));
        Assert.Null(FtsQuery.Build("!!!"));
        Assert.Equal("\"example\"*", FtsQuery.Build("Example!"));
        Assert.Contains("AND", FtsQuery.Build("alpha beta gamma delta epsilon zeta eta")!);
    }

    [Fact]
    public async Task HistoryPagesWithFtsAndLiteralWildcards()
    {
        var history = new HistoryRepository(_database);
        for (var i = 0; i < 60; i++)
            await history.RecordVisitAsync($"https://example.com/article-{i:D3}", $"Article {i:D3} guide");
        var first = await history.SearchPagedAsync("article guide", null, null, 0, 50);
        var second = await history.SearchPagedAsync("article guide", null, null, 50, 50);
        Assert.Equal(50, first.Count);
        Assert.Equal(10, second.Count);
        Assert.Empty(await history.SearchPagedAsync("article guide", null, null, 60, 50));
        // LIKE wildcards in the query must not broaden the match.
        await history.RecordVisitAsync("https://example.com/100%-coverage", "100% coverage");
        Assert.Single(await history.SearchPagedAsync("100% coverage", null, null, 0, 50));
        Assert.Empty(await history.SearchPagedAsync("100_ coverage", null, null, 0, 50));
    }

    [Fact]
    public async Task BookmarksPageAndEscapeWildcards()
    {
        var bookmarks = new BookmarkRepository(_database);
        for (var i = 0; i < 55; i++)
            await bookmarks.AddAsync($"Doc {i:D3}", $"https://example.com/doc-{i:D3}");
        Assert.Equal(50, (await bookmarks.SearchPagedAsync("doc", 0, 50)).Count);
        Assert.Equal(5, (await bookmarks.SearchPagedAsync("doc", 50, 50)).Count);
        await bookmarks.AddAsync("100% real", "https://example.com/percent");
        Assert.Single(await bookmarks.SearchPagedAsync("100% real", 0, 50));
    }

    [Fact]
    public async Task NotesAndArticlesPage()
    {
        var notes = new PageNoteRepository(_database);
        for (var i = 0; i < 55; i++)
            await notes.AddAsync($"https://example.com/note-{i:D3}", "quote", $"research note {i:D3}");
        Assert.Equal(50, (await notes.SearchPagedAsync("research note", 0, 50)).Count);
        Assert.Equal(5, (await notes.SearchPagedAsync("research note", 50, 50)).Count);

        var articles = new OfflineArticleRepository(_database);
        for (var i = 0; i < 55; i++)
            await articles.SaveAsync($"Guide {i:D3}", $"https://example.com/guide-{i:D3}", $"offline body text {i:D3} with enough content to pass validation");
        Assert.Equal(50, (await articles.SearchPagedAsync("offline body", 0, 50)).Count);
        Assert.Equal(5, (await articles.SearchPagedAsync("offline body", 50, 50)).Count);
    }

    [Fact]
    public async Task KillSwitchClearsBaseAndFtsTogether()
    {
        var history = new HistoryRepository(_database);
        await history.RecordVisitAsync("https://example.com/secret", "Secret guide");
        Assert.Single(await history.SearchPagedAsync("secret guide", null, null, 0, 50));
        await new KillSwitchRepository(_database).ClearAsync(1);
        Assert.Empty(await history.SearchPagedAsync("secret guide", null, null, 0, 50));
        Assert.Empty(await history.SearchPagedAsync("", null, null, 0, 50));
    }
}
