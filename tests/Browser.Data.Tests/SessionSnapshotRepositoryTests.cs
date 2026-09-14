using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class SessionSnapshotRepositoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-recovery-{Guid.NewGuid():N}.db");
    private SessionSnapshotRepository _snapshots = null!;
    public async Task InitializeAsync() { var database = new BrowserDatabase(_path); await database.InitializeAsync(); _snapshots = new(database); }
    public Task DisposeAsync() { SqliteConnection.ClearAllPools(); File.Delete(_path); return Task.CompletedTask; }

    [Fact]
    public async Task DeduplicatesUnchangedSessionsEvenWhenSaveTimeChanges()
    {
        var window = Guid.NewGuid(); var tab = new BrowserTab { Url = "https://example.com", Title = "Example" };
        var session = new BrowserSession([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow);
        await _snapshots.SaveAsync(window, "Work", session);
        await _snapshots.SaveAsync(window, "Work", session with { SavedAt = DateTimeOffset.UtcNow.AddMinutes(1) });
        var snapshot = Assert.Single(await _snapshots.ListAsync());
        Assert.Equal("Work", snapshot.ProfileName);
        Assert.Equal(tab.Id, SessionSerializer.Deserialize(snapshot.SessionJson).ActiveTabId);
    }

    [Fact]
    public async Task KeepsTenVersionsPerWindowWithoutOverwritingAnotherWindow()
    {
        var first = Guid.NewGuid(); var second = Guid.NewGuid();
        for (var i = 0; i < 14; i++)
        {
            var tab = new BrowserTab { Url = $"https://example.com/{i}", Title = $"Version {i}" };
            await _snapshots.SaveAsync(first, "Default", new([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow));
        }
        var other = new BrowserTab { Url = "https://example.org", Title = "Other window" };
        await _snapshots.SaveAsync(second, "Default", new([other.ToSnapshot()], other.Id, DateTimeOffset.UtcNow));
        var snapshots = await _snapshots.ListAsync();
        Assert.Equal(11, snapshots.Count);
        Assert.Equal("Other window", SessionSerializer.Deserialize(snapshots[0].SessionJson).Tabs[0].Title);
        Assert.Equal("Version 4", SessionSerializer.Deserialize(snapshots[^1].SessionJson).Tabs[0].Title);
    }
}
