using Browser.Data;
using Browser.Data.Repositories;
using Xunit;

namespace Browser.Data.Tests;

public sealed class RepositoryTests : IAsyncLifetime
{
    private readonly string _path=Path.Combine(Path.GetTempPath(),$"sutra-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database=null!;
    public async Task InitializeAsync(){_database=new(_path);await _database.InitializeAsync();}
    public Task DisposeAsync(){Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();if(File.Exists(_path))File.Delete(_path);return Task.CompletedTask;}

    [Fact]
    public async Task MigrationsApplyExactlyOnce()
    {
        await _database.InitializeAsync();await using var c=_database.OpenConnection();await c.OpenAsync();await using var cmd=c.CreateCommand();cmd.CommandText="SELECT COUNT(*) FROM schema_migrations";Assert.Equal(Migrations.All.Count,Convert.ToInt32(await cmd.ExecuteScalarAsync()));
    }

    [Fact]
    public async Task HistoryUpsertsVisitCountAndSearchesQuery()
    {
        var repo=new HistoryRepository(_database);await repo.RecordVisitAsync("https://example.com/a","First","weather");await repo.RecordVisitAsync("https://example.com/a","Renamed");
        var results=await repo.SearchAsync("weather");var item=Assert.Single(results);Assert.Equal(2,item.VisitCount);Assert.Equal("Renamed",item.Title);
        await repo.DeleteDomainAsync("example.com");Assert.Empty(await repo.SearchAsync());
    }

    [Fact]
    public async Task HistoryDoesNotPersistCredentialBearingUrls()
    {
        var repo = new HistoryRepository(_database);
        await repo.RecordVisitAsync("https://user:password@example.com/private", "Private");
        Assert.Empty(await repo.SearchAsync());
    }

    [Fact]
    public async Task BookmarkCrudAndFoldersWork()
    {
        var repo=new BookmarkRepository(_database);var folder=await repo.AddFolderAsync("Reading");var child=await repo.AddFolderAsync("Articles",folder);var listed=await repo.ListFoldersAsync();Assert.Contains(listed, x => x.Id == child && x.ParentId == folder);
        var id=await repo.AddAsync("Example","https://example.com",child);
        var item=Assert.Single(await repo.SearchAsync("Example"));Assert.Equal(child,item.FolderId);
        await repo.UpdateAsync(id,"Updated","https://example.org",null,4);Assert.Equal("Updated",Assert.Single(await repo.SearchAsync()).Title);
        await repo.DeleteAsync(id);Assert.Empty(await repo.SearchAsync());
    }

    [Fact]
    public async Task BookmarkClearAllRemovesBookmarksAndFolders()
    {
        var repo = new BookmarkRepository(_database);
        var parent = await repo.AddFolderAsync("Parent");
        var child = await repo.AddFolderAsync("Child", parent);
        await repo.AddAsync("Example", "https://example.com", child);
        await repo.DeleteAllAsync();
        Assert.Empty(await repo.SearchAsync());
        Assert.Empty(await repo.ListFoldersAsync());
    }

    [Fact]
    public async Task WorkspacesReplaceByNameAndDelete()
    {
        var repo=new WorkspaceRepository(_database);
        await repo.SaveAsync("Research","{\"tabs\":[1]}");
        await repo.SaveAsync("Research","{\"tabs\":[2]}");
        var item=Assert.Single(await repo.ListAsync());Assert.Contains("[2]",item.SessionJson);
        await repo.DeleteAsync(item.Id);Assert.Empty(await repo.ListAsync());
    }

    [Fact]
    public async Task ReadingListTracksReadStateAndRejectsUnsafeUrls()
    {
        var repo=new ReadingListRepository(_database);
        await repo.AddAsync("Example","https://example.com/article");
        var item=Assert.Single(await repo.SearchAsync("article"));Assert.False(item.IsRead);
        await repo.SetReadAsync(item.Id,true);Assert.True(Assert.Single(await repo.SearchAsync()).IsRead);
        await Assert.ThrowsAsync<ArgumentException>(()=>repo.AddAsync("Bad","javascript:alert(1)"));
        await repo.DeleteAsync(item.Id);Assert.Empty(await repo.SearchAsync());
    }
}
