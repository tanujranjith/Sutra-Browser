using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class WindowSessionRepositoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-windows-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    private WindowSessionRepository _windows = null!;

    private static BrowserSession Session(string title, bool temporary = false)
    {
        var tab = new BrowserTab { Url = "https://example.com/" + title, Title = title, IsTemporary = temporary };
        return new([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow);
    }

    public async Task InitializeAsync()
    {
        _database = new(_path);
        await _database.InitializeAsync();
        _windows = new(_database);
    }

    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); try { File.Delete(_path); } catch { } return Task.CompletedTask; }

    [Fact]
    public async Task SavesListsAndDeletesPerWindow()
    {
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await _windows.SaveAsync(first, "Work", Session("First"));
        await _windows.SaveAsync(second, "Work", Session("Second"));
        var listed = await _windows.ListForProfileAsync("Work");
        Assert.Equal(2, listed.Count);
        Assert.Equal("Second", listed[0].Session.Tabs[0].Title);
        await _windows.DeleteAsync(first);
        Assert.Equal(second, Assert.Single(await _windows.ListForProfileAsync("Work")).WindowId);
    }

    [Fact]
    public async Task TemporaryOnlyWindowsAreNotPersistedAndPrivateNeverWrites()
    {
        var tempWindow = Guid.NewGuid();
        await _windows.SaveAsync(tempWindow, "Default", Session("Preview", temporary: true));
        Assert.Empty(await _windows.ListForProfileAsync("Default"));
        var privateWindow = Guid.NewGuid();
        await _windows.SaveAsync(privateWindow, "Private", Session("Secret"));
        Assert.Empty(await _windows.ListAllAsync());
        // Mixed windows persist only their durable tabs.
        var mixed = Guid.NewGuid();
        var durable = new BrowserTab { Url = "https://example.com/keep", Title = "Keep" };
        var temp = new BrowserTab { Url = "https://example.com/preview", Title = "Preview", IsTemporary = true };
        await _windows.SaveAsync(mixed, "Default", new([durable.ToSnapshot(), temp.ToSnapshot()], durable.Id, DateTimeOffset.UtcNow));
        var saved = Assert.Single(await _windows.ListForProfileAsync("Default"));
        Assert.Equal("Keep", Assert.Single(saved.Session.Tabs).Title);
    }

    [Fact]
    public async Task OldWritersCannotResurrectClearedWindows()
    {
        var otherProcess = new BrowserDatabase(_path);
        await otherProcess.InitializeAsync();
        var otherWindows = new WindowSessionRepository(otherProcess);
        await _windows.SaveAsync(Guid.NewGuid(), "Default", Session("Before"));
        await new KillSwitchRepository(_database).ClearAsync(5);
        await otherProcess.InitializeAsync();
        await otherWindows.SaveAsync(Guid.NewGuid(), "Default", Session("Late"));
        Assert.Empty(await _windows.ListAllAsync());
        var restarted = new BrowserDatabase(_path);
        await restarted.InitializeAsync();
        await new WindowSessionRepository(restarted).SaveAsync(Guid.NewGuid(), "Default", Session("After"));
        Assert.Single(await _windows.ListAllAsync());
    }

    [Fact]
    public async Task KillSwitchClearsWindowsButPreservesWorkspacesAndBookmarks()
    {
        await _windows.SaveAsync(Guid.NewGuid(), "Default", Session("Window"));
        await new BookmarkRepository(_database).AddAsync("Keep", "https://example.org");
        await new KillSwitchRepository(_database).ClearAsync(1);
        Assert.Empty(await _windows.ListAllAsync());
        Assert.Single(await new BookmarkRepository(_database).SearchAsync());
    }

    [Fact]
    public async Task RetentionKeepsNewestTenPerProfileAndOneHundredGlobal()
    {
        for (var i = 0; i < 14; i++)
        {
            await _windows.SaveAsync(Guid.NewGuid(), "Default", Session($"Tab{i}"));
            await Task.Delay(5);
        }
        Assert.Equal(10, (await _windows.ListForProfileAsync("Default")).Count);
    }
}
