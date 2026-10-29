using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class BookmarkMaintenanceTests
{
    [Fact]
    public async Task ReviewedDeletionKeepsLastCopyRechecksChangesAndUndoPreservesMetadata()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sutra-maintenance-{Guid.NewGuid():N}.db");
        try
        {
            var database = new BrowserDatabase(path); await database.InitializeAsync();
            var repository = new BookmarkRepository(database); var folder = await repository.AddFolderAsync("Research");
            var first = await repository.AddAsync("First", "https://example.com/Page", folder);
            var second = await repository.AddAsync("Second", "https://example.com/Page", folder);
            var changed = await repository.AddAsync("Changed", "https://example.com/Page", folder);
            var reviewed = await repository.SearchAsync();
            await repository.UpdateAsync(changed, "Edited after review", "https://example.com/Other", folder, 2);
            var removed = await repository.DeleteReviewedDuplicatesAsync(reviewed);
            Assert.Single(removed); Assert.Equal(first, removed[0].Id);
            Assert.Equal(new[] { second, changed }, (await repository.SearchAsync()).Select(item => item.Id));
            Assert.Equal(1, await repository.RestoreRemovedAsync(removed));
            Assert.Equal(0, await repository.RestoreRemovedAsync(removed));
            Assert.Equal(reviewed.Single(item => item.Id == first), (await repository.SearchAsync()).Single(item => item.Id == first));
            Assert.Equal("Edited after review", (await repository.SearchAsync()).Single(item => item.Id == changed).Title);
        }
        finally { SqliteConnection.ClearAllPools(); File.Delete(path); }
    }

    [Fact]
    public async Task DeletedFolderDoesNotPreventUndoAndOtherFoldersAreNotDuplicates()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sutra-maintenance-{Guid.NewGuid():N}.db");
        try
        {
            var database = new BrowserDatabase(path); await database.InitializeAsync(); var repository = new BookmarkRepository(database);
            var folder = await repository.AddFolderAsync("Research");
            var root = await repository.AddAsync("Root", "https://example.com/");
            var nested = await repository.AddAsync("Nested", "https://example.com/", folder);
            Assert.Empty(await repository.DeleteReviewedDuplicatesAsync(await repository.SearchAsync()));
            var copy = await repository.AddAsync("Copy", "https://example.com/", folder);
            var removed = await repository.DeleteReviewedDuplicatesAsync((await repository.SearchAsync()).Where(item => item.Id == copy));
            Assert.Single(removed); await repository.DeleteFolderAsync(folder);
            Assert.Equal(1, await repository.RestoreRemovedAsync(removed));
            Assert.Null((await repository.SearchAsync()).Single(item => item.Id == copy).FolderId);
            Assert.Equal(3, (await repository.SearchAsync()).Count);
        }
        finally { SqliteConnection.ClearAllPools(); File.Delete(path); }
    }
}
