using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class BookmarkLookupTests
{
    [Fact]
    public async Task ExactLookupFindsBookmarksBeyondFirstPageAndUsesTheUrlIndex()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sutra-bookmark-lookup-{Guid.NewGuid():N}.db");
        try
        {
            var database = new BrowserDatabase(path); await database.InitializeAsync(); var repository = new BookmarkRepository(database);
            for (var i = 0; i < 205; i++) await repository.AddAsync($"Saved {i}", $"https://example.com/page/{i}");
            var id = await repository.AddAsync("Target", "https://example.com/Case?q=1#part");
            Assert.DoesNotContain(await repository.SearchAsync(), item => item.Id == id);
            Assert.Equal(id, (await repository.FindByUrlAsync("https://example.com/Case?q=1#part"))?.Id);
            Assert.Null(await repository.FindByUrlAsync("https://example.com/case?q=1#part"));
            Assert.Null(await repository.FindByUrlAsync("https://example.com/Case?q=2#part"));
            await using var connection = database.OpenConnection(); await connection.OpenAsync(); await using var command = connection.CreateCommand();
            command.CommandText = "EXPLAIN QUERY PLAN SELECT id FROM bookmarks WHERE url=$url ORDER BY id LIMIT 1";
            command.Parameters.AddWithValue("$url", "https://example.com/Case?q=1#part");
            await using var reader = await command.ExecuteReaderAsync(); var details = new List<string>();
            while (await reader.ReadAsync()) details.Add(reader.GetString(3));
            Assert.Contains(details, detail => detail.Contains("ix_bookmarks_url", StringComparison.Ordinal));
        }
        finally { SqliteConnection.ClearAllPools(); File.Delete(path); }
    }
}
