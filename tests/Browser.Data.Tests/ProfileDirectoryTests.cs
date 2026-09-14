using Browser.Core.Settings;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class ProfileDirectoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-profiles-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    public async Task InitializeAsync() { _database = new(_path); await _database.InitializeAsync(); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task NewProfilesSurviveStaleSettingsAndDirectoryReopening()
    {
        var state = new AppStateRepository(_database);
        var settings = new SettingsRepository(state);
        var old = new BrowserSettings { WebProfiles = ["Default", "Work"] };
        await settings.SaveAsync(old);
        var directory = new ProfileDirectoryRepository(_database);
        Assert.Equal(new[] { "Default", "Work" }, await directory.ListAsync());
        Assert.Null(await state.GetAsync("browser.profileDirectory")); // Read-only/private inspection does not migrate.
        await directory.AddAsync("Research");
        await settings.SaveAsync(old);
        var reopened = new ProfileDirectoryRepository(_database);
        Assert.Equal(new[] { "Default", "Work", "Research" }, await reopened.ListAsync());
        Assert.Equal(3, (await reopened.AddAsync("research")).Count);
        await Assert.ThrowsAsync<ArgumentException>(() => reopened.AddAsync("../escape"));
    }
}
