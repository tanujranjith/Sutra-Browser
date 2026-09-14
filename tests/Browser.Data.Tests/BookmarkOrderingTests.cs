using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class BookmarkOrderingTests
{
    [Fact]
    public async Task MovesRootBookmarksWithoutChangingFolderContents()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sutra-order-{Guid.NewGuid():N}.db");
        try
        {
            var database = new BrowserDatabase(path); await database.InitializeAsync();
            var bookmarks = new BookmarkRepository(database);
            var first = await bookmarks.AddAsync("One", "https://one.example");
            var second = await bookmarks.AddAsync("Two", "https://two.example");
            var third = await bookmarks.AddAsync("Three", "https://three.example");
            var folder = await bookmarks.AddFolderAsync("Research");
            var nested = await bookmarks.AddAsync("Nested", "https://nested.example", folder);
            await bookmarks.MoveBeforeAsync(third, first);
            Assert.Equal(new[] { third, first, second }, (await bookmarks.SearchAsync()).Where(x => x.FolderId is null).Select(x => x.Id));
            await bookmarks.MoveBeforeAsync(nested, first);
            Assert.Equal(folder, (await bookmarks.SearchAsync()).Single(x => x.Id == nested).FolderId);
            var anotherFolder = await bookmarks.AddFolderAsync("Another");
            await bookmarks.MoveBeforeAsync(anotherFolder, folder, true);
            Assert.Equal(new[] { anotherFolder, folder }, (await bookmarks.ListFoldersAsync()).Select(x => x.Id));
        }
        finally { SqliteConnection.ClearAllPools(); File.Delete(path); }
    }
}
